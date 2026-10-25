# Market overview, readability and stock character

The market page replaces the old mixed-market watchlist cards. It provides five major-index intraday charts, source-ranked industry and stock lists, dated Dragon/Tiger disclosures, previous-session limit-up cohorts, and a custom descriptive sentiment index. The stock watchlist remains in the stock workspace. Settings persist Chinese/English and 18/20/22px base sizes on each device; chart canvas labels also respond to these settings. Source articles and security names remain in their original language.

## Data provenance

- Index snapshots and intraday: Tencent, retaining source dates. Non-trading-day views display the last actual session.
- Rankings: Eastmoney with independent Sina industry fallback, retaining separate namespaces. Sina rankings omit the trading date, so the UI explicitly does not assert same-session freshness. Top-80 stock gainers and top-16 constituent lists cannot measure whole-market breadth.
- Limit pools: Eastmoney `push2ex` up/down/broken/yesterday pools. Dates must match the requested trading date, and the source-reported count must match the complete response. Unavailable is distinct from a verified empty pool. Badges require list membership; they are never inferred from a fixed percentage price move.
- Dragon/Tiger: `RPT_DAILYBILLBOARD_DETAILSNEW`, a bounded eight-calendar-day window ending at the index source date. Fetch up to eight 500-record pages; report incomplete coverage if capped. Each stock keeps its latest disclosure; overlapping reasons do not cause net amounts to be added twice. Disclosure prices and returns are explicitly historical.
- Weekly/monthly: Tencent adjusted bars first, then up to 1,023 actual Sina daily bars aggregated by ISO Monday weeks / calendar months. Adjust daily prices before aggregation; sum source volume without changing units. Sina volume is shares, Tencent generally lots except STAR shares. Beijing fallback remains unadjusted and is labeled. Period dates are actual last trading dates, never fabricated calendar endpoints. The first source period may be partial; current periods may be unfinished. Playbook resonance still excludes unfinished periods.

## Sentiment v1

`40% × up/(up+down) × 100 + 30% × up/(up+failed) × 100 + 30% × clamp(50+previousLimitMeanReturnPercent×5,0,100)`.

Failed seals exclude stocks already present in the sealed-up pool. All four dated pools are required. Empty denominators, unavailable pools or nonfinite values produce no score. These are Eastmoney pool cohorts, not exchange-wide breadth, and the result is not an upside probability. Cold/mixed/constructive/hot thresholds of 35/55/75 are user-facing descriptive thresholds.

## Chip distribution

The daily chart has an opt-in chip profile. Prefer adjusted Eastmoney daily OHLC plus historical turnover. If that source is unavailable, estimate turnover as daily volume (converted from lots if necessary) divided by the latest quoted free float, and explicitly label this constant-float fallback. Without both valid price history and a turnover basis, show unavailable.

The model distributes daily turnover on a 300-price triangular grid around HLC/3, replacing the corresponding fraction of old holdings with decay factor 1. Seed the first session with the entire float. Preserve total mass including single-price and narrow-range bars. Display the remaining initial seed, actual window dates, peak, average cost, estimated profitable share, central 70%/90% cost ranges, and concentration `(upper−lower)/(upper+lower)×100`. The crosshair can select an historical as-of date; future rows never enter that calculation. This is an OHLCV model, not actual holder identities, institutional costs or licensed Level-2 data. Corporate-action/free-float changes limit the fallback's accuracy.

## Stock character

Compression alone does not imply a launch. Every new screener candidate gets an independent, name-agnostic character profile from up to 250 known bars, cut at its guide as-of date. Display 60-session close-return standard deviation, ATR20 as a percentage of close, ≥5% up-day count, latest-5/prior-20 mean volume, and historical volume breakouts with five known following sessions. A breakout requires a close above the preceding 20-session high and volume ≥1.5× its preceding 20-session mean; skip the following five bars to avoid overlapping events.

Default activity filtering excludes volatility <1.2%, ATR <2.2% and no ≥5% pulse, plus follow-through below 40% when at least three historical breakouts exist. Banks and large-cap companies are never excluded by name. Sort formation stages first, then an explicitly heuristic activity score: capped 40 volatility points + 25 pulse points + 20 volume-expansion points + 15 historical-follow-through points (only with ≥3 samples). This is ranking, not calibrated return probability. Saved candidates without character data require rescanning or selecting All patterns. Sector and catalyst evidence remain separate verification tasks.

## Verification

Unit tests cover holiday/year boundaries, volume conservation, fallback after HTTP501, chip seeding/mass/lookahead, missing sentiment data, incomplete/wrong-date pools, overlapping disclosure reasons and causal stock character. Browser checks cover real endpoint data, both languages, persisted text size, weekly/monthly canvases, chip explanations, portaled offline notifications and narrow-screen overflow.
