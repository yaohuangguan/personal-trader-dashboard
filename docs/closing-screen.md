# Shared closing screen

The production Durable Object exports now point to `CloseCoordinator` and `CloseSignalMonitor`, retaining existing object IDs, VAPID keys and browser subscriptions. Old shard alarms retire themselves without market requests; historical records stay available in storage. Legacy enabled device alarms migrate to the daily schedule on their next wake. The previous intraday classes remain as unexported reference implementations; they are not deployed as production DO classes.

GitHub Actions `.github/workflows/close-screen.yml` starts at 07:20 UTC on weekdays (15:20 Asia/Shanghai). A date-checked Shanghai index snapshot verifies that a current trading session exists; weekends and holidays do not publish a new close. Actions schedules can run late. One shared report is computed, then each enabled device receives at most one successful digest per trade date, including zero qualifying candidates. A source outage is reported as unavailable evidence. Closing notification retries do not rescan quotes. Existing notification delivery still depends on browser/PWA permission; native push credentials remain unconfigured.

The daily job authenticates to the worker with `SCREEN_JOB_TOKEN`, configured separately as a GitHub Actions secret and Wrangler secret. It publishes bounded candidate chunks, then an atomic manifest. Public reads use `/api/desk/close-report`; the publish route is server-only. Historical analyses are in the private Actions cache (never source commits); the public repository contains code, not device tokens. Generated candidate report artifacts are ordinary public market observations.

## Performance

Cheap traded-value filtering (>=CNY200m) precedes history requests. Quotes use batches of 60; daily histories have bounded concurrency 8; frontend manual verification has bounded concurrency 4. There is no former per-symbol 900ms sleep. The daily job persists up to 500 adjusted candles in Actions cache and requests only three recent bars when possible. Overlap changes or missing overlap force a full refresh to avoid stale corporate-action adjustments. Raw daily bars verify recent closing-limit estimates. Guide analysis is reused for pattern checks; stock-character and chip computations occur only after a pattern/setup match. Subsequent clients reuse the shared results and filter/rank locally instead of fetching every stock again.

This is bounded parallelism, fewer network round trips and incremental caching, not an exponential-complexity improvement. A cold full-market pass remains source-dependent. Every result carries the actual date and source failures remain separate from pattern rejections.

## Ranking

Automatic mode evaluates independent patterns and early price/volume setups; it does not require all patterns to coincide. Composite priority: price/volume support 30, highest matching pattern 30 (correlated matches are not added together), historical activity 20, chip concentration 20. Quiet / weak-follow-through stocks cap at49 when activity filtering is disabled. All modes retain the >=CNY200m floor, chip concentration<20%, and the tighter multi-MA-breakout<15% gate. The default market-cap cap is CNY100bn and is adjustable. Score reasons and source-model limitations are displayed; this is not a calibrated return probability.

## Watch and chart context

Visible A-share watch rows load `/api/desk/insight`, with per-source caching and a 60-second foreground refresh. Daily strength and five-line advice are separate and dated; stale history is not labeled today. Daily structure uses MA5/10/20/30/60, with explicit bullish/bearish alignment, mixed alignment, correction or range criteria. Price/volume direction is labeled in words plus restrained red/green/neutral color. Intraday cumulative volume is not treated as completed daily volume. Chart crossover markers now explicitly say 买 / 卖 and remain distinguishable from the stricter guide confirmation markers. Intraday VOL uses observed incremental minute volume.

## 手动全市场研究任务（独立于收盘推送）

`POST /api/desk/screen-job` 只创建/连接一个共享任务，不在手机端跑逐股循环。服务端先分页完成证券名单核对，按成交额预筛，再以8只为一批并行核验。每批落盘，慢页有限重试；关闭页面继续。GET返回进度和当前候选，`id`与`count`相同只返回进度，避免反复下载完整候选。所有任务响应为no-store，防止缓存让进度停住。

