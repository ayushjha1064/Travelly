const service = require('../services/itineraryService');
const { ItineraryError } = require('../utils/itineraryValidation');

function endpoint(action) {
  return async (req, res) => {
    try {
      const data = await action(req.params.groupId, req.userId, req.body);
      res.json({ success: true, data });
    } catch (error) {
      const known = error instanceof ItineraryError;
      res.status(known ? error.status : 500).json({
        success: false,
        error: known ? error.message : 'Unable to load or save the itinerary. Please try again later.',
      });
    }
  };
}

module.exports = { generate: endpoint(service.generate), getSaved: endpoint(service.getSaved) };
