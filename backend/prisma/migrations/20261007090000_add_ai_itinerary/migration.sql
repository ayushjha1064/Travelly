-- Additive only; existing trip records retain a null itinerary.
ALTER TABLE "Group" ADD COLUMN "aiItinerary" JSONB;
