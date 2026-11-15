# Travelly backend

Express 5 + Prisma 6 + PostgreSQL. Trips are `Group` records; auth uses Firebase ID tokens.

## Run

Use Node 22. From `backend/`:

```sh
npm ci
test -f .env || cp .env.example .env
npx prisma generate
npm start
# For automatic reload: npm run dev
```

Port defaults to **5001**, avoiding macOS AirPlay on 5000. Public liveness: `GET /`. API prefix: `/api`. Fill backend Firebase credentials for authenticated routes and `GEMINI_API_KEY` for live generation. Never put backend secrets in Flutter assets.

## Database

The old migration history is inconsistent: two March migrations create the same core tables, and Firebase/notification schema changes are missing. Do not reset or blindly deploy that chain against an existing database.

For a **fresh, empty local database only**, `npx prisma db push` creates the current schema. Two new additive migrations add `Group.aiItinerary` JSONB and `Group.updatedAt` (already expected by existing trip editing). Reconcile an existing deployment's schema/history before applying them there. No remote database was modified.

## AI endpoints

- `POST /api/groups/:groupId/generate-itinerary`: generate and save the latest shared plan.
- `GET /api/groups/:groupId/itinerary`: reload it, or return `data: null` if none exists.
- Both require a Firebase Bearer token and current trip membership.
- Optional body: `{"budget":10000,"interests":"Beaches and local food"}`; `{}` is valid.
- Destination, currency, inclusive dates (1–14 days), and traveler count come from PostgreSQL.
- Budget covers all travelers/all days: activities, meals and local transport; excludes accommodation and travel to/from the destination.
- Success: `{success:true,data:{version,generatedAt,context,preferences,itinerary,stale}}`.
- Itinerary: `{destination,currency,summary,estimatedTotalCost,days:[{day,date,activities:[{time,title,description,estimatedCost}]}]}`.
- Errors: 400 input; 401 auth; 404 missing/inaccessible trip; 409 concurrent generation/changed trip; 429 provider quota; 502 provider/invalid output; 503 missing key; 504 timeout; 500 persistence failure.

Provider timeout: 45 seconds. Invalid generation preserves the previous plan. Changed trip context marks saved plans stale. The single-process per-trip in-flight guard prevents concurrent generation in this backend process.

Gemini is isolated in `services/geminiService.js`, using existing Axios and REST structured output. `GEMINI_MODEL` defaults to `gemini-3.5-flash-lite`. Member names, phones, emails, Firebase tokens and expense records are not sent. Prices remain estimates.

## Tests

```sh
npm test -- --runInBand
```

Four real-database cases skip unless enabled. With a fresh local database named `travelly_itinerary_test`:

```sh
DATABASE_URL=postgresql://travelly_local@127.0.0.1:55432/travelly_itinerary_test npx prisma db push
TEST_DATABASE_URL=postgresql://travelly_local@127.0.0.1:55432/travelly_itinerary_test npm test -- --runInBand
```

Tests permit only loopback and that database name. They clean up only their fixture records. Firebase/Gemini boundaries are mocked; Prisma, PostgreSQL and HTTP routes are real. Production has no authentication bypass.

See `../documents/AI_ITINERARY_REPORT.md` for exact local tool/database commands, credential classifications, verified results and limitations.
