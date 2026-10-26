# Daily descriptive strength score

`/api/desk/trend?symbol=300545.SZ` feeds both the expandable web panel and the phone's compact Trend entry. It uses source-attributed actual daily bars, an optional matching stock/CSI 300 snapshot, and incremental minute volumes. This score describes the observed session; it is not a calibrated probability or a trading recommendation.

Let `A` be the mean true range of the prior 20 daily bars, `P` the current valid price, `C` the prior adjusted close, and `O/H/L` the observed session open/high/low. Each component is clamped to 0–100:

| Component | Weight | Component score |
| --- | --- | --- |
| Price momentum | 25% | `50 + 25 × (P − C) / A` |
| Session range position | 20% | `100 × (P − L) / (H − L)`; absent for one-price sessions |
| Return since open | 20% | `50 + 25 × (P − O) / A` |
| Relative CSI 300 strength | 25% | `50 + 10 × (stock return − CSI 300 return)`, returns in percentage points |
| Minute weighted price | 10% | `50 + 50 × (P − weighted minute price) / A` |

The last component uses minute prices weighted by incremental minute volume. It is an estimate, rather than exchange-reported exact VWAP. Cumulative volume is not summed repeatedly. Its latest point must remain fresh during active trading. Volume is separately described as observed cumulative volume divided by the prior 20-day average, preserving share/lot units; no full-session projection is made.

Missing dimensions stay unscored. The final score is the weighted mean of available component scores; coverage is shown separately so partial input does not imply complete evidence. Labels are custom descriptive bands: ≥75 strong, ≥60 moderately strong, ≥40 mixed, ≥25 moderately weak, below 25 weak. These thresholds have no calibrated win-rate interpretation.

At least 21 prior valid bars and nonzero observed volume are required. Future bars are excluded. Wrong-date/future/stale snapshots and adjusted-close disagreements cannot replace the daily bar. Older source sessions are explicitly historical. Current-session scores before 15:00 Beijing time remain provisional. Day lows/highs are observed reference levels, not predicted support/resistance. Matched sources and as-of timestamps are preserved in the response.
