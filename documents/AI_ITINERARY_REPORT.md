# Travelly AI itinerary implementation report

Date: 7 October 2026 (Asia/Kolkata).

**Implementation complete; live authenticated AI generation and persistence verified.** Using the supplied Firebase service account and backend Gemini key, a real Firebase ID token authenticated a Travelly request that generated a two-day Goa itinerary through Gemini, saved it to PostgreSQL JSONB, and retrieved the identical saved plan (HTTP 200 for both requests). Flutter display/API-client tests and web build pass; the full signed-in browser itinerary flow has not been manually exercised.

## 1. Repository safety

Both repositories started clean, already on `ai-itinerary-feature`. Remotes are `https://github.com/CS253/backend` and `https://github.com/CS253/frontend`. Existing work was preserved; no commits, pushes, force operations or remote database changes were made. Final changes remain reviewable in the two working trees.

## 2. Actual architecture

- Flutter application organized into features, using Provider/ChangeNotifier, repository/service classes and a shared `ApiClient` with Firebase Bearer tokens.
- Firebase client options already exist for web, Android, iOS and macOS. Cloud Firestore is a dependency but has no usage in `lib/`.
- Express 5 API with routes/controllers/services. PostgreSQL via Prisma 6.19.2. A trip is a `Group`, not a separate `Trip` model.
- Models: User, Group, GroupMember, Expense, ExpenseSplit, Settlement, Transaction, Media and FcmToken.
- Authentication: Flutter Firebase sign-in, `/api/users/sync`, then Firebase Admin token verification and a PostgreSQL user lookup. JWT_SECRET/JWT_EXPIRE are unused.
- Existing features: trip/group membership and invites, expenses/splits/settlements, notifications, photos/documents, route planning. Media uses memory Multer uploads and either local encrypted files or SFTP storage.
- OpenRouteService provides driving routes; the service named `overpassService.js` actually obtains opening-hours data from SerpAPI. Flutter also uses GeoDB, Nominatim and Open-Meteo.

## 3. Existing application status

| Area | Verified result | Remaining limitation |
|---|---|---|
| Backend | Express runs on port 5001; GET / returns its JSON health response | Health alone does not prove external services |
| Auth boundary | Unauthenticated request returns 401; outsider cannot access itineraries in integration tests | Live Firebase ID-token authentication also passed |
| Database | Fresh PostgreSQL 17 instance, real Prisma schema and JSONB save/reload verified | Existing hosted DB credentials/history unavailable |
| Frontend | Web app launched in Chrome; launch → sign-in navigation observed | Authenticated browser trip flow not exercised |
| Flutter build | Production web bundle built; analyzer reports no issues | iOS/macOS need full Xcode/CocoaPods; Android SDK absent |
| Existing trip APIs | Details, members, expense listing and trip PATCH pass in real HTTP/DB tests | Auth is mocked in those tests; no complete expense/settlement browser workflow |
| Gemini | Request construction, timeout/error mapping, response validation, persistence and UI tested | Live authenticated generation and saved-plan retrieval also passed |
| Other APIs/media | Integrations/configuration inspected | ORS, SerpAPI, FCM and SFTP live calls not tested |

Local PostgreSQL data: `/private/tmp/travelly-postgres`, loopback port `55432`, role `travelly_local`. Databases: `travelly_dev` and isolated `travelly_itinerary_test`. No hosted database URL was present; backend `.env` did not exist initially. The local cluster uses trust authentication on loopback for development only. Its temporary storage can be removed by the OS; it is not a durable deployment.

## 4. Issues found and fixed

- Missing Node/Flutter executables: installed portable Node 22.16.0 and Flutter 3.41.0 into `/private/tmp/travelly-tools`; installed lockfile dependencies.
- macOS AirPlay occupies 5000; original Express 5 startup printed success despite failure. Default/local port is now 5001 and startup reports bind errors.
- Frontend `.env` absent: created an ignored public configuration file plus a tracked example. Replaced inconsistent hardcoded Android/LAN/web URLs with platform defaults and a dart-define override.
- Historical migration chain duplicates table creation and omits later schema fields: used `prisma db push` only on fresh isolated databases, documenting the deployment blocker instead of rewriting history.
- Existing trip PATCH selects a nonexistent `Group.updatedAt`: added the field and an additive migration; verified PATCH succeeds.
- Existing Flutter smoke test lacked Firebase initialization: added platform mocks; app launch test now passes.
- Fixed analyzer findings: unused variable, null-aware operator, async BuildContext checks, and duplicate inviteLink map entry encountered in trip modeling.
- Removed payment-dialog Firebase token logging. Hardened backend auth cache to use a full-token hash and check expiry; regression tests cover both.
- Integration testing caught JSONB key reordering falsely flagging saved plans stale: switched to semantic object comparison.
- Live Gemini testing rejected the original nested, bounded provider schema. Simplified the provider schema to structure/types/required fields; server-side validation still enforces lengths, counts, dates, times and costs. Added an oversized-description regression test.
- Updated Flutter web configuration to the supplied Firebase project `travelly-77a5a` and configured backend Firebase Admin credentials from the external service-account file. Restarted both local servers and rebuilt the web bundle.

