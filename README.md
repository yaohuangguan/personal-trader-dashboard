# 观澜 · Market Atlas

**观量价之澜，辨市场之势。** 一套以个股看盘、五线研究与全市场收盘筛选为中心的个人行情工作台，提供 React 网页 / PWA 与 Flutter iOS 客户端。

[打开观澜](https://personal-market-atlas.nzs.workers.dev/) · [个股工作台](https://personal-market-atlas.nzs.workers.dev/?symbol=300545.SZ) · [选股雷达](https://personal-market-atlas.nzs.workers.dev/?view=screener) · [iOS 开发说明](mobile/README.md)

## 能做什么

| 模块 | 体验 |
| --- | --- |
| 个股工作台 | 图表为中心；持续可见的股票名称、价格、涨跌、走势评分、五线总分、建议与具体理由 |
| 专业图表 | 可调 MA5/13/20/30/60/120/144/250；分时、日周月与5/15/30/60/120分钟；VOL / MACD / KDJ / BOLL / RSI / SAR、筹码峰模型、买卖文字标记 |
| 自选与分组 | 多分组、分时缩略图、按涨跌变色的股价、当天走势分、五线建议、日线结构状态；只对可见行加载附加数据 |
| 五线研究 | 五线粘合—启动—确认流程；多头/空头/箱体/交织状态；量增价跌等量价解读带文字方向与克制的红绿灰配色 |
| 自动优选 | 量价30、形态30、股性20、筹码20的可解释综合排序；相关形态取最高项，避免重复加分 |
| 独立形态 | 五线开花、多头排列、一阳多线、美人肩、金蜘蛛、多方炮、近10日涨停；多选命中任意一种即可 |
| 收盘汇总 | 北京时间15:20启动共享全市场任务，完成后合并推送一次；按交易日去重，非交易日跳过，来源失败单独标注 |
| 基本面与联动 | 资金面备用源、F10三张财报/股东/主营、市场情绪、行业板块成分、7×24快讯、公告与站内短链接分享 |
| 外观与移动端 | 中性黑 / 明亮白、中英文、大字号；Flutter按手机看盘操作重构，支持图表横屏、手势缩放与指标切换 |

所有形态的共同底线：**成交额≥2亿元、90%模型筹码集中度<20%**。一阳多线另要求集中度<15%；默认市值上限1000亿，可调整。股性过滤可开关。近10日涨停既可单独筛，也可附加到其他形态。

五线分析基于[姚记五线开花 v10.4 指南](https://trade.ps6.space/)。[形态定义](docs/pattern-screener.md) · [收盘任务与排序口径](docs/closing-screen.md) · [数据源与边界](docs/desk-workspace.md)

## 为什么扫描更快

- 先用批量快照排除成交额不足的股票，再获取历史日线。
- 手动扫描每批并行4只，去掉逐只900ms等待；共享任务最多并行8只。
- 收盘任务保存日线缓存，下一次优先补最近3根；复权重叠价变化就重新获取完整历史。
- 所有设备共用一份收盘排名，查看或调整条件时不必重新扫描全市场。
- 分项分析复用已计算的指南结果；只有命中形态或蓄势结构后才计算股性、筹码。

这是批处理、有限并发与增量计算；首次全市场任务仍受来源响应速度影响，**不承诺指数级提速**。GitHub定时任务也可能延迟启动。

## 数据说明

主要使用 [a-stock-data](https://github.com/simonlin1212/a-stock-data) 所整理的腾讯、东方财富、新浪等公开接口，并保留来源、日期、单位和失败状态。指数与证券代码明确区分。

- 公开五档和聚合分笔不属于授权 Level-2。服务端网关与两端界面已预留，需自行取得行情商权限后配置。
- 筹码分布是 OHLCV/换手率模型，包含历史股本变化误差；近10日涨停是未复权日线规则估算。
- 分数表示规则匹配或观察优先级，不是收益概率。买卖文字区分均线交叉参考与严格的指南收盘确认。
- 浏览器/PWA关页推送需要设备允许通知；iOS原生关页推送仍需 Firebase/APNs。本站不执行证券交易。
- U.S.行情和财务覆盖取决于数据商权限；缺失时展示明确空状态与来源信息。

## 本地运行

需要 Node.js 22+。

```bash
git clone https://github.com/yaohuangguan/personal-trader-dashboard.git
cd personal-trader-dashboard
npm ci
npm test
npm run dev
```

Flutter iOS：见 [mobile/README.md](mobile/README.md)。

## 部署与收盘任务

生产地址为 `personal-market-atlas.nzs.workers.dev`，Cloudflare账户由 `wrangler.toml` 固定。

```bash
npx wrangler login
npx wrangler whoami
npm run deploy
```

`SHARES` KV保存资讯短链接；Durable Objects保存共享收盘报告与设备通知状态。GitHub Actions的 [Daily closing screen](.github/workflows/close-screen.yml) 每个工作日07:20 UTC启动，只有来源交易日期正确才发布。报告分块上传后原子切换，保留缺失数据计数。

任务调用凭证 `SCREEN_JOB_TOKEN` 必须同时配置为 GitHub Actions Secret 和 Worker Secret，不能提交到Git。日线缓存放在Actions Cache。其他可选密钥包括 `FMP_API_KEY`、`TWELVE_DATA_API_KEY`、`SEC_USER_AGENT`；原生推送与授权Level-2须另行配置。

## 验证

```bash
npm test
npm run build
cd mobile
flutter analyze
flutter test
flutter build ios --release --no-codesign
```

测试覆盖成交量单位、未来数据隔离、收盘去重、旧盘中任务停用、复权缓存失效、形态OR筛选、缺失来源、图表手势和大字号布局。GitHub CI提供网页检查与iOS无签名构建；设备签名材料不提交仓库。

## English

**Guanlan · Market Atlas** is a personal market research desk with a web/PWA terminal and a Flutter iOS client. It combines focused stock charts, explainable price/volume and MA analysis, independent chart-pattern filters, and one shared closing ranking per trading day. Signals and scores are transparent research rules, not calibrated return probabilities or trade execution.
