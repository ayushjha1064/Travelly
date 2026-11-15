# Travelly frontend

Existing Flutter / Provider app with Firebase authentication and a shared HTTP API client. Verified with Flutter 3.41.0 / Dart 3.11.0 on web.

## Run

```sh
# From frontend/; preserve existing settings:
test -f .env || cp .env.example .env
flutter pub get
flutter run -d chrome --web-port 8080
```

`.env` must exist because `pubspec.yaml` bundles it. Its only setting is optional public `BASE_URL`. Never add Gemini keys, Firebase Admin private keys or database passwords to this file.

Defaults: `http://localhost:5001/api` for web/iOS simulator/macOS, `http://10.0.2.2:5001/api` for Android emulator. Physical devices need your computer's LAN address. A compile-time override takes priority:

```sh
flutter run -d chrome --web-port 8080 --dart-define=BASE_URL=http://localhost:5001/api
```

The Firebase client configuration is in `lib/firebase_options.dart`. Web now uses your `travelly-77a5a` project. Native platform registrations and FlutterFire CLI metadata still reference the original group project; register those apps separately before testing native targets. Backend Firebase credentials and a signed-in account are required for trip APIs. Native builds also need Xcode/CocoaPods or Android SDK and matching platform Firebase configuration.

## AI itinerary

Open a trip dashboard → **Generate AI Itinerary**. Destination, dates, currency and group size are reused. Optionally enter a group activity budget and interests. Generate and inspect the day-wise plan; reopen to load its saved shared copy. Regeneration replaces that copy; failures preserve it. The backend needs `GEMINI_API_KEY`.

The new screen uses a small feature service, typed response models and the existing `ApiClient`. Loading/error state is local to the screen; the existing Provider architecture is preserved.

```sh
flutter analyze
flutter test
flutter build web
```

Tests mock Firebase/platform and HTTP boundaries. They do not prove a live Firebase/Gemini round trip. See `../documents/AI_ITINERARY_REPORT.md` for the full verification report and temporary toolchain paths.
