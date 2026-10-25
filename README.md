# Market Atlas · Global Financial Intelligence Terminal

**Personal research desk, not a trading or P&L app.** Follow global events, seven industry catalyst chains, U.S. and A-share daily candles, individual company disclosures, and explainable technical trends — from one screen.

**Production:** https://personal-market-atlas.nzs.workers.dev

This is the only supported deployment. `wrangler.toml` pins the production Worker and Cloudflare account.

## What is implemented

| Workspace | Capabilities | Data limitations |
|---|---|---|
| Intelligence overview | Global macro + sector RSS, original links, source dates, cross-asset ticker tape, 24h new-event stats | RSS may be blocked; sources fall back to BBC/CNBC/GDELT. Headline does not verify a thesis. |
| Event history | D1-backed deduplicated article keys; first seen, last seen, sightings, topic and deterministic ticker/sector matches; 24h filters | Classification is based on feed topic/headline keywords, not an AI-confirmed business relationship. |
| Catalyst radar | Seven sector lines, related companies, news/timeline navigation | Revenue, orders and margins are **not** inferred from media headlines. |
| Markets | Browser-local watchlists; A-share OHLCV; U.S. fallback TradingView official embed | Unlicensed endpoints can rate-limit; quotes are never represented as real-time exchange feeds. |
| Individual stock | Actual 5/10/20/60/120 MA analysis, volume/price/time/space, MACD, RSI, ATR; primary disclosure timeline; news/event links | Full technical analysis requires >=121 valid historical candles. |
| A-share announcements | Eastmoney index titles/dates/categories; fetch original indexed notice body and PDF link on demand; title-keyword event tags; CNINFO official verification link | Third-party index can fail. Extracted text and tags are **not** audited or financial statement extraction. |
| US filings | SEC EDGAR official 10-K/10-Q/8-K list and XBRL annual revenue / income when SEC_USER_AGENT is configured | Filing dates are historical, not earnings predictions. |
| Earnings calendar | Scheduled and reported EPS/date via optional authorized FMP account | With no entitlement, the UI explicitly says unavailable rather than guessing dates. |

## Data provider priority

1. Financial Modeling Prep **stable EOD full** (requires key and allowed symbol entitlement).
2. Twelve Data daily historical bars (optional key).
3. Alpha Vantage daily (optional key; free plan usually only ~100 candles, which is not enough for the 121-bar technical model).
4. For **A shares**, the Tencent public historical API, with ~500 forward-adjusted daily candles during current testing; labels identify the feed as unofficial/unlicensed and not guaranteed for future uptime.
5. Yahoo chart (best effort, currently returns 429 from Mac for tested US stocks), Stooq, Eastmoney fallback.
6. When raw OHLCV is unavailable, official TradingView embeds still provide a reference chart; the local Five-Line model does **not** fabricate a score.

When a D1 `DB` binding is configured, successful OHLCV responses are persisted as a last-success snapshot. The current production configuration has no D1 binding. Stale/fallback snapshots carry an explicit notice, provider, fetch timestamp and as-of date. Source rows are normalized, validated and sorted before computing signals.

Before commercial use, negotiate licensed, exchange-entitled data; **do not assume a publicly reachable market API gives redistribution rights**.

## Architecture

- **Frontend:** React + TypeScript + Vite + lightweight-charts, keyboard Cmd/Ctrl+K search, responsive dark UI.
- **Backend:** Cloudflare Worker static assets + API.
- **Optional durable storage:** Cloudflare D1 tables: intel_events, intel_sector_links, intel_scan_runs, market_snapshots.
- **Scheduled ingestion:** available when a production D1 DB binding and Cron trigger are configured. Neither is currently configured in production; latest news and market queries remain available on demand.
- **Security:** no trading execution, no brokerage auth, no private portfolio server-side; all keys are Worker secrets; public article archive only. Watchlist/bookmarks use browser localStorage.
- **Verification:** deterministic analysis tests, ID stability tests, invalid candle rejection, Wrangler build + historical D1 repeated-ingestion smoke tests.

## Develop and deploy

Requires Node.js 22+ on Windows, macOS or Linux.

```bash
git clone https://github.com/yaohuangguan/personal-trader-dashboard.git
cd personal-trader-dashboard
npm ci
npm test
npm run dev
```

Deploy the single production Worker:

```bash
npx wrangler login
npx wrangler whoami
npm run deploy
```

The account pinned in `wrangler.toml` owns `personal-market-atlas.nzs.workers.dev`. Use a login with access to that account on every computer. The separate Mac preview Worker was retired on 2026-10-25; its deployment config and npm scripts have been removed.

### Secrets

Configure only the features you need:

```bash
npx wrangler secret put FMP_API_KEY
npx wrangler secret put TWELVE_DATA_API_KEY
npx wrangler secret put SEC_USER_AGENT
# Optional protected manual ingestion endpoint, after configuring D1:
npx wrangler secret put INGEST_SECRET
```

Keep credentials out of Git and logs. `SEC_USER_AGENT` must contain legitimate application identity and a contact email.

### Optional event archive