历史日线在Durable Object保存，下一次只取最近5根并对齐复权基准；重叠历史变化时重取500根。5分钟内相同历史复用已经验证的结果（带原来源日期），这不是每5分钟自动扫描。完成后2分钟内重复点按复用同一任务，失败标的可单独重试。盘中任务无推送；每日收盘推送仍只执行一次。

2026-10-27首轮实测：名单5576只，流动性预筛后1149只，冷启动总耗时224439毫秒；产出218个未施加股性/市值筛选的规则候选，1只来源超时。初轮数据对齐问题作为未命中记录，后续已改为单独标记未核验并允许重试。没有旧方案同环境基准，不声称倍数或指数级提升。

## 主题雷达

概念与行业分别取新浪完整分类。当前实测概念175个，包含机器人、智能机器、创新药等。热力图面积按成交额平方根权重并限制极端权重；颜色表示涨跌，不是预测。点开后核对完整成分数量、展示上涨/下跌扩散、龙头和关联概念；关联仅代表当前领涨股相同。主题快讯按关键词匹配，未匹配时保持空。资金净额来源未提供时保持null；不把成交额当净流入。

重复扫描补测发现：腾讯增量请求在Workers返回501、同URL在Mac正常。已实现增量失败后请求500根标准URL并本地截取；连续24只全部失败时停止继续打源，保留检查点。扫描结果与上一轮结果分别存储，旧结果显示明确的快照提示。

名单现在按交易日持久化复用，批量快照重新核验成交额，不把旧名单价格当作当前行情。历史补齐每次alarm只执行一批；缓存重算可以连续处理最多8批，控制外部子请求低于Free计划单次上限，任务完成/暂停后停止alarm。

再次筛选优先复用已验证历史，用批量快照的真实OHLCV更新当日K线，检查前收基准和累计量不回退。允许基准一致且日期间隔不超过7天时追加快照所对应的真实日线；前收不一致、长缺口或数据异常则重新取历史；腾讯失败后用新浪复权日线独立降级。不是用报价推测历史K线。

扫描分为批量快照、缓存重算、历史补齐三段。缓存阶段优先返回已核验候选，缺历史单独排队，不让一只慢票拖住同批缓存结果。历史补齐总网络预算6秒/只，连续失败会暂停并保留未处理队列；暂停时“未完成”包括尚待补齐的标的。

2026-10-27缓存分阶段复测：同一5576证券池，流动性预筛1346只；11.678秒出现首批候选，46.927秒保留222个未加股性/市值过滤的候选。1131只核验完成，215只缺历史、对齐失败或补齐源未完成，已明确保留为未完成，未声称全覆盖。该次测试复用了已有日线，不与冷启动做严格倍数比较。算法按快照的真实时间判断盘中/收盘，避免处理延后时把早盘快照误当收盘。

有效日线不足65根现在单独记为历史样本不足，不触发行情源故障熔断；无效OHLC、过期日期仍属于未核验。历史接口自带快照比批量快照更新时优先采用较新时间，避免读取顺序导致价格不对齐。

当前快照比历史日线多一个交易日时，可在前收基准匹配、日期差不超过7天且真实OHLCV完整时追加这一根；前收基准不匹配（含除权风险）或长缺口仍重新取历史，绝不插值缺失日期。

补齐复测：215个未完成标的中212个已核验，耗时约29秒，合并保留243个候选。16个属于有效历史不足65根，现归入样本不足；剩余3个为北交所日线/快照对齐问题，保持未核验。

最终补齐任务`mvqd1uss`核验剩余3只北交所股票耗时4.388秒，未完成数降为0。其中2只未命中形态，1只未满足筹码集中度；合并后仍为243个原始候选。累计完成流动性预筛后1346只的规则核验（含样本不足的排除项），证券名单5576只；并非5576只都下载历史。各候选保留各自实际快照时间，补齐不会把先前候选时间统一改成最新时间。上述数次分阶段任务不等同于一次新冷启动的耗时。
