# Travelly

A collaborative trip-planning and expense-management application built as a CS253 group project, extended with personalised AI itinerary generation.

## Project structure

- [`frontend/`](frontend/README.md): Flutter and Provider, with Firebase Authentication.
- [`backend/`](backend/README.md): Node.js/Express REST APIs, Prisma and PostgreSQL.
- [`documents/`](documents/): original course project documents, implementation report and verification evidence.

## Features

- Shared trips, invitations and member management.
- Expense splitting, balances, debt simplification and settlements.
- Trip photos, documents and route planning.
- AI itineraries generated through the backend Gemini API integration, using trip dates, destination, group size and optional budget/interests.
- Membership checks, structured response validation, saved itineraries and retry/error states.

## Run locally

Use Node.js 22, PostgreSQL and Flutter (verified with Flutter 3.41.0).

1. Follow the [backend setup](backend/README.md). Copy `backend/.env.example` to `backend/.env` and configure your database, Firebase Admin credentials and Gemini API key.
2. Prepare a fresh local database using the backend instructions. Review the documented migration-history limitations before using an existing database.
3. Run `npm ci`, `npx prisma generate` and `npm start` from `backend/`.
4. Follow the [frontend setup](frontend/README.md): copy `.env.example` to `.env`, run `flutter pub get`, then `flutter run -d chrome --web-port 8080` from `frontend/`.
5. Sign in, create/open a trip lasting 1–14 days, and choose **Generate AI Itinerary**.

The backend defaults to port 5001. Firebase client and Admin configuration must refer to the same project. Native Firebase registrations require separate setup. Credentials, dependencies, build outputs and uploaded user files are excluded from this repository.

## Verification

Recorded on 7 October 2026:

- 56 backend tests passed, including four tests using an isolated PostgreSQL database with mocked external services.
- Five Flutter tests passed; Flutter analysis and the web build passed.
- A separate live check verified real Firebase authentication, Gemini generation, PostgreSQL persistence and saved-plan retrieval.
- The complete signed-in browser itinerary flow and native builds were not manually verified.

See the [implementation report](documents/AI_ITINERARY_REPORT.md) and [live API verification](documents/verification/live-api-check.json). These are historical results, not a claim that every external service was retested when this repository was published.

## Project provenance

Travelly originated as a CS253 group project under Prof. Indranil Saha. This personal repository combines a snapshot of the group's frontend, backend and documentation with the AI itinerary extension; it does not claim sole authorship of the original application.

Original repositories and snapshot bases:

- [CS253/frontend](https://github.com/CS253/frontend), commit `66d2d4bd11ad925841648e012daed3b6994a846f`.
- [CS253/backend](https://github.com/CS253/backend), commit `2ef4ca8dbcc7c9bde64366fc2abb276bddb64d4b`.
- [CS253/documents](https://github.com/CS253/documents), commit `f452e6d081a5bdd057ab2e8527b61e2591f622aa`.

The upstream repositories retain the original contributor history. This repository starts with a combined snapshot and includes the subsequent local implementation changes.