Create a D1 database in the production account and add its `DB` binding to `wrangler.toml` before applying `migrations/` or enabling scheduled ingestion. The retired preview's database belongs to another account and is not a production binding. Its data has not been migrated or deleted.

When a D1 binding and a local database are configured, run `npx wrangler dev --test-scheduled`, invoke `/cdn-cgi/handler/scheduled`, and verify `/api/intelligence/summary`. Repeating an unchanged scan should add no new events. The cloud manual endpoint is `POST /api/admin/ingest`; it requires `INGEST_SECRET` and bearer authorization.

## Methodology and audit standard

- **Five-Line Blossom:** MA5/10/20/60/120 rising, bullish order, last close above MA5, MACD histogram positive. Requires 121+ daily bars. This is a heuristic observation state and not a backtested alpha or win probability.
- **Volume–Price–Time–Space:** 20-day relative volume, MA price structure, days above MA20, 120-day range/breakout and ATR risk context. Each dimension shows evidence instead of a naked buy/sell verdict.
- **News -> Order -> Revenue -> Profit:** media headlines start with evidence stage `media_lead`. Primary validation and investment conclusions require human inspection of filings; this version never marks orders or earnings "verified" merely because a story repeats.
- **Historical truth:** source URLs, timestamps, observed dates, provider labels and feed warnings remain visible. Missing data is labeled, not replaced with demos.

## Next engineering decisions

1. For dependable U.S. and commercial A-share analysis: activate a licensed FMP/Twelve Data/EODHD or equivalent feed with >=121 historical bars and sufficient exchange rights.
2. For complete A-share financial statements: add an authorized structured filing feed and accounting-period parsing, rather than infer revenue from notice titles.
3. For richer catalyst reasoning: add structured thesis hypotheses, source attachments, manual verification and a change-detection graph beyond headline similarity.

This is a personal information and research system, **not investment advice, predictive trading or trade execution**.

## In-app reading and installable PWA

Market Atlas now uses an integrated reader rather than opening an external website when a user taps a headline or disclosure record.

- News headlines, bookmarks, company news and historical event timelines all open the **same site-local reader** with publisher/source attribution, timestamp and source-provided RSS excerpt. The source may not license full-text redistribution: when the source provides no synopsis, the reader **plainly states that no content is available** instead of silently fetching and republishing a copyrighted article.
- For US corporate filings, the app can retrieve short HTML/text extracts from a validated SEC filing document matching the official submission index, with the SEC User-Agent configured. Report typography/tables may be incomplete. When the contact header is missing, the reader displays an unavailability explanation.
- For A-share disclosures, the existing Eastmoney document index and text extract remain in-app. PDF attachments load through **same-origin** `GET /api/announcement-pdf?code=AN...`; the Worker resolves attachments itself, allowlists `pdf.dfcfw.com`, validates magic bytes and enforces a 12 MB limit. No arbitrary fetch URL is accepted.
- Charts are still powered by market-data providers, and fallback TradingView embeds may load third-party resources; application-controlled links do not navigate away. Commercial use requires appropriate market-data redistribution rights.

The site is now an installable **Progressive Web App** (PWA): manifest, installable 192/512 and maskable icons, Apple touch icon, standalone display, service worker precache, offline app-shell support, install instructions, update prompt and offline status. On iOS, use **Safari → Share → Add to Home Screen**. Chrome/Edge desktop and Android may show an install button. An installation is not a native App Store application.

**Offline behavior is intentionally conservative:** UI assets and on-device saved articles are accessible as stored; API calls are `NetworkOnly` to ensure the UI does not silently claim stale quotes and articles are live. Opening a detail page with no source-provided excerpt will not manufacture a summary. Chrome third-party widgets and official PDF assets require connectivity.

To test locally, run `npm run build` and inspect `dist/manifest.webmanifest`, `dist/sw.js`, offline service-worker behavior and the `/api/announcement-pdf` response. Tests assert that app-owned article elements do not open new tabs.

## Configurable chart terminal

All symbols with valid OHLCV data share the same chart component; it is independent of the built-in example catalog.

- Default moving averages: MA5 / MA13 / MA20 / MA30 / MA60 / MA120 / MA144 / MA250. Each period, color and visibility can be changed; settings persist in the current browser.
- Separate, synchronized VOL (MA5/20), MACD (12/26/9) and KDJ (9/3/3) panels. MACD histogram is 2 × (DIF − DEA); KDJ uses recursive smoothing seeded at 50, retaining J outside 0–100.
- Main candles and volume use red for up and teal for down. Date presets, pan/zoom, expanded view and crosshairs are linked across panels.
- Averages are computed on the complete provider history before applying the visible date range. A newly listed symbol can display a partial history while long-period averages remain unavailable.
- Cross markers use the two shortest enabled periods. An expansion marker requires all enabled periods in bullish order, higher averages than five sessions earlier, close above the shortest average and positive MACD histogram. It marks the first qualifying session. The separate existing Five-Line analysis model still uses MA5/10/20/60/120.
- Public Chinese-market code/name search supplements the local catalog. Shanghai ETF, explicit exchange/index prefixes and Beijing symbol normalization are recognized. Actual coverage and history remain dependent on the configured provider; no missing candles or averages are synthesized.
