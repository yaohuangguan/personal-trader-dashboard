# Individual-security workspace

The default landing view is the stock workspace. A `?symbol=300545.SZ` link opens that stock directly; later selections persist in the current browser. Existing watchlists, bookmarks and chart MA settings are preserved.

The interface uses neutral black surfaces and Radix Tabs, Dialog and Tooltip primitives. The center prioritizes the selected security and its chart, with watchlists at left and public order-book snapshots and news at right. Smaller screens move the watchlist to a horizontal strip and stack the detail panels.

## Data adapters

Public HTTP adapters are ported from the reviewed examples in [a-stock-data](https://github.com/simonlin1212/a-stock-data), rather than attempting to execute a Markdown/Python skill inside a TypeScript Worker. Apache-2.0 attribution and the upstream license are in `docs/third-party/`.

| Endpoint | Provider | Returned data |
| --- | --- | --- |
| `/api/desk/quotes?symbols=...` | Tencent | Batch public snapshots, source timestamps, five bid/ask levels, valuation and turnover fields |
| `/api/desk/intraday?symbol=...` | Tencent | Dated minute prices and cumulative volume, converted into interval volume |
| `/api/desk/history?symbol=...&period=week` | Tencent | Forward-adjusted weekly/monthly candles |
| `/api/desk/ticks?symbol=...` | Tencent | Most recent page of aggregated transactions; source date and partial-history flag |
| `/api/desk/sectors?symbol=...` | Eastmoney | Reported industry/concept/region memberships |
| `/api/desk/peers?code=BK...` | Eastmoney | A sector's leading members, changes and estimated main fund flow |
| `/api/desk/ranks` | Eastmoney | Top 20 industries by reported daily change |
| `/api/desk/flow?symbol=...` | Eastmoney | Reported intraday fund-flow estimates by trade size |
| `/api/desk/stock-news?symbol=...` | Eastmoney | Company-code news search results with attributed excerpts |
| `/api/desk/reports?symbol=...` | Eastmoney | Research report titles, publication dates, institutions and source ratings |
| `/api/desk/flash` | CLS / Wallstreetcn | Deduplicated, attributed 7×24 financial news feed |

The existing daily history, filings, in-app PDF reading and SEC interfaces remain available. Raw news text is not converted into claimed orders or financial results.

## Freshness and limitations

- Public five-level snapshots and roughly three-second transaction aggregates are **not licensed exchange Level-2**. Ten-level depth, order queues and exchange tick-by-tick streams require a separate authorized provider. API payloads explicitly return `level2: false`.
- Snapshots poll every five seconds during reported trading hours and every 30 seconds after close. News polls every 60 seconds; time displays use Beijing time and preserve source timestamps.
- Automatic client requests pause while the page is hidden or offline. Manual refresh remains available when automatic refresh is paused. This does not install a server notification or background monitoring service.
- The session indicator checks weekday and Beijing trading-time windows, then checks the source timestamp for stale data. It is not a substitute for an exchange holiday calendar.
- Price reminders are stored in the browser, trigger once while the page is open, and require a fresh trading-session snapshot. Historical/closed-session or failed-refresh data cannot trigger a reminder. No brokerage actions or external messages are sent.
- Eastmoney requests are paced within each Worker instance. Timeouts and partial provider outages are surfaced as unavailable data, rather than fabricated zero values. Batch quote size is bounded. Sector lists fall back to the upstream documented `push2delay` service when the primary list host fails; those results explicitly carry an approximately 15-minute delay label and their actual source URL.
- Sector memberships combine industries, concepts and regions as returned by the source. Relative performance versus CSI 300 is shown only when both snapshot dates match.
- Provider coverage varies by market. The public intraday/order-book integrations target Chinese securities; existing US historical providers remain in place. Unsupported data stays unavailable.
- “7×24” describes the source feed. The current production site does not yet archive every item in D1 or send notifications while the browser is closed.

`nodejs_compat` enables the locally computed CLS public signing hash through the supported Workers `node:crypto` API. No financial-provider API key is introduced by these adapters.
