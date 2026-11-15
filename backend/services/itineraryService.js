const prisma = require('../utils/prismaClient');
const { isDeepStrictEqual } = require('node:util');
const gemini = require('./geminiService');
const { ItineraryError, validatePreferences, tripContext, validateItinerary } = require('../utils/itineraryValidation');

const inFlight = new Set();

async function getTrip(groupId, userId) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(groupId)) {
    throw new ItineraryError(400, 'Invalid trip ID.');
  }
  const trip = await prisma.group.findFirst({
    where: { id: groupId, members: { some: { userId } } },
    include: { _count: { select: { members: true } } },
  });
  if (!trip) throw new ItineraryError(404, 'Trip not found or access denied.');
  return trip;
}

async function getSaved(groupId, userId) {
  const trip = await getTrip(groupId, userId);
  const saved = trip.aiItinerary;
  if (!saved) return null;
  let stale = true;
  try { stale = !isDeepStrictEqual(saved.context, tripContext(trip)); }
  catch { /* A previously valid trip may now have invalid dates/destination. */ }
  return { ...saved, stale };
}

async function generate(groupId, userId, body) {
  const preferences = validatePreferences(body);
  const trip = await getTrip(groupId, userId);
  const context = tripContext(trip);
  if (inFlight.has(groupId)) throw new ItineraryError(409, 'An itinerary is already being generated for this trip. Please wait.');
  inFlight.add(groupId);
  try {
    const raw = await gemini.generateItinerary(context, preferences);
    const itinerary = validateItinerary(raw, context, preferences);
    const saved = { version: 1, generatedAt: new Date().toISOString(), context, preferences, itinerary };
    // Recheck membership and trip context after the slow provider call.
    const current = await getTrip(groupId, userId);
    if (!isDeepStrictEqual(tripContext(current), context)) {
      throw new ItineraryError(409, 'The trip changed during generation. Please retry.');
    }
    const result = await prisma.group.updateMany({
      where: {
        id: groupId, destination: trip.destination, startDate: trip.startDate,
        endDate: trip.endDate, currency: trip.currency, tripType: trip.tripType,
        members: { some: { userId } },
      },
      data: { aiItinerary: saved },
    });
    if (!result.count) throw new ItineraryError(409, 'The trip changed during generation. Please retry.');
    return { ...saved, stale: false };
  } finally { inFlight.delete(groupId); }
}

module.exports = { generate, getSaved };
