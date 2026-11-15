class ItineraryError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const DAY_MS = 86400000;
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function validatePreferences(body = {}) {
  if (!object(body) || Object.keys(body).some(key => !['budget', 'interests'].includes(key))) {
    throw new ItineraryError(400, 'Only budget and interests may be provided. Trip details come from your trip.');
  }
  const budget = body.budget ?? null;
  if (budget !== null && (typeof budget !== 'number' || !Number.isFinite(budget) || budget <= 0 || budget > 100000000)) {
    throw new ItineraryError(400, 'Budget must be a positive number no greater than 100000000.');
  }
  const interests = body.interests ?? '';
  if (typeof interests !== 'string' || interests.length > 500) {
    throw new ItineraryError(400, 'Interests must be text of at most 500 characters.');
  }
  return { budget, interests: interests.trim() };
}

function tripContext(group) {
  const start = new Date(group.startDate);
  const end = new Date(group.endDate);
  if (!text(group.destination, 200) || !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
    throw new ItineraryError(400, 'Add a destination and valid dates to your trip first.');
  }
  const startDate = start.toISOString().slice(0, 10);
  const endDate = end.toISOString().slice(0, 10);
  const duration = Math.round((Date.parse(endDate) - Date.parse(startDate)) / DAY_MS) + 1;
  if (duration < 1 || duration > 14) {
    throw new ItineraryError(400, 'AI itineraries support trips of 1 to 14 days. Update the trip dates first.');
  }
  if (!/^[A-Z]{3}$/.test(group.currency)) {
    throw new ItineraryError(400, 'Set a valid three-letter trip currency first.');
  }
  return {
    destination: group.destination.trim(), startDate, endDate, duration,
    currency: group.currency, tripType: group.tripType,
    // Pending invitees are still travelers; no names/contact details go to Gemini.
    groupSize: Math.max(1, group._count.members +
      (Array.isArray(group.preAddedParticipants) ? group.preAddedParticipants.length : 0)),
  };
}

// Keep the provider schema structural: complex nested bounds can be rejected by
// Gemini. validateItinerary below enforces all lengths, counts, dates and costs.
const itinerarySchema = {
  type: 'object',
  required: ['summary', 'days'],
  properties: {
    summary: { type: 'string' },
    days: {
      type: 'array',
      items: {
        type: 'object',
        required: ['day', 'date', 'activities'],
        properties: {
          day: { type: 'integer' },
          date: { type: 'string', description: 'YYYY-MM-DD' },
          activities: {
            type: 'array',
            items: {
              type: 'object',
              required: ['time', 'title', 'description', 'estimatedCost'],
              properties: {
                time: { type: 'string', description: '24-hour HH:mm, local destination time' },
                title: { type: 'string' },
                description: { type: 'string' },
                estimatedCost: { type: 'number' },
              },
            },
          },
        },
      },
    },
  },
};

function validateItinerary(value, context, preferences) {
  const invalid = () => { throw new ItineraryError(502, 'The AI returned an invalid itinerary. Please retry.'); };
  if (!object(value) || !text(value.summary, 1000) || !Array.isArray(value.days) || value.days.length !== context.duration) invalid();
  let total = 0;
  const days = value.days.map((day, index) => {
    const expectedDate = new Date(Date.parse(context.startDate) + index * DAY_MS).toISOString().slice(0, 10);
    if (!object(day) || day.day !== index + 1 || day.date !== expectedDate ||
        !Array.isArray(day.activities) || day.activities.length < 1 || day.activities.length > 8) invalid();
    let previousTime = '';
    const activities = day.activities.map(activity => {
      if (!object(activity) || !text(activity.title, 150) || !text(activity.description, 1000) ||
          typeof activity.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(activity.time) ||
          activity.time <= previousTime || typeof activity.estimatedCost !== 'number' ||
          !Number.isFinite(activity.estimatedCost) || activity.estimatedCost < 0 || activity.estimatedCost > 100000000) invalid();
      previousTime = activity.time;
      const estimatedCost = Math.round(activity.estimatedCost * 100) / 100;
      total += estimatedCost;
      return { time: activity.time, title: activity.title.trim(), description: activity.description.trim(), estimatedCost };
    });
    return { day: index + 1, date: expectedDate, activities };
  });
  if (preferences.budget !== null && total > preferences.budget * 1.1 + 0.01) {
    throw new ItineraryError(502, 'The AI exceeded your activity budget. Please retry with different preferences.');
  }
  return {
    destination: context.destination, currency: context.currency,
    summary: value.summary.trim(), days, estimatedTotalCost: Math.round(total * 100) / 100,
  };
}

module.exports = { ItineraryError, validatePreferences, tripContext, itinerarySchema, validateItinerary };
