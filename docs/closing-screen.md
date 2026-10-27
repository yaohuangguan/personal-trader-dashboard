# Shared closing screen

The production Durable Object exports now point to `CloseCoordinator` and `CloseSignalMonitor`, retaining existing object IDs, VAPID keys and browser subscriptions. Old shard alarms retire themselves without market requests; historical records stay available in storage. Legacy enabled device alarms migrate to the daily schedule on their next wake. The previous intraday classes remain as unexported reference implementations; they are not deployed as production DO classes.

GitHub Actions `.github/workflows/close-screen.yml` starts at 07:20 UTC on weekdays (15:20 Asia/Shanghai). A date-checked Shanghai index snapshot verifies that a current trading session exists; weekends and holidays do not publish a new close. Actions schedules can run late. One shared report is computed, then each enabled device receives at most one successful digest per trade date, including zero qualifying candidates. A source outage is reported as unavailable evidence. Closing notification retries do not rescan quotes. Existing notification delivery still depends on browser/PWA permission; native push credentials remain unconfigured.

The daily job authenticates to the worker with `SCREEN_JOB_TOKEN`, configured separately as a GitHub Actions secret and Wrangler secret. It publishes bounded candidate chunks, then an atomic manifest. Public reads use `/api/desk/close-report`; the publish route is server-only. Historical analyses are in the private Actions cache (never source commits); the public repository contains code, not device tokens. Generated candidate report artifacts are ordinary public market observations.

## Performance

Cheap traded-value filtering (>=CNY200m) precedes history requests. Quotes use batches of 60; daily histories have bounded concurrency 8; frontend manual verification has bounded concurrency 4. There is no former per-symbol 900ms sleep. The daily job persists up to 500 adjusted candles in Actions cache and requests only three recent bars when possible. Overlap changes or missing overlap force a full refresh to avoid stale corporate-action adjustments. Raw daily bars verify recent closing-limit estimates. Guide analysis is reused for pattern checks; stock-character and chip computations occur only after a pattern/setup match. Subsequent clients reuse the shared results and filter/rank locally instead of fetching every stock again.

This is bounded parallelism, fewer network round trips and incremental caching, not an exponential-complexity improvement. A cold full-market pass remains source-dependent. Every result carries the actual date and source failures remain separate from pattern rejections.

## Ranking

Automatic mode evaluates independent patterns and early price/volume setups; it does not require all patterns to coincide. Composite priority: price/volume support 30, highest matching pattern 30 (correlated matches are not added together), historical activity 20, chip concentration 20. Quiet / weak-follow-through stocks cap at49 when activity filtering is disabled. All modes retain the >=CNY200m floor, chip concentration<20%, and the tighter multi-MA-breakout<15% gate. The default market-cap cap is CNY100bn and is adjustable. Score reasons and source-model limitations are displayed; this is not a calibrated return probability.

## Watch and chart context

Visible A-share watch rows load `/api/desk/insight`, with per-source caching and a 60-second foreground refresh. Daily strength and five-line advice are separate and dated; stale history is not labeled today. Daily structure uses MA5/10/20/30/60, with explicit bullish/bearish alignment, mixed alignment, correction or range criteria. Price/volume direction is labeled in words plus restrained red/green/neutral color. Intraday cumulative volume is not treated as completed daily volume. Chart crossover markers now explicitly say 买 / 卖 and remain distinguishable from the stricter guide confirmation markers. Intraday VOL uses observed incremental minute volume.
