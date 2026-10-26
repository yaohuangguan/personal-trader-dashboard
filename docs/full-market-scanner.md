# Shared full-market monitoring

The default monitor scope is now the complete SH / SZ / BJ source universe. It does not require watchlist membership or limit discovery to 60 names. Explicit custom/watchlist subscriptions remain an optional scope; only those custom lists have a 60-name limit.

`MarketScanner` is a second SQLite Durable Object class. A shared master incrementally reads every 80-name Sina universe page, stopping only at a short source page. It records source registry count, actual unique count, page count and count disagreements. The complete list is partitioned without ranking or gain filtering into at most 160 names per shard, including Beijing stocks. The master refreshes membership each Beijing date while at least one device lease remains active.

Shard alarms fetch Tencent snapshots in batches of 60, prepare up to four missing histories per invocation, and run the same causal guide evaluator used by selected monitoring. Completed baseline histories are reused for up to seven days while prior adjusted close agrees with the current quote. A source-correct closed daily bar is appended after the session; corporate-action mismatches force refresh. All symbols enter the preparation queue. Historical failures rotate rather than starving other symbols. Source failures, insufficient histories and stale quotes are excluded from validated counts.

Initialization is deliberately visible rather than asserting immediate complete coverage. The UI shows registered/actual names, pages, shards, fresh shard count, histories ready, source timestamp and valid checks in the last six minutes and thirty seconds. Snapshot polling is approximately five minutes per shard after initialization, not exchange tick data. The full-universe preparation can take many minutes, depending on public-source availability.

Each shard persists its detection outbox before reporting, and the master merges reports under a concurrency lock. Revision tags reject reports from an obsolete universe generation. The shared event stream contains no device tokens or notification subscriptions. Each device monitor selects newly observed shared signals, applies its activity filter and uses its own existing encrypted Web Push delivery. Starting a new subscription does not replay older shared detections as new notifications.

Each active device holds a bounded lease. The final release stops master and shard alarms; expiration also stops abandoned work. Device notification permission is still opt-in. The master and shard endpoints exist only on the private Durable Object namespace, not as public unauthenticated HTTP routes. The existing authenticated `/api/monitor/global` endpoint reports coverage without starting a task.

The stock workspace's global sidebar now displays the watchlist. `返回工作区导航` provides the other areas, and selecting another stock restores the watchlist. The redundant in-workspace watch column is hidden, leaving more chart space.

`/api/analysis` exposes the existing guide, character and candidate calculations for the Flutter client. It can return compact results for scans or weekly/monthly resonance on request. Both clients use the same server-side guide rules; chart MA preferences remain independent.

The five-minute cadence also applies to source retries and custom quote scans. Device notification collection is separate from quote scanning. A five-minute interval does not relax snapshot date, timestamp or adjustment checks.