Historical items not rewritten: inconsistent migration history, existing media-encryption fallback and deployment CORS behavior when ALLOWED_ORIGINS is empty. Local settings explicitly restrict browser origins. Existing encrypted media keys were not rotated.

## 5. Implemented feature

```text
Trip dashboard → ItineraryScreen → ItineraryService → shared ApiClient
  → authenticated /api/groups/:groupId/generate-itinerary
  → controller → itinerary service → isolated Gemini REST service
  → JSON/schema + semantic validation → Prisma Group.aiItinerary JSONB
  → typed Flutter models → day-wise display
```

`GET /api/groups/:groupId/itinerary` retrieves the shared saved plan. Authentication and membership are checked on both routes. Generation rechecks membership/context after the provider call. Regenerating replaces the latest plan; provider/validation failures leave the old plan intact.

Only optional budget/interests are entered. Destination, date range, currency, trip type, joined-member count and pending invitee count are read from the existing group. No member identities or expense records are sent to Gemini. Budget means group activities, meals and local transport for all days, excluding accommodation and travel to/from the destination.

Limits: 1–14 inclusive days, 1–8 activities/day, 500-character interests, finite bounded costs, exact dates/day numbers, strictly increasing HH:mm start times and estimated total at most 10% above the requested budget. The prompt asks for realistic travel/rest gaps; semantic validation cannot prove real-world opening hours or feasibility. Estimates are clearly labeled in the UI.

