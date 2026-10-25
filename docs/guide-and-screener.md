# Guide-driven analysis and screening

The individual-stock core follows the user's [姚记五线开花 v10.4](https://trade.ps6.space/), reviewed on 2026-10-25. The guide site itself is not modified. The previous MA5/10/20/60/120 score remains only as a legacy tested module; the stock workspace, overview and watchlist now use the guide engine without an invented probability or score.

## Rule correspondence

| Guide section | Implemented observation |
| --- | --- |
| 02 / 03 | Fixed core MA5/10/20/30/60; prior adhesion, bullish body, gain over 5%, volume over twice the preceding adhesion-period mean, close above MA60, MA30/60 no longer materially falling, body crossing all five lines and close near the high |
| 03 calculator | `(max(MAs) - min(MAs)) / min(MAs) * 100`; strictly below 2/5/10 percent gives extreme/tight/loose adhesion |
| 02 follow-through | A launch is pending until at least three subsequent completed daily bars; through bar five the low must hold the launch-body midpoint and the five MAs must reach bullish order. The strict low-based midpoint test is visible in the method details. |
| 04 / 23 | BIAS60 above 20%, closes below MA5/MA20, loss of launch low and 7–10-bar failure to move above the launch close are separate review flags |
| 05 | MACD, KDJ and BBI observations; KDJ J above 100 is not automatically an exit, while a drop from at least 80 to below 80 is separately flagged |
| 14 | Completed weekly 5/10 cross with 30/60 flat/adhesion context, and adjacent completed monthly breakout/retest of MA30 |
| 23 | A pullback candidate requires two falling closes and shrinking positive volumes, lows holding MA10, rising/nonfalling MA5/10, bullish order and BIAS60 between 0 and 10% |

The guide's qualitative wording needs explicit parameters for computation. Defaults are: five consecutive preceding adhesion bars, at most 20 baseline bars, five-bar MA slope tolerance of -0.1%, a close in the top 10% of the daily range, and a cluster midpoint within 25% of the bullish body's midpoint. Midpoint placement is a preference, rather than a mandatory gate. Weekly crosses are observed within five completed weeks. These are disclosed implementation choices, rather than attributed verbatim thresholds from the guide.

Core history requires 65 valid daily bars; MA120/250 remain unavailable until warmed up. Invalid/duplicate OHLCV is rejected. Future dates are excluded, current unfinished daily bars remain provisional, current unfinished weeks and the current calendar month are excluded from cycle confirmation. Prefix tests verify that later bars cannot create an earlier confirmation.

The chart retains the user's eight adjustable MA defaults (5/13/20/30/60/120/144/250). Its generic crossing/expansion markers remain distinct from fixed-guide launch/confirmation/failure markers. The guide's unverified win-rate, institutional-identity and physical-law claims are not presented as measured facts. Chip concentration, exchange tick orders and queues remain unverified when their required source data is missing.

## Screener

The `五线选股器` workspace provides:

- **Quick sample:** reads the source's entire paginated securities universe, then inspects at most 200 names: up to 100 relatively flat names plus stronger names, with an optional 200 million CNY turnover prefilter. This is explicitly a sample, rather than an exhaustive full-market result.
- **Deep source-universe scan:** processes every valid source-listed security after the selected ST/name exclusion. The quick turnover prefilter does not silently restrict this mode.
- **Watchlist:** scans the browser's Chinese watchlist, preserving the existing stock research entry for other markets.

Sina's dynamic `hs_a` universe was verified to return Shanghai, Shenzhen and Beijing symbols. Pagination uses the actual source page ending, rather than assuming a registration count is perfectly current. Differences between the reported count and records read remain visible. A public source's universe is not represented as an independently reconciled exchange master list.

Potential adhesion candidates use the guide's tight range below 5%; strict launch formation still requires the preceding extreme range below 2%. Candidates retain stage, reasons, source, history date, missing conditions and risk flags. Zero-volume histories do not produce candidates. Stale/provider-marked or over-seven-day-old histories are recorded as incomplete rather than current opportunities. For Shanghai/Shenzhen symbols when Tencent history fails, raw Sina daily OHLC is divided by the independently fetched factor effective on each candle date; factor payloads are parsed as JSON data, including their trailing signature comments, without executing scripts. Volumes retain their original share units. The Beijing fallback is explicitly **unadjusted** Sina daily history, and its corporate-action/MA limitation is carried into candidate risks.

Scanning is initiated by the user and runs while the app page remains visible. Navigating to individual stocks inside the app preserves the running scanner and displays a compact progress indicator. Universe requests and historical requests are paced; shape calculations run in a separate Web Worker. Hiding the browser page or going offline pauses scanning; a full app reload restores paused progress. IndexedDB stores versioned progress and compact results for resume, including across reloads; raw candle histories are not accumulated in browser storage. Results are paginated and can be exported to CSV. Sources can fail or rate-limit, and those symbols remain a separate incomplete list with reasons. Five consecutive history failures pause the run with saved progress. The time estimate excludes universe-loading time. No result count, source outage or empty filter is replaced with demonstration candidates.

This deployment does not yet run an unattended full-market scheduled service while the browser is closed. Full scans may take substantial time at public-source request rates; the UI estimates remaining time from observed progress.

## Sector outlook

The outlook separates three kinds of evidence:

1. **天时:** dated Tencent major-index snapshots and their freshness/session state.
2. **地利:** independently classified Sina industries and constituent breadth, including active up/down/flat counts, median change, turnover and leader concentration.
3. **人和:** participation, the selected stock's source-estimated fund flow when available, and attributable news headlines matching a disclosed industry keyword dictionary or leading company names. Name matches are labeled leads, not verified catalysts or business effects.

The industry constituent adapter fetches pages in symbol order, with an 800-record safety bound. It never estimates whole-industry breadth from the previous top-16-gainers table. Pagination must reach an actual source page ending; an overall conclusion additionally requires the observed unique member count to equal the provider's registered count; missing or extra records leave scope unresolved. All actual sample statistics and count differences remain visible. Sina's industry payload lacks a trading date, so temporal alignment with dated index quotes is expressly unverified.

The combined observation and continuation/downgrade scenarios use disclosed 65%/35% participation thresholds, median change, leader concentration and the major-index snapshot. They are conditional observations rather than calibrated next-day probabilities. Missing dates, chip structures, licensed Level-2 and unverified news causality remain missing evidence rather than asserted institutional intent.

New fixed-purpose endpoints are `/api/desk/universe?page=...`, `/api/desk/industries` and `/api/desk/sector-scenario?code=SN:new_*`. Page bounds and provider namespaces are validated before network calls. JSONP history is parsed as JSON data without executing upstream script text.
