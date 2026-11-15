// Explicit opt-in; only the disposable loopback database is allowed.
const testUrl = process.env.TEST_DATABASE_URL;
if (testUrl) {
  const url = new URL(testUrl);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/travelly_itinerary_test') {
    throw new Error('Integration tests require the isolated local travelly_itinerary_test database.');
  }
  process.env.DATABASE_URL = testUrl;
}
jest.mock('axios');
jest.mock('../services/firebaseAdmin', () => ({
  initFirebase: jest.fn(),
  admin: { auth: () => ({ verifyIdToken: async token => {
    if (!['fixture-member', 'fixture-outsider'].includes(token)) throw new Error('Invalid fixture token');
    return { uid: token, exp: Math.floor(Date.now() / 1000) + 300 };
  } }) },
}));
const axios = require('axios');
const prisma = require('../utils/prismaClient');
const app = require('../server');
const { randomUUID } = require('crypto');
const run = testUrl ? describe : describe.skip;

run('real HTTP routes + real PostgreSQL; Firebase/Gemini mocked', () => {
  let server, base, trip, member, outsider;
  const previousKey = process.env.GEMINI_API_KEY;
  const request = async (path, { token = 'fixture-member', method = 'GET', body } = {}) => {
    const response = await fetch(`${base}${path}`, {
      method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: await response.json() };
  };
  const plan = () => ({ summary: 'A relaxed day in Goa', days: [{
    day: 1, date: '2026-12-10', activities: [{ time: '09:00', title: 'Beach walk', description: 'Enjoy the coast.', estimatedCost: 200 }],
  }] });
  beforeAll(async () => {
    member = await prisma.user.create({ data: { email: `${randomUUID()}@example.test`, firebaseUid: 'fixture-member' } });
    outsider = await prisma.user.create({ data: { email: `${randomUUID()}@example.test`, firebaseUid: 'fixture-outsider' } });
    trip = await prisma.group.create({ data: {
      title: 'Itinerary integration fixture', destination: 'Goa', currency: 'INR', tripType: 'Beach',
      startDate: new Date('2026-12-10'), endDate: new Date('2026-12-10'),
      createdBy: member.id, inviteLink: randomUUID(), members: { create: { userId: member.id } },
    } });
    server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
    base = `http://127.0.0.1:${server.address().port}/api/groups/${trip.id}`;
  });
  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'unit-test-sentinel';
    axios.post.mockReset().mockResolvedValue({ data: { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(plan()) }] } }] } });
  });
  afterAll(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    if (trip) await prisma.group.delete({ where: { id: trip.id } });
    for (const user of [member, outsider].filter(Boolean)) await prisma.user.delete({ where: { id: user.id } });
    await prisma.$disconnect();
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = previousKey;
  });
  test('HTTP generation persists JSONB and GET reload returns the same plan', async () => {
    expect((await request('/itinerary')).body.data).toBeNull();
    const generated = await request('/generate-itinerary', { method: 'POST', body: { budget: 1000, interests: 'Beaches' } });
    expect(generated.status).toBe(200);
    expect(generated.body.data.itinerary.days[0].activities[0].title).toBe('Beach walk');
    const stored = await prisma.group.findUnique({ where: { id: trip.id } });
    expect(stored.aiItinerary.itinerary).toEqual(generated.body.data.itinerary);
    expect((await request('/itinerary')).body.data).toEqual(generated.body.data);
    // Existing trip/member/expense APIs still work with the additive column.
    expect((await request('')).status).toBe(200);
    expect((await request('/members')).status).toBe(200);
    expect((await request('/expenses')).status).toBe(200);
    expect((await request('', { method: 'PATCH', body: { title: 'Updated fixture trip' } })).status).toBe(200);
  });
  test('unauthenticated and outsider requests cannot read or generate', async () => {
    for (const path of ['/itinerary', '/generate-itinerary']) {
      const options = path.includes('generate') ? { method: 'POST', body: {} } : {};
      expect((await request(path, { ...options, token: null })).status).toBe(401);
      expect((await request(path, { ...options, token: 'fixture-outsider' })).status).toBe(404);
    }
    expect(axios.post).not.toHaveBeenCalled();
  });
  test('bad IDs, missing stored destination and bad input return clean failures', async () => {
    const originalBase = base;
    base = base.replace(trip.id, 'bad-id');
    expect((await request('/generate-itinerary', { method: 'POST', body: {} })).status).toBe(400);
    base = base.replace('bad-id', randomUUID());
    expect((await request('/generate-itinerary', { method: 'POST', body: {} })).status).toBe(404);
    base = originalBase;
    expect((await request('/generate-itinerary', { method: 'POST', body: { budget: -1 } })).status).toBe(400);
    await prisma.group.update({ where: { id: trip.id }, data: { destination: '' } });
    expect((await request('/generate-itinerary', { method: 'POST', body: {} })).status).toBe(400);
    await prisma.group.update({ where: { id: trip.id }, data: { destination: 'Goa' } });
  });
  test('missing key, provider failure and malformed output never overwrite saved JSON', async () => {
    const before = (await request('/itinerary')).body.data;
    delete process.env.GEMINI_API_KEY;
    expect((await request('/generate-itinerary', { method: 'POST', body: {} })).status).toBe(503);
    process.env.GEMINI_API_KEY = 'unit-test-sentinel';
    axios.post.mockRejectedValueOnce({ message: 'secret-upstream-details' });
    const failed = await request('/generate-itinerary', { method: 'POST', body: {} });
    expect(failed.status).toBe(502);
    expect(JSON.stringify(failed.body)).not.toContain('secret-upstream-details');
    axios.post.mockResolvedValueOnce({ data: { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{broken' }] } }] } });
    expect((await request('/generate-itinerary', { method: 'POST', body: {} })).status).toBe(502);
    expect((await request('/itinerary')).body.data).toEqual(before);
  });
});
