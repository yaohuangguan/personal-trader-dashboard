# Market Atlas mobile

Android / iOS Flutter client for the existing Market Atlas production API. This is a native Material 3 interface, not a WebView wrapper. Default API: https://personal-market-atlas.nzs.workers.dev.

## Run

Use Flutter **3.47.5 / Dart 3.13.4**, then:

```sh
cd mobile
flutter pub get
flutter run
flutter build apk --release
# On macOS with Xcode:
flutter build ios --release --no-codesign
```

For a different deployed service, add `--dart-define=ATLAS_API_BASE=https://your-worker.example`. Use HTTPS on physical devices. `html` is pinned to 0.15.6 because flutter_html 3.0.0 depends on its selector compatibility API. Commit pubspec.lock for reproducible app builds.

## Pages and mobile interactions

| Web workspace | Native interface |
| --- | --- |
| Stock workspace / watchlist | Watch tab; swipe to remove, hold to move first, search by name or code. Stock detail uses a pinned name/price header and horizontal context tabs. |
| Candles | Native canvas: daily/weekly/monthly, 8 editable MA periods/colors/toggles, volume, MACD, KDJ, crosshair, pinch zoom, pan, fullscreen and dated guide events. |
| Intraday / order book | Public minute chart, five-level book, recent aggregated ticks and attributed flow. No licensed L2 claim. |
| Five MA guide | Shared `/api/analysis` rules, stock character, original checklist, confirmation/invalidations, weekly/monthly resonance, evidence and risk conditions. |
| Chips | Historical-turnover cost model, 70%/90% ranges, concentration, profit share, initial-seed remainder; fixed-latest-float fallback is labeled. |
| Stock evidence | Company news, report index, F10 profile/business/financial periods/holders, announcement reader/PDF, earnings calendar, intelligence archive. |
| Market | Major-index intraday/daily/weekly/monthly, sector gain ranking, stock gainers, Dragon/Tiger disclosures, yesterday limit-up and today's limit-up pools, disclosed sentiment formula. |
| Screener | Quick sample, full-market and watch scopes; pause/resume persistence, character/ST filters, stage/risk/name filters, CSV sharing, selected candidate monitor import. |
| Sector outlook | Market environment, full industry breadth and coverage, participation, continuation/invalidation conditions. No fabricated probability. |
| Signal center | Defaults to all-market server scanner, coverage/warmup/failures/source dates, optional selected lists, on/off/renew, event details and native push hook. |
| News / research | 7x24 feed, source/importance/topic filters, original-source reader, bookmarks, global overview, seven industry chains, archived events. |
| Settings | Chinese/English, 18/20/22 text sizes plus system scaling, watchlist import/export, foreground price reminders. |

Phone uses bottom navigation, sheets and push/pop details. Wider screens use a navigation rail. Data, bookmarks, preferences and foreground scan progress are stored on the device, independently of the web app. Server signal scanning continues without the app open; the foreground screener pauses when the app is inactive. Missing sources, unconfigured archives and unsupported market coverage remain explicit.

## Native push (reserved, not enabled by default)

No Firebase project is included. The default app does not initialize Firebase, request notification permission, or promise closed-app notification delivery. Existing website/PWA Web Push remains available through its original page.

After creating a Firebase project:

1. Register Android `space.ps6.market_atlas` and iOS `space.ps6.marketAtlas`. Configure the Firebase app and enable Cloud Messaging HTTP v1. For iOS, upload your APNs authentication key to Firebase and enable Push Notifications for the signed app's App ID / Xcode target. Add the matching `aps-environment` entitlement through Xcode signing; no production signing entitlement or account is fabricated here. Background remote-notification mode is already declared.
2. Build with `--dart-define=FIREBASE_PROJECT_ID=... --dart-define=FIREBASE_APP_ID=... --dart-define=FIREBASE_API_KEY=... --dart-define=FIREBASE_SENDER_ID=...`. Use the platform-specific app ID. Client Firebase identifiers are public app configuration; never put the service-account private key in Dart defines or the app bundle.
3. Grant a service account only the required Firebase Cloud Messaging sending role. Store its JSON **only** as the Worker secret `FIREBASE_SERVICE_ACCOUNT` using `npx wrangler secret put FIREBASE_SERVICE_ACCOUNT`. The server obtains a short-lived OAuth token and sends FCM HTTP v1 messages. It never returns that secret to the app.
4. Open Signals and choose Allow app notifications. The app checks server capability before requesting system permission, registers its device token under its random private device capability, handles token refresh, foreground notifications and notification deep links. Test with a real Android/iOS device and a signed APNs-enabled iOS build.

Android INTERNET / POST_NOTIFICATIONS, notification channel and Java desugaring are configured. Firebase auto-init is disabled in both platform manifests until the user opts in. Native push transport has mock contract tests; end-to-end native delivery requires the real Firebase/APNs configuration above.

## Validation and distribution

```sh
flutter analyze
flutter test
flutter build web --release
```

The mobile GitHub Actions workflow validates formatting, analysis and tests, builds a release APK and builds the iOS app without code signing. Android preview APK uses the generated debug signing key and is for sideload testing; configure your own stable signing key before store distribution. The unsigned iOS `.app` archive validates compilation and cannot be installed directly or submitted to the App Store. Distribution needs Apple signing / provisioning and an archive export, or TestFlight.
