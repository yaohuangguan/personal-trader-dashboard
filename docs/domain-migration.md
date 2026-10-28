# guanlan.nzs.workers.dev

`wrangler.toml` 部署新的公开 Worker `guanlan`。`wrangler.legacy.toml` 更新原 Worker，并将其网页与旧短链接跳转到新站。

两者共用原 SHARES KV，新站的 Durable Object 绑定显式指向 `personal-market-atlas` 的既有命名空间。原 Worker 保留为持久状态的所属脚本，不能删除；它继续保存订阅、VAPID密钥、扫描历史与缓存。新站的收盘报告写入通过内部服务绑定交给原脚本校验既有 `SCREEN_JOB_TOKEN`，不复制或暴露令牌。日常静态页面和行情 API 不通过额外代理。

部署顺序：先新公开站，再原状态脚本；新站可访问以后才启用旧网页跳转。

```sh
npm run build
npx wrangler deploy
npx wrangler deploy --config wrangler.legacy.toml
```

移动端默认 API 与生成分享链接均使用新域名。旧版已安装应用的 API 仍可调用；浏览器/PWA 的通知许可按来源隔离，在新域名需要用户在设备上授予通知许可。原来源既有订阅不被删除。
