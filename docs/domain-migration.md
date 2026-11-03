# guanlan.nzs.workers.dev

`wrangler.toml` 部署新的公开 Worker `guanlan`。迁移完成后不再部署旧 Worker；仅保留 `guanlan`，原有 Durable Object 状态通过 transfer migration 转移。

迁移后的 `guanlan` 直接持有 `SignalMonitor`、`MarketScanner` 及原有 SQLite Durable Object 数据，保留 `SHARES` KV。`LEGACY_STATE` 绑定已删除，收盘报告由 `guanlan` 自行验证 `SCREEN_JOB_TOKEN`。旧域名不再提供服务，旧客户端需要切换到新域名。

生产迁移顺序：先更新 `guanlan`，执行带 `transferred_classes` 的 Durable Object 转移；同步更新 `guanlan` 和 GitHub Actions 中的 `SCREEN_JOB_TOKEN`；验证收盘报告，再正常删除旧 Worker。不要用 `--force`。

```sh
npm run build
npx wrangler deploy
```

移动端默认 API 与分享链接均应使用新域名；旧版应用如果仍访问旧域名，需要升级。浏览器/PWA 的通知许可按来源隔离，新域名需要用户重新授予权限；迁移不删除原有 Durable Object 订阅记录。
