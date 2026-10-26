# Pinned stock desk, F10 and background signal monitoring

The stock quote card moves to a sticky right column on desktop. Its order book / news section scrolls independently below it. On narrow screens, the full card stays above the chart and a compact stock identity / price strip sticks below the global toolbar. Factory MA colors follow the reference: MA5 white, MA13 yellow, MA20 pink, MA30 cyan, MA60 green `#8affb7`, MA120 orange, MA144 blue `#728acf`, MA250 purple. Existing untouched factory palettes migrate; custom colors, periods and toggles remain intact.

The market overview adds daily, weekly and monthly index charts, retaining intraday. All use the same MA / VOL / MACD / KDJ component and actual source history. Index values are raw index levels rather than claiming equity adjustment. Sina raw index daily history is an alternative to Tencent and is aggregated only for the requested weekly/monthly periods.

## F10

`GET /api/desk/f10?symbol=...` returns independently available company profile, income statement observations, product/industry/region business composition, and disclosed shareholder counts. Eastmoney PC_HSF10 feeds have an alternate host; financials use the data-center report. Missing sections have separate warnings. Financial figures retain reporting and publication dates; comparisons may be cumulative, with explicit warning against comparing unmatched periods. Business shares and gross margins are source fractions converted to percentages only in the UI. Holder counts are disclosed account statistics, separate from modeled chip concentration. Source company descriptions remain original text.

## Background monitoring

`SignalMonitor` is a SQLite-backed Durable Object, bound as `SIGNAL_MONITOR`. Its alarms, configuration, price baselines, detection IDs, VAPID keys and optional push subscription survive closing the page. No D1, external bot or scheduled workstation is required. It runs only after the owner enables a task; one activation expires after 30 days.

Each browser stores a random 256-bit device capability in localStorage. The server maps it to a private object; all monitor requests require it in Authorization, never in a URL. Cross-origin mutations are rejected. Each device is separate; clearing local storage loses the management capability, so tasks must be paused first when possible. The bounded expiry still prevents indefinite orphan scans. The app does not silently prompt for notification permission or enable tasks.

The default discovery scope is the shared full SH/SZ/BJ universe; see [Shared full-market monitoring](full-market-scanner.md). Optional custom/watchlist scopes accept up to 60 selected equities per device. The UI exposes actual source coverage, prepared history counts, last/next runs and incomplete checks. Each shard prepares at most four missing histories per alarm, with failures rotating through the queue. Preparation and quote scans wait five minutes per round.


During trading hours the server polls about every five minutes, checking source trading date, timestamp freshness, complete OHLCV, stock/benchmark date consistency and prior adjusted close agreement. Raw quote lots/shares are converted to the baseline history unit before analysis. The current quote replaces the unfinished daily candle, using only actual cumulative volume; there is no projected full-day volume. The optional activity filter uses completed historical bars.

Events are separate: provisional intraday candidate, closed-session launch, subsequent confirmed bloom, and confirmed invalidation. They use the user's fixed MA5/10/20/30/60 checklist. The shared guide exposes the current launch condition independently of whichever historical event its checklist displays. Confirmation retains its first known date to prevent repeated alerts on follow-up days 4 and 5. Detection IDs combine security, source trading day, type and launch anchor. Events are persisted before notification delivery; the newest 200 remain in the signal center. No older historical detections are backfilled as new alerts.

The trading schedule uses Asia/Shanghai, skips weekends and lunch, and checks source dates to avoid treating exchange holidays as trading days. Closed-session checks run until 15:30. A fresh quote is required; after close, the allowed age is bounded. Tasks pause outside these windows and retain the next alarm. Source failures are never a neutral score or a generated signal.

## Browser push

The app's service worker imports `/push-worker.js` through Workbox. A readiness message prevents subscribing an older app shell that lacks the push handler. Permission is requested only by `允许浏览器通知`. After permission, the browser creates its subscription with a per-device persistent VAPID public key. The server encrypts notifications with aes128gcm (RFC 8291) and VAPID authentication (RFC 8292), through `@block65/webcrypto-web-push`. Push destinations are restricted to HTTPS browser push providers; redirects are rejected. Expired subscriptions (404/410) are removed.

Same-cycle detections are grouped into a bounded digest. Five-minute TTL / freshness bounds avoid presenting stale intraday detections as fresh notifications. Notification acceptance and failure reasons are stored separately from detection. Service acceptance is not proof of display by the operating system; user permission, browser background availability, connectivity and OS settings affect it. iOS/iPadOS users must open an installed Home Screen web app. Notifications link only to this origin.

The user should enable monitoring, allow notifications and send a test on each intended device. No actual market notification can be verified during a weekend without a real triggering session; deterministic tests cover causal detection, unit conversion, alarm persistence, deduplication, encryption, authorization and source validation. Browser QA verifies real F10/index data, desktop/mobile pinning, background alarms after page closure, pause behavior and the installed push handler.
