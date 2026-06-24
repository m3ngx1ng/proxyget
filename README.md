# Cloudflare Worker + D1 版本

这个目录提供一个适配 `Cloudflare Workers + D1` 的代理池实现。它和根目录 Python 版本并存，当前已经覆盖：

- 可部署到 Worker
- 可定时抓取公开代理源
- 可把代理写入 D1
- 可通过 API 查询代理和状态
- 可托管静态管理后台页面

## 当前能力

- 支持 `GET /ping`
- 支持 `GET /fetch_random`
- 支持 `GET /fetch_http`、`/fetch_https`、`/fetch_socks4`、`/fetch_socks5`
- 支持 `GET /fetch_http_all`、`/fetch_https_all`、`/fetch_socks4_all`、`/fetch_socks5_all`
- 支持 `GET /all`、`GET /all/:count`
- 支持 `GET /proxies_status`
- 支持 `GET /fetchers_status`
- 支持 `GET /web`、`GET /fetchers`
- 支持 `POST /export_proxies`
- 支持 `POST /clear_proxies`
- 支持 `GET /fetcher_enable`
- 支持 `GET /clear_fetchers_status`
- 支持 `POST /admin/fetch`
- 支持 `POST /admin/clear`
- 支持 Cron 定时抓取
- 已迁移原项目全部 14 个抓取器

## 当前限制

这是 `Worker + D1` 约束下的实现，不是对 Python 版的无损迁移：

1. 现在的后台页面是静态页，不再使用 Flask session 模板渲染。
2. 没有真实代理链路验证。
3. `validated=1` 代表“抓取源已返回且格式有效”，不是 `requests(proxies=...)` 那种真实可用性验证。
4. 为适配 Worker 运行时长，部分高开销抓取器采用抽样页抓取，不再完全照搬 Python 版的全页遍历。

## 目录说明

- `wrangler.toml`: Worker 配置
- `sql/schema.sql`: D1 初始化表结构
- `src/index.js`: Worker 入口和 API 路由
- `src/fetchers.js`: 抓取源实现
- `src/repository.js`: D1 访问层
- `src/utils.js`: 公共工具函数
- `public/index.html`: 可用代理后台页
- `public/fetchers.html`: 爬取器后台页

## 初始化

1. 创建 D1 数据库

```bash
wrangler d1 create proxypool
```

2. 把返回的 `database_id` 填到 `wrangler.toml`

3. 初始化表结构

```bash
wrangler d1 execute proxypool --file=sql/schema.sql
```

4. 设置管理接口凭据

```bash
wrangler secret put ADMIN_USERNAME
wrangler secret put ADMIN_PASSWORD
```

说明：建议把 `ADMIN_USERNAME` 和 `ADMIN_PASSWORD` 都放到 secret，避免明文留在配置文件里。

## 本地开发

```bash
npm install
npm run check
wrangler dev
```

## 部署

```bash
wrangler deploy
```

部署后可直接访问：

- `/web`: 代理管理页
- `/fetchers`: 爬取器管理页

## 管理接口

### 手动触发抓取

```bash
curl -X POST \
  -u admin:your-password \
  https://your-worker.example.workers.dev/admin/fetch
```

### 指定抓取器

```bash
curl -X POST \
  -u admin:your-password \
  -H 'content-type: application/json' \
  -d '{"name":"proxyscrape.com"}' \
  https://your-worker.example.workers.dev/admin/fetch
```

### 清空代理

```bash
curl -X POST \
  -u admin:your-password \
  -H 'content-type: application/json' \
  -d '{"protocol":"all"}' \
  https://your-worker.example.workers.dev/admin/clear
```

## 后续建议

如果你要继续逼近原版效果，下一步应该做：

1. 增加外部验证器回写接口。
2. 把当前的弱验证升级成真实验证回传模式。
3. 为抓取器增加分批调度或队列，降低单次 Cron 压力。
4. 给静态后台增加登录态提示和批量操作反馈。
