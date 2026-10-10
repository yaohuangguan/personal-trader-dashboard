# Architecture and data provenance

## Data trust levels
1. SEC XBRL: official primary issuer disclosure, normalized with caveats.
2. RSS indexed headlines: source-linked leads only; no implication of verification.
3. Stooq / Eastmoney history: publicly available non-SLA daily OHLCV. Eastmoney is unofficial. Both may fail or lack permissions for commercialization.
4. Heuristic technical analysis: deterministic, derived from OHLCV. Not a forecast.

Every market payload includes: exchange, currency, candles, asOf, delayed=true, provider, sourceUrl and notice.
Every news payload includes: source, original URL, publishedAt, fetchedAt, lane, warnings. The browser never shows placeholder price/news fixtures.

## Routes
GET /api/health
GET /api/catalog
GET /api/search?q=NVDA
GET /api/market?symbol=NVDA
GET /api/market?symbol=300308.SZ
GET /api/news?category=all
GET /api/news?category=ai-hardware
GET /api/fundamentals?symbol=AAPL

## Security & reliability
- Only public GET endpoints. Watchlist and bookmarks are local-only.
- User-input ticker is constrained to a short validated alphabet; upstream hosts are fixed by application code.
- Long external requests have explicit timeouts. API errors are emitted as JSON with a 502 status.
- In-isolate TTL caching reduces repeat calls, but is not a persistent background historical database.
- No keys sent in browser bundles or URL output; Twelve Data key used only by worker.
- Restrict production dashboard with Cloudflare Access for a private deployment.
- API abuse protection, durable caches, licensed exchange data and observability are required before public multi-user release.

## Future durable architecture
Worker cron -> source adapters -> normalized events -> D1 event table (dedup, revision history, evidence URI, review state) -> alert selection -> secure delivery. Quote snapshot storage and durable user accounts are purposefully not claimed to exist in v1.
