# Market Atlas · Global Financial Intelligence Terminal

**Personal research desk, not a trading or P&L app.** Follow global events, seven industry catalyst chains, U.S. and A-share daily candles, individual company disclosures, and explainable technical trends — from one screen.

**Mac preview:** https://personal-market-atlas-mac.nzp.workers.dev (moviegoer24 Cloudflare account, D1-backed)
**Original deployment:** https://personal-market-atlas.nzs.workers.dev (different Cloudflare account; **not automatically updated** by Mac deployment)

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

Successful OHLCV responses are persisted as a D1 last-success snapshot. Stale/fallback snapshots carry an explicit notice, provider, fetch timestamp and as-of date. Source rows are normalized, validated and sorted before computing signals.

Before commercial use, negotiate licensed, exchange-entitled data; **do not assume a publicly reachable market API gives redistribution rights**.

## Architecture

- **Frontend:** React + TypeScript + Vite + lightweight-charts, keyboard Cmd/Ctrl+K search, responsive dark UI.
- **Backend:** Cloudflare Worker static assets + API.
- **Durable storage:** Cloudflare D1 tables: intel_events, intel_sector_links, intel_scan_runs, market_snapshots.
- **Cron:** Mac preview scheduled at minute 15 of every hour. Worker pulls multiple RSS/secondary indices and stores real source-linked items; old items update sightings without becoming new events.
- **Security:** no trading execution, no brokerage auth, no private portfolio server-side; all keys are Worker secrets; public article archive only. Watchlist/bookmarks use browser localStorage.
- **Verification:** deterministic analysis tests, ID stability tests, invalid candle rejection, Mac/Wrangler build + actual D1 repeated-ingestion smoke tests.

## Develop on Mac

Requires Node.js 22+ and Wrangler authorization for the intended account.

\`\`\`bash
git clone https://github.com/yaohuangguan/personal-trader-dashboard.git
cd personal-trader-dashboard
npm ci
npm run build
npm test

# Mac D1 already exists; initialize other environments with their own D1 ID.
npm run db:migrate:mac
npm run dev:mac
\`\`\`

Mac staging account's database ID is in \`wrangler.mac.toml\`. The default \`wrangler.toml\` deliberately doesn't reference a cross-account D1. Do not copy that Mac database ID into a Windows-account deployment. Create its own D1 and set the \`DB\` binding there.

To deploy Mac preview:

\`\`\`bash
npm run deploy:mac
\`\`\`

### Secrets

\`\`\`bash
npx wrangler secret put FMP_API_KEY --config wrangler.mac.toml
npx wrangler secret put TWELVE_DATA_API_KEY --config wrangler.mac.toml
npx wrangler secret put SEC_USER_AGENT --config wrangler.mac.toml
# optional: enable the protected manual scan endpoint
npx wrangler secret put INGEST_SECRET --config wrangler.mac.toml
\`\`\`

Use only the secrets you actually need; never check any tokens into Git or print them in logs. **SEC_USER_AGENT** must contain legitimate organization/application identity and contact email. Its omission leaves US official filing features explicitly unavailable.

A private-use dashboard should be placed behind Cloudflare Access before adding any real personal portfolio data or accounts. This repo currently stores no private holdings in the cloud.

### Manual / local verification of ingestion

\`\`\`bash
npm run db:migrate:local:mac
npx wrangler dev --config wrangler.mac.toml --port 8789
curl http://127.0.0.1:8789/cdn-cgi/local/scheduled
curl http://127.0.0.1:8789/api/intelligence/summary
# trigger it again: same articles must have new_events=0
\`\`\`

If an administrator configures \`INGEST_SECRET\`, the cloud-side manual endpoint is \`POST /api/admin/ingest\` with \`Authorization: Bearer <secret>\`. Without a strong secret (24+ bytes), that endpoint remains disabled. Scheduled cron does **not** require the manual secret.

## Methodology and audit standard

- **Five-Line Blossom:** MA5/10/20/60/120 rising, bullish order, last close above MA5, MACD histogram positive. Requires 121+ daily bars. This is a heuristic observation state and not a backtested alpha or win probability.
- **Volume–Price–Time–Space:** 20-day relative volume, MA price structure, days above MA20, 120-day range/breakout and ATR risk context. Each dimension shows evidence instead of a naked buy/sell verdict.
- **News -> Order -> Revenue -> Profit:** media headlines start with evidence stage \`media_lead\`. Primary validation and investment conclusions require human inspection of filings; this version never marks orders or earnings "verified" merely because a story repeats.
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
- For A-share disclosures, the existing Eastmoney document index and text extract remain in-app. PDF attachments load through **same-origin** \`GET /api/announcement-pdf?code=AN...\`; the Worker resolves attachments itself, allowlists \`pdf.dfcfw.com\`, validates magic bytes and enforces a 12 MB limit. No arbitrary fetch URL is accepted.
- Charts are still powered by market-data providers, and fallback TradingView embeds may load third-party resources; application-controlled links do not navigate away. Commercial use requires appropriate market-data redistribution rights.

The site is now an installable **Progressive Web App** (PWA): manifest, installable 192/512 and maskable icons, Apple touch icon, standalone display, service worker precache, offline app-shell support, install instructions, update prompt and offline status. On iOS, use **Safari → Share → Add to Home Screen**. Chrome/Edge desktop and Android may show an install button. An installation is not a native App Store application.

**Offline behavior is intentionally conservative:** UI assets and on-device saved articles are accessible as stored; API calls are \`NetworkOnly\` to ensure the UI does not silently claim stale quotes and articles are live. Opening a detail page with no source-provided excerpt will not manufacture a summary. Chrome third-party widgets and official PDF assets require connectivity.

To test locally, run \`npm run build\` and inspect \`dist/manifest.webmanifest\`, \`dist/sw.js\`, offline service-worker behavior and the \`/api/announcement-pdf\` response. Tests assert that app-owned article elements do not open new tabs.
