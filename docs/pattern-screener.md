# Pattern screener and liquidity gates

All foreground screener scopes now use `/api/desk/screen`. The default scope is the full source universe. Quick mode ranks up to 200 liquid names by turnover and absolute price movement, replacing the former largest-turnover calm-stock bias. All scopes require a dated quote aligned with the latest daily candle, observed daily traded value >= CNY 200 million, valid and recent OHLCV, and 90% model chip concentration below the selected cap (maximum 20%). Missing evidence does not pass.

Each pattern is an independent filter. The default is five-line bloom only; multiple selected patterns use OR, never AND. Defaults: exclude quiet / historically weak-follow-through character, market cap <= CNY 100 billion (1000 亿), no compulsory recent-limit requirement. Market-cap limit can be changed or disabled. A separate recent-limit mode can be combined as a union, or the recent-limit switch applies it as an AND condition to every selected pattern. UI results carry the actual matched patterns, their reasons, source date, turnover, market cap and chip-model basis. Non-guide patterns are labeled 形态候选 instead of implying that they are adhesive MA setups.

| Mode | Implemented definition |
| --- | --- |
| Five-line bloom | Existing causal guide launch/pending/confirmed logic using daily MA5/10/20/30/60. |
| Bullish alignment | MA5 > MA10 > MA20 > MA30 > MA60, all higher than five bars earlier, close >= MA5. |
| Multi-MA breakout | Bullish body crosses at least three of 5/10/20/30/60 including MA60; return >=3%, volume >=1.2x prior 20-bar mean; concentration <15%. |
| Beauty shoulder | A >=4% bullish launch with >=1.5x prior-20 volume, then 3–8 small-body bars (<=2.5%), all lows above launch-body midpoint, average shoulder volume <=75% of launch, MA5>10>20 and final close above MA5. |
| Golden spider | MA5/10/20 rising and ordered; all three pairwise upward crosses occurred in the latest five bars, close above MA5, volume >=1.2x prior-20 mean. |
| Bullish cannon | Last three bars up-down-up; middle low holds first low, final close exceeds both prior highs, final volume >=1.1x the greater prior volume, close above MA20. |
| Recent limit | Completed raw daily closes within half a tick of rounded 10% / 20% / 30% upper-limit estimates in the last ten completed bars. Excludes N/C/ST labels. This is an estimate from raw prices, not an exchange-provided flag; ex-right reference prices can differ. |

Patterns are explicit scanner conventions rather than universally standardized textbook definitions, and are not calibrated return probabilities. Intraday shapes remain provisional. The chart's eight editable MAs remain independent of the fixed pattern definitions.

The screener's chip gate currently uses the existing triangular OHLC/turnover model with historical volume divided by current free-float shares. This is an estimate with capital-change error, not actual beneficial ownership. It requires at least 120 bars and <=20% initial seed remainder. Tencent STAR (688/689) daily volume is shares, while ordinary Tencent daily volume is lots; quote-volume units must not be substituted for historical units. Beijing uses the existing Sina raw daily adapter in shares and explicitly flags unadjusted history.

## Flow recovery

The flow adapter tries Eastmoney intraday, Eastmoney delayed daily, then independent Sina daily net flow. The fallback retains its own source label and date. Sina netamount is labeled as its source net-flow measure; unavailable order-size buckets remain null. Complete source failure returns a recoverable empty state with a notice, rather than a generic 502 or fabricated zero flows.

## Persistent short shares

`POST /api/shares` validates and stores bounded plain-text article metadata in the `SHARES` KV binding. Its content hash produces `/n/<16-char-id>`. `GET /api/shares/:id` loads the same content; the web reader opens automatically on that path. Announcement shares preserve their announcement identifier and open its actual content/PDF route. Existing long query links remain readable for compatibility. The new UI never generates them. KV permissions / binding are required for production; memory or edge cache is not presented as persistent storage.

## Level-2 extension

`GET /api/level2?symbol=...` is unconfigured by default, with no synthetic ten-level book. A future licensed provider adapter can normalize responses through `LEVEL2_GATEWAY_URL` (HTTPS) and `LEVEL2_GATEWAY_TOKEN` (server secret). Responses must assert `licensed:true`, exact symbol, provider, timestamp, bids/asks with positive prices and nonnegative volumes, optional trade/order events, and explicit volume units. Wrong identifiers, absent authorization flags or future timestamps are rejected; stale data is marked. Public five-level snapshots remain a separate source.
