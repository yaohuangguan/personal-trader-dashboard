# Market Atlas Architecture and Provenance

## Single production deployment

`wrangler.toml` pins the `personal-market-atlas` Worker to the production Cloudflare account, serving https://personal-market-atlas.nzs.workers.dev. The duplicate Mac Worker was deleted on 2026-10-25. There is no separate OS-specific deployment.

The production configuration currently has no D1 `DB` binding or Cron trigger. Those are prerequisites for persistent event history, last-success quote snapshots and unattended ingestion. News and market queries still work on demand. The retired preview's D1 database remains in its original account and was not migrated or deleted.

## Key infrastructure
1. React UI serves static assets through Workers Assets.
2. Requests `/api/market?symbol=` normalize symbols and try explicit provider priority, checking entitlement/error responses. When DB is configured, preserve validated price bars in D1; fallback only to a last-success snapshot if upstream fails.
3. News queries use Google News RSS, direct BBC/CNBC RSS and GDELT fallback; all notices retain source URL and published time.
4. A configured Cron trigger calls `scanOnce` when DB is available; deduplicated source-linked article data persists in D1. UI history reads from database, **not** the in-memory Worker isolate.
5. Individual company modules read SEC public submissions and XBRL when an authentic SEC contact header is configured, or Eastmoney indexed A-share announcement titles/text/PDF, plus optional FMP earnings calendar.
6. Matching company tokens and industry keywords are deterministic; a news title is not a verified financial catalyst.

## Schema
- `intel_events` — article hash keyed to source, path and normalized headline; original URL, category, published date, first/last observation, sightings and evidence stage.
- `intel_sector_links` — many-to-many article/industry classification with a plain-language keyword/feed rationale.
- `intel_scan_runs` — ingestion timestamp, fresh vs previously-seen count and provider warnings.
- `market_snapshots` — last successful daily OHLCV payload, as-of date, provider, and fetch time.

Data is public research content only; no private holdings or financial accounts in D1.

## Failure semantics
- Authenticated providers (FMP, Twelve Data, Alpha Vantage) can fail by plan entitlement or rate limit, and are not silently treated as exchange data.
- Yahoo/Stooq/Eastmoney can return 429, a bot challenge or empty responses. A-share Tencent public data was empirically observed to yield 500 daily candles; this is not a contractual uptime commitment.
- A saved quote is explicitly marked stale if refreshing fails; initial failures return 502 and an alternate third-party TradingView chart in the UI (without calculating technical signals).
- SEC missing contact header -> structured explanation, no fabricated statements.
- FMP missing calendar key -> `available:false`, not a guessed earnings date.
- Announcement text is from a third-party source. The title and content/PDF are displayed for user verification; simple title-derived tags aren't accounting interpretation.
- News provider failures appear in `warnings` and do not turn into silent zero-impact claims.

## Data flow and audit
```text
Public sources -> source adapters -> normalized, dated articles
      -> stable SHA-256 identity -> D1 upserts and topic links
      -> firstSeen/sightings + scanned status
      -> event history / equity match / sector radar

Price data -> provider validation -> D1 last-success OHLCV
      -> MA 5/10/20/60/120 + independent volume/price/time/space observations
      -> confidence limitations + visible source and timestamp
```

No direct trade actions. No model-generated financial statements or assumed earnings conversion.

## Primary API contracts
- GET `/api/health`
- GET `/api/news?category=all` (latest feed)
- GET `/api/intelligence/summary` (persisted event stats)
- GET `/api/intelligence?category=all&limit=90&new=1` (first-seen history)
- GET `/api/intelligence?symbol=300308.SZ` (deterministic ticker association)
- GET `/api/market?symbol=300308.SZ` (provenance in every payload)
- GET `/api/fundamentals?symbol=NVDA` (SEC XBRL if configured)
- GET `/api/filings?symbol=300308.SZ` (Eastmoney A-share index or SEC filings)
- GET `/api/announcement?code=AN202610081830198767` (validated article code -> text/PDF)
- GET `/api/stock/news?symbol=NVDA`
- GET `/api/earnings-calendar?symbol=NVDA` (FMP, if entitled)
- POST `/api/admin/ingest` (only when INGEST_SECRET is configured; strong bearer authorization)
- A production Cron trigger can call the same ingestion routine after D1 is configured.

## Repeatable ingestion test

With D1 configured, `wrangler dev --test-scheduled` exposes `/cdn-cgi/handler/scheduled` to invoke the scheduled handler locally. A historical ingestion smoke test yielded 90 events on the first scan and `new_events=0` on the same scan repeated. This is validation evidence, not a claim that production currently runs unattended ingestion.

## Known limitations
- No licensed global real-time feed is configured yet.
- D1 snapshot storage is best effort and not a complete historical pricing warehouse.
- Source classification is headline-level. Entity resolution, article translations, event merging across publishers, thesis revision and claim-level evidence are future work.
- Earnings calendar and SEC filing features depend on valid provider credentials/contact entitlements.
- Cross-account production migration requires new D1 provisioning, applying `migrations/`, and no private data copied between accounts without explicit approval.

## PWA, reading rights and bounded document proxy

The UI's news, event-history, bookmark and company-research links now open an in-app React reader without navigating away. It displays publisher-attributed RSS descriptions when supplied; a missing summary is **not** equivalent to knowing the article content. No arbitrary website article is scraped/reprinted. SEC reports may show official textual excerpts when an SEC contact User-Agent is configured.

A-share PDF attachments are resolved from validated announcement codes by the backend; the only allowed PDF origin is `https://pdf.dfcfw.com`. The Worker limits downloads to 12 MiB, verifies a PDF magic signature, sets `Content-Disposition: inline`, and embeds a same-origin `/api/announcement-pdf?code=...` frame. User-provided external URLs are not accepted. Full PDF rendering on iOS depends on built-in WebKit PDF support; source text remains available if the device cannot display the embedded attachment.

Vite PWA builds `dist/manifest.webmanifest`, `dist/sw.js`, app icons and workbox assets. Navigation shell and static bundles are precached; `/api/*` is NetworkOnly, so stale prices cannot be incorrectly surfaced as live market prices. The UI supports install prompts, manual iOS Add to Home Screen guidance, offline labels and update notification. PWA is not an App Store distribution.

D1 schema migration `0002_article_summary.sql` preserves short feed descriptions in archived events and refreshes them on subsequent scans. Existing records without an RSS summary remain accurately marked as unavailable.
