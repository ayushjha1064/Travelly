jest.mock('../utils/prismaClient', () => ({ user: { findUnique: jest.fn() } }));
jest.mock('../services/firebaseAdmin', () => ({ admin: { auth: jest.fn() } }));
const prisma = require('../utils/prismaClient');
const { admin } = require('../services/firebaseAdmin');
const { resolveAuthenticatedUser } = require('../services/authService');

test('tokens sharing a suffix do not share authentication cache entries', async () => {
  const verifyIdToken = jest.fn().mockResolvedValueOnce({ uid: 'cache-user', exp: Date.now() / 1000 + 300 })
    .mockRejectedValueOnce(new Error('Rejected token'));
  admin.auth.mockReturnValue({ verifyIdToken });
  prisma.user.findUnique.mockResolvedValue({ id: 'user' });
  await resolveAuthenticatedUser('Bearer valid.1234567890123456');
  await expect(resolveAuthenticatedUser('Bearer invalid.1234567890123456')).rejects.toThrow('Rejected token');
  expect(verifyIdToken).toHaveBeenCalledTimes(2);
});
test('expired cached token is reverified instead of accepted', async () => {
  const verifyIdToken = jest.fn().mockResolvedValueOnce({ uid: 'expired-user', exp: Date.now() / 1000 - 1 })
    .mockRejectedValueOnce(new Error('Expired token'));
  admin.auth.mockReturnValue({ verifyIdToken });
  prisma.user.findUnique.mockResolvedValue({ id: 'user' });
  await resolveAuthenticatedUser('Bearer expired-fixture');
  await expect(resolveAuthenticatedUser('Bearer expired-fixture')).rejects.toThrow('Expired token');
  expect(verifyIdToken).toHaveBeenCalledTimes(2);
});
