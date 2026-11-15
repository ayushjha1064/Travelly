jest.mock('axios');
jest.mock('../utils/prismaClient', () => ({ group: { findFirst: jest.fn(), updateMany: jest.fn() } }));
const axios = require('axios');
const prisma = require('../utils/prismaClient');
const service = require('../services/itineraryService');
const gemini = require('../services/geminiService');
const { validatePreferences, tripContext, validateItinerary } = require('../utils/itineraryValidation');

const trip = {
  id: '11111111-1111-4111-8111-111111111111', destination: 'Goa', currency: 'INR', tripType: 'Beach',
  startDate: new Date('2026-12-10'), endDate: new Date('2026-12-11'),
  _count: { members: 2 }, preAddedParticipants: [{ name: 'Private name', phone: 'Private phone' }],
};
const valid = () => ({ summary: 'Two relaxed days in Goa', days: [1, 2].map(day => ({
  day, date: `2026-12-${day + 9}`, activities: [
    { time: '10:00', title: 'Beach walk', description: 'Enjoy the coast with time to rest.', estimatedCost: 100 },
  ],
})) });
const providerResponse = (value) => ({ data: { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(value) }] } }] } });
const originalKey = process.env.GEMINI_API_KEY;
beforeEach(() => {
  jest.resetAllMocks();
  // Test-only sentinel, with Axios mocked; no live provider requests are possible.
  process.env.GEMINI_API_KEY = 'unit-test-sentinel';
  prisma.group.findFirst.mockResolvedValue(trip);
  prisma.group.updateMany.mockResolvedValue({ count: 1 });
  axios.post.mockResolvedValue(providerResponse(valid()));
});
afterAll(() => { if (originalKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = originalKey; });

test('valid trip -> provider schema -> validated persistence; no member identity sent', async () => {
  const saved = await service.generate(trip.id, 'user', { budget: 500, interests: 'Beaches' });
  expect(saved.itinerary.estimatedTotalCost).toBe(200);
  expect(saved.context.groupSize).toBe(3);
  expect(prisma.group.findFirst.mock.calls[0][0].where.members).toEqual({ some: { userId: 'user' } });
  expect(prisma.group.updateMany.mock.calls[0][0].data.aiItinerary).toEqual(expect.objectContaining({ itinerary: saved.itinerary }));
  const [, request, config] = axios.post.mock.calls[0];
  expect(request.generationConfig.responseJsonSchema).toBeDefined();
  expect(JSON.stringify(request)).not.toContain('Private');
  expect(config.timeout).toBe(45000);
});

test.each([{ budget: -1 }, { budget: '100' }, { budget: Infinity }, { interests: ['beach'] }, { interests: 'x'.repeat(501) }, { destination: 'Override' }, null])('invalid preferences %j', input => {
  expect(() => validatePreferences(input)).toThrow();
});
test('empty preferences are optional', () => expect(validatePreferences({})).toEqual({ budget: null, interests: '' }));
test.each([
  { destination: '' }, { startDate: 'bad' }, { endDate: new Date('2026-12-09') }, { endDate: new Date('2027-01-01') },
])('invalid stored trip %j', changes => expect(() => tripContext({ ...trip, ...changes })).toThrow());
test('bad ID rejected before database or provider', async () => {
  await expect(service.generate('bad-id', 'user', {})).rejects.toMatchObject({ status: 400 });
  expect(prisma.group.findFirst).not.toHaveBeenCalled();
});
test('missing trip/non-member never calls provider', async () => {
  prisma.group.findFirst.mockResolvedValue(null);
  await expect(service.generate(trip.id, 'user', {})).rejects.toMatchObject({ status: 404 });
  expect(axios.post).not.toHaveBeenCalled();
});
test('missing key returns 503 and preserves saved itinerary', async () => {
  delete process.env.GEMINI_API_KEY;
  await expect(service.generate(trip.id, 'user', {})).rejects.toMatchObject({ status: 503 });
  expect(prisma.group.updateMany).not.toHaveBeenCalled();
});
test.each([[{ code: 'ECONNABORTED' }, 504], [{ code: 'ERR_CANCELED' }, 504], [{ response: { status: 429 } }, 429], [{ message: 'secret-provider-details' }, 502]])('provider error maps safely', async (error, status) => {
  axios.post.mockRejectedValue(error);
  await expect(service.generate(trip.id, 'user', {})).rejects.toMatchObject({ status });
  expect(prisma.group.updateMany).not.toHaveBeenCalled();
});
test.each(['not json', '', 'null', '{'])('malformed or empty provider text: %s', async output => {
  axios.post.mockResolvedValue({ data: { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: output }] } }] } });
  await expect(service.generate(trip.id, 'user', {})).rejects.toMatchObject({ status: 502 });
  expect(prisma.group.updateMany).not.toHaveBeenCalled();
});
test.each(['SAFETY', 'MAX_TOKENS'])('incomplete output %s', async finishReason => {
  axios.post.mockResolvedValue({ data: { candidates: [{ finishReason }] } });
  await expect(gemini.generateItinerary(tripContext(trip), {})).rejects.toMatchObject({ status: 502 });
});
test.each([
  value => { value.days = []; },
  value => { value.days[0].date = '2026-12-12'; },
  value => { value.days[0].activities = []; },
  value => { value.days[0].activities[0].estimatedCost = -1; },
  value => { value.days[0].activities[0].time = '25:00'; },
  value => { value.days[0].activities.push(value.days[0].activities[0]); },
  value => { value.days[0].activities[0].title = ''; },
  value => { value.days[0].activities[0].description = 'x'.repeat(1001); },
])('rejects invalid itinerary semantics', mutate => {
  const value = valid(); mutate(value);
  expect(() => validateItinerary(value, tripContext(trip), { budget: null })).toThrow();
});
test('rejects excessive estimated budget', () => {
  expect(() => validateItinerary(valid(), tripContext(trip), { budget: 100 })).toThrow(/budget/);
});
test('trip change while generating cannot overwrite saved plan', async () => {
  prisma.group.findFirst.mockResolvedValueOnce(trip).mockResolvedValueOnce({ ...trip, destination: 'Delhi' });
  await expect(service.generate(trip.id, 'user', {})).rejects.toMatchObject({ status: 409 });
  expect(prisma.group.updateMany).not.toHaveBeenCalled();
});
test('concurrent calls for same trip are rejected and lock is released', async () => {
  let finish;
  axios.post.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const first = service.generate(trip.id, 'user', {});
  await new Promise(resolve => setImmediate(resolve));
  await expect(service.generate(trip.id, 'user', {})).rejects.toMatchObject({ status: 409 });
  finish(providerResponse(valid()));
  await first;
  await expect(service.generate(trip.id, 'user', {})).resolves.toHaveProperty('itinerary');
});
test('saved plans survive reload and flag stale trip context', async () => {
  const saved = await service.generate(trip.id, 'user', {});
  prisma.group.findFirst.mockResolvedValue({ ...trip, destination: 'Delhi', aiItinerary: saved });
  expect((await service.getSaved(trip.id, 'user')).stale).toBe(true);
});

module.exports = {};
