# Market Atlas · Personal Financial Intelligence Terminal

> **A research desk, not a P&L dashboard.** Global finance and geopolitical news, seven catalyst chains, daily U.S. and Chinese equity charts, company fundamentals, and explainable Five-Line Blossom + Volume-Price-Time-Space research.

[![CI](https://github.com/yaohuangguan/personal-trader-dashboard/actions/workflows/ci.yml/badge.svg)](https://github.com/yaohuangguan/personal-trader-dashboard/actions/workflows/ci.yml)

## What works now

- **Global event feed**: nine English-language Google News RSS queries spanning geopolitics, macro and the seven monitored industries. Fetch errors and source timestamps are visible. Original articles open in a new tab.
- **Seven-sector catalyst desk**: AI hardware, AI software/applications, robotics, innovative medicine, commercial space, energy storage/new energy and consumer. Source-linked headlines are *unverified research leads*, not earnings confirmation.
- **US and China equity watchlist**: search by common name, ticker, or 6-digit A-share code; follow up to 30 tickers, persisted in browser localStorage.
- **Historical OHLCV charts**: the app attempts permitted daily feeds and supports optional **Twelve Data / Alpha Vantage** API keys. Both keyless feeds failed in an actual 2026-10-10 smoke test (Stooq served a browser challenge, Eastmoney returned null). The UI therefore falls back to an **official TradingView embedded chart**, but does **not** fabricate raw candles or run the technical model without valid OHLCV. A cross-asset ticker tape is embedded separately.
- **Explainable technical research**: MA5/10/20/60/120, MA slopes, bullish ordering, RSI14, MACD, 20-day relative volume, trend persistence, 120-day range position and ATR. Separate scoring dimensions and cautionary notes.
- **Fundamentals**: official SEC XBRL companyfacts annual revenue and net income for U.S. issuers once SEC_USER_AGENT is configured. A-share users are linked to official CNINFO reports; structured Chinese financial statements are **not** claimed to be integrated.
- **Keyboard-centric UX**: Ctrl/Cmd+K or / to search, a responsive terminal layout, local-only bookmarks, quick navigation, and real provider errors.

## Getting started

Requires Node.js 20.18+ or Node.js 22+.

\`\`\`bash
npm install
npm run dev
\`\`\`

Vite runs at http://localhost:5173 and proxies /api to the Cloudflare Worker on http://localhost:8787. The first dev command builds static assets for Wrangler. Run tests / CI checks with:

\`\`\`bash
npm test
npm run build
\`\`\`

To deploy to your own Cloudflare account:

\`\`\`bash
npx wrangler login
npx wrangler secret put SEC_USER_AGENT
# optional licensed data source
npx wrangler secret put TWELVE_DATA_API_KEY
# or: npx wrangler secret put ALPHA_VANTAGE_API_KEY
npm run deploy
\`\`\`

Choose an appropriate, **real contact email** in the SEC User-Agent value. Never commit API keys or SEC contact information in source control. Restrict private deployments using **Cloudflare Access** before adding personal portfolio information.

## Architecture

- React + TypeScript + Vite frontend
- Cloudflare Worker API, alongside Workers Static Assets
- Browser localStorage: followed tickers and saved articles. No broker authentication, trading, custody or portfolio holdings on the server.
- External data gateways are isolated in src/worker/index.ts, with short-lived isolate caching. API payloads include original provider and timestamps.

## Research model

**Five-Line Blossom** is a configurable *observation framework*, not a backtested predictor. Version 1 uses moving averages **5/10/20/60/120**: bullish order and positive 5-day slopes; above MA5 and MACD positive dynamics are required for the stronger 'blossom' flag. Full classification requires at least 121 daily candles.

**Volume-Price-Time-Space** separates relative trading volume, MA price structure, how long the instrument remained above MA20, and position within the recent 120-day trading range. The four components form an **explainable heuristic observation score**, not an expected-return or win-probability estimate. The thresholds are research defaults, not optimized parameters.

The catalyst framework keeps **headline / rumor**, **order confirmation**, **revenue accounting** and **profit realization** separate. The news feed provides headlines only, so its stage remains 'unverified lead' without original source verification. U.S. leader signals and potential A-share peers are watchlists, not an assertion of direct commercial exposure.

## Transparency and limitations

1. **No simulated prices or manufactured news.** Missing providers produce visible unavailable states.
2. **Not real-time exchange data.** Free sources expose daily OHLCV, and may have weekends, holidays, restrictions, outages, adjustment differences, and missing instruments. Do not place orders from these figures.
3. Both keyless feeds proved unreliable under smoke testing; source restrictions and upstream changes are outside this repository's control. Before dependable use, configure a licensed, contractually permitted provider. The optional Twelve Data feed may be rate-limited or require higher tiers for specific exchanges. Alpha Vantage free daily data commonly offers only 100 bars, fewer than our 121-bar five-line minimum. TradingView official embeds can display charts even when model data is missing.
4. Google News is a headline index, not source verification, truth ranking or guaranteed comprehensive coverage. Source timestamps and link resolution can vary.
5. SEC XBRL does not provide a normalized restated data warehouse; chart values must be checked against original 10-K filings. A-share financial statements currently link out to CNINFO.
6. News/bookmarks/watchlist are stored in the active browser, not synced between devices. Scheduled cloud-side alerts, durable event memory, broker integrations, research notes and push notifications are future work.
7. **Investment research only. Not advice, prediction or trade execution.**

## Next milestones

- Licensed A-share and U.S. providers, earnings calendar and company profiles
- Persisted news/event clusters, direct evidence links, revision tracking, source reputation
- Durable alerting, custom thesis rules, deduplicated catalyst history
- Portfolio CSV import, optional Cloudflare D1 + Access-protected account sync
- Quant research tests for trend thresholds, benchmark comparison and look-ahead bias