Gemini REST is called through existing Axios, using JSON-schema structured output, a 45-second timeout/abort and response-size bound. No new backend SDK is needed. Default model is configurable via GEMINI_MODEL; `gemini-3.5-flash-lite` is documented as supporting structured output in [Google's model documentation](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite). Integration follows the [Gemini generateContent reference](https://ai.google.dev/api/generate-content).

Safe status codes: 400 invalid input/ID/trip; 401 missing/invalid auth; 404 unavailable/non-member trip; 409 in-flight generation/trip change; 429 quota; 502 provider/JSON/schema failure; 503 missing key; 504 timeout; 500 database failure. Provider request objects/keys are never forwarded to Flutter. The in-flight guard is process-local, appropriate to this single-server project.

## 6. Credentials and configuration

A = mandatory for process startup; B = feature-specific; C = optional/default; D = unused. No secret is mandatory merely to serve Express's public health endpoint after dependencies/Prisma generation.

| Backend variable | Class | Purpose / source | Starts without it? |
|---|---|---|---|
| PORT | C | Default 5001 | Yes |
| DATABASE_URL | B | PostgreSQL URL from local setup or database owner; all data/auth user lookups | Health only |
| BASE_URL | B | Backend public origin, e.g. http://localhost:5001, for local media links | Yes |
| ALLOWED_ORIGINS | C | Browser origin allowlist; local example covers port 8080 | Yes |
| FIREBASE_PROJECT_ID | B | Firebase project's ID | Yes; authenticated APIs blocked |
| FIREBASE_CLIENT_EMAIL | B | Admin service-account JSON client_email | Yes; authenticated APIs blocked |
| FIREBASE_PRIVATE_KEY | B | Admin service-account JSON private_key, quoted with escaped newlines | Yes; authenticated APIs blocked |
| GEMINI_API_KEY | B, new | Google AI Studio key; backend only | Yes; generation returns 503 after auth |
| GEMINI_MODEL | C, new | Default gemini-3.5-flash-lite; model available to your project | Yes |
| MEDIA_STORAGE_DRIVER | C | local default; sftp selects remote media | Yes |
| LOCAL_UPLOAD_ROOT | C | Defaults to backend/uploads | Yes |
| IITK_SFTP_HOST | B | IITK server administrator, SFTP media | Yes |
| IITK_SFTP_PORT | C | Default 22, SFTP media | Yes |
| IITK_SFTP_USER | B | IITK server administrator, SFTP media | Yes |
| IITK_SFTP_PASSWORD | B | IITK server administrator, SFTP media | Yes |
| IITK_UPLOAD_ROOT | B | Remote upload directory, SFTP media | Yes |
| IITK_PUBLIC_BASE_URL | B | Public remote media URL, SFTP media | Yes |
| ENCRYPTION_KEY | C in existing code | Existing deployment's media key; legacy fallback exists | Yes |
| ORS_API_KEY | B | OpenRouteService account/API dashboard, driving routes | Yes |
| SERPAPI_KEY | B | SerpAPI dashboard, place opening hours | Yes; timings unavailable |
| JWT_SECRET / JWT_EXPIRE | D | No references in current runtime | Yes |

Obtain Firebase Admin credentials from the existing project's **Firebase Console → Project settings → Service accounts → Generate new private key**, subject to project access. Map project_id/client_email/private_key into backend `.env`; keep the downloaded JSON private and untracked. The web frontend and backend now use your `travelly-77a5a` project. The supplied service-account JSON remains outside both repositories; backend `.env` is ignored and restricted to the local user. Native platform options and FlutterFire CLI metadata still reference the original `travelly-66659` project: register native apps separately before using those targets.

Obtain GEMINI_API_KEY from [Google AI Studio](https://aistudio.google.com/apikey). Put it only in backend `.env`; do not paste it into Flutter or Git. The supplied key successfully completed live generation with the configured model. Future quota availability still depends on the Google project.

Frontend configuration: `.env` file is required as an asset (A), but its BASE_URL setting is optional (C). A `--dart-define=BASE_URL=...` override is also supported (C). Existing client Firebase options are already in source; no frontend Gemini variable is needed. Native Firebase config files are ignored and may require project-owner setup for native targets.

## 7. Exact run commands for this Mac

Portable SDKs and local `.env` files are already installed/configured. In each new terminal:

```sh
export PATH="/private/tmp/travelly-tools/node-v22.16.0-darwin-arm64/bin:/private/tmp/travelly-tools/flutter/bin:$PATH"
export PUB_CACHE=/private/tmp/travelly-tools/pub-cache
```

If the isolated PostgreSQL server is stopped:

```sh
/opt/homebrew/opt/postgresql@17/bin/pg_ctl -D /private/tmp/travelly-postgres -l /private/tmp/travelly-postgres.log -o '-h 127.0.0.1 -p 55432 -k /private/tmp' start
```

Backend:

```sh
cd /Users/ayushjha/Downloads/Travelly/backend
npm ci
npx prisma generate
npm start
```

Frontend, separate terminal:

```sh
cd /Users/ayushjha/Downloads/Travelly/frontend
flutter pub get
flutter run -d chrome --web-port 8080
```

Alternative without launching Chrome automatically: `flutter run -d web-server --web-port 8080 --web-hostname 127.0.0.1`, then open `http://127.0.0.1:8080`.

Do not start a second instance on an occupied port; stop the existing dev-server terminal first. At report time the final backend is listening on 5001 and the final Flutter dev server on 8080. Both were restarted with the completed code. An earlier approval-review usage limit temporarily blocked the Flutter restart; the retry after continuation succeeded. The final production web bundle is successfully built at `frontend/build/web`.

If `/private/tmp` has been cleared, install Node 22 and Flutter 3.41.0 again and recreate the fresh local PostgreSQL cluster/database. Existing deployed databases need migration reconciliation rather than these fresh-database commands.

## 8. Test commands and live verification

```sh
cd /Users/ayushjha/Downloads/Travelly/backend
npm test -- --runInBand
# Includes the four real HTTP/PostgreSQL tests using the database already created:
TEST_DATABASE_URL=postgresql://travelly_local@127.0.0.1:55432/travelly_itinerary_test npm test -- --runInBand

cd /Users/ayushjha/Downloads/Travelly/frontend
flutter analyze
flutter test
flutter build web
```

Credentials are configured and the local servers are running. For a browser feature check, open `http://localhost:8080`, sign up/sign in to your new Firebase project, and create/open a trip with destination and 1–14 days of dates. Select **Generate AI Itinerary**, optionally set interests/budget, generate, verify each day, then leave/reopen to confirm persistence. Change trip dates and reopen to check the stale warning. Regenerate to update it.

For direct API testing, use a valid current Firebase ID token from your own signed-in development session and a group ID you belong to. Never commit or log the token. From a shell where TOKEN and TRIP_ID are set privately:

```sh
curl -sS http://localhost:5001/api/groups/"$TRIP_ID"/generate-itinerary \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"budget":10000,"interests":"Local food and relaxed mornings"}'
curl -sS http://localhost:5001/api/groups/"$TRIP_ID"/itinerary \
  -H "Authorization: Bearer $TOKEN"
```

The old token-printing debug statement was removed deliberately. Unauthenticated curl cannot verify the missing-key branch because authentication runs first.

## 9. What actually passed

- `npm ci`, Prisma generation and schema creation on fresh databases.
- Public backend HTTP health 200, protected route 401, browser preflight 204.
- **56 backend tests**: 52 credential-free tests plus 4 opted-in real HTTP/PostgreSQL cases. Provider/auth test boundaries are explicitly mocked.
- Database cases: generation → validation → JSONB save → HTTP reload; member isolation; invalid input/ID/destination; missing key; provider/JSON failure preservation. Existing trip detail/member/expense-list/PATCH endpoints also return 200.
- Unit cases additionally cover timeouts, quotas, empty/truncated/malformed output, wrong dates, empty activities, negative costs, out-of-order times, budget overflow, concurrent requests and trip changes.
- **5 Flutter tests**: repaired signed-out app smoke test plus itinerary request/render/loading, error/retry, saved/stale state and invalid-budget tests. One itinerary test uses a 390px-wide viewport.
- `flutter analyze`: **No issues found**.
- `flutter build web`: **Built build/web**. Browser launch and sign-in screen navigation visually observed.
- Live authenticated HTTP check: real Firebase custom-token exchange → real ID-token verification → Travelly user sync → trip creation → Gemini generation → JSONB persistence → identical GET response. Two days, ten activities, estimated group activity cost INR 5,400 against a requested INR 6,000 budget.
- Firebase project configuration confirms email/password sign-in enabled and `localhost` authorized.
- Disposable test Firebase identity, local user and trip were removed after verification. The abandoned fixtures from an initial test-script ID parsing error were also removed; user-created records were preserved.
- Git whitespace checks passed. Nothing was pushed.

The authenticated full-browser itinerary flow, remote DB migration, native app build, live payment and media upload were not verified. Live Firebase/Gemini and local database/API verification evidence is saved in `documents/verification/live-api-check.json`; the actual generated itinerary is in `documents/verification/live-itinerary.json`.

## 10. Dependencies

No backend dependencies added; existing Axios handles Gemini REST. Frontend adds two dev-only direct declarations for already-transitive Firebase test helpers: firebase_core_platform_interface 6.0.3 and firebase_auth_platform_interface 8.1.7. Flutter 3.41.0 pins matcher 0.12.18 and test_api 0.7.8, so those two test dependencies changed in pubspec.lock. Runtime packages were not broadly upgraded.

## 11. Changed files

Backend paths are relative to `backend/`; frontend paths to `frontend/`. Local `.env` files are ignored and excluded from these source lists.

### backend

- `.env.example`
- `README.md`
- `prisma/schema.prisma`
- `routes/groupRoutes.js`
- `server.js`
- `services/authService.js`
- `controllers/itineraryController.js`
- `prisma/migrations/20261007090000_add_ai_itinerary/migration.sql`
- `prisma/migrations/20261007090100_fix_group_updated_at/migration.sql`
- `services/geminiService.js`
- `services/itineraryService.js`
- `tests/authCache.test.js`
- `tests/itinerary.integration.test.js`
- `tests/itinerary.test.js`
- `utils/itineraryValidation.js`

### frontend

- `README.md`
- `lib/core/api/api_endpoints.dart`
- `lib/firebase_options.dart`
- `lib/features/dashboard/data/models/trip_model.dart`
- `lib/features/dashboard/data/services/dashboard_service.dart`
- `lib/features/dashboard/presentation/providers/dashboard_provider.dart`
- `lib/features/dashboard/presentation/screens/dashboard_screen.dart`
- `lib/features/dashboard/presentation/widgets/participant_row.dart`
- `lib/features/intro/presentation/screens/otp_screen.dart`
- `lib/features/payments/presentation/dialogs/settle_balance/pay_with_upi_dialog.dart`
- `lib/features/trip_settings/presentation/screens/manage_members_screen.dart`
- `lib/features/trips/data/models/trip_model.dart`
- `lib/features/trips/presentation/screens/join_trip_screen.dart`
- `pubspec.lock`
- `pubspec.yaml`
- `test/widget_test.dart`
- `.env.example`
- `lib/features/itinerary/data/itinerary_service.dart`
- `lib/features/itinerary/presentation/itinerary_screen.dart`
- `test/itinerary_test.dart`

The report itself is `documents/AI_ITINERARY_REPORT.md`, outside the two application repositories. Test/build logs are copied into `documents/verification/` for review.

## 12. Interview explanation

“I extended our existing Flutter travel app with personalized itineraries inside the trip dashboard. Flutter sends optional preferences through our authenticated API client to Express. The backend verifies Firebase identity and group membership, reads trip context from PostgreSQL, and calls Gemini through an isolated service. Gemini returns structured JSON, which we validate for dates, activity order, costs and budget before storing it in the existing Group's JSONB field. Flutter renders typed day-wise activities and handles loading, retry and saved plans. I tested failure cases with mocked external services and Flutter UI states, then verified a real Firebase-authenticated request through Gemini, PostgreSQL persistence and saved-plan retrieval.”
