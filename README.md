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
5. Cron 不再每次运行全部抓取器，而是按游标轮转分批执行。

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

这里分两种方式：

1. `Cloudflare Dashboard / Workers Builds` 平台部署
2. 本地 `wrangler` 命令行部署

这两种方式的 `D1` 绑定配置方式不一样。

### 方式一：Cloudflare Dashboard / Workers Builds

如果你是把仓库直接连到 Cloudflare 平台自动构建，按下面做：

1. 在 Cloudflare Dashboard 创建 Worker 项目。
2. 在该 Worker 项目的 `Settings -> Variables and Secrets` 中添加：

```text
ADMIN_USERNAME=你的用户名
WORKER_VALIDATE_MODE=source
CRON_FETCH_BATCH_SIZE=3
```

3. 在同一个 Worker 项目的 `Settings -> Variables and Secrets -> Secrets` 中添加：

```text
ADMIN_PASSWORD=你的密码
```

4. 在该 Worker 项目的 `Bindings` 中添加 D1 绑定：

- Binding name: `DB`
- Database: 选择你创建的 `proxypool` 数据库

5. 在 D1 控制台或 Worker 控制台执行初始化 SQL：

```sql
-- 把 cloudflare/sql/schema.sql 全部执行一次
```

6. 在 Worker 项目的 `Triggers` 中配置 Cron：

```text
*/15 * * * *
```

说明：

- 仓库里的 `wrangler.toml` 已经移除了占位 `database_id`，就是为了避免 Workers Builds 因无效 D1 ID 直接报错。
- 也就是说，平台部署时，`DB` 绑定应该完全在 Cloudflare Dashboard 上配置，不依赖仓库里的静态 ID。

### 方式二：本地 `wrangler` 命令行部署

1. 创建 D1 数据库

```bash
wrangler d1 create proxypool
```

2. 记录返回的 `database_id`

3. 本地创建一个不提交仓库的 `wrangler.local.toml`，内容示例：

```toml
name = "proxypool-worker"
main = "src/index.js"
compatibility_date = "2026-06-24"

[assets]
directory = "./public"
binding = "ASSETS"

[triggers]
crons = ["*/15 * * * *"]

[[d1_databases]]
binding = "DB"
database_name = "proxypool"
database_id = "替换成你自己的真实 database_id"

[vars]
ADMIN_USERNAME = "admin"
WORKER_VALIDATE_MODE = "source"
CRON_FETCH_BATCH_SIZE = "3"
```

4. 初始化表结构

```bash
wrangler d1 execute proxypool --file=sql/schema.sql
```

5. 设置管理接口凭据

```bash
wrangler secret put ADMIN_USERNAME
wrangler secret put ADMIN_PASSWORD
```

说明：建议把 `ADMIN_USERNAME` 和 `ADMIN_PASSWORD` 都放到 secret，避免明文留在配置文件里。

6. 使用本地配置部署

```bash
npx wrangler deploy --config wrangler.local.toml
```

7. 按需调整批量抓取大小

`wrangler.toml` 中提供了：

```toml
CRON_FETCH_BATCH_SIZE = "3"
```

含义：每次 Cron 触发时，只轮转执行这么多个已启用抓取器。默认 `3`，更稳；如果你观察到运行时间仍然偏长，可以进一步降到 `1` 或 `2`。

## 本地开发

```bash
npm install
npm run check
wrangler dev
```

## 部署

如果你走的是 Dashboard connected builds，平台会自动执行部署命令，不需要手动运行 `wrangler deploy`。

如果你走的是本地命令行部署，推荐：

```bash
npx wrangler deploy --config wrangler.local.toml
```

部署后可直接访问：

- `/web`: 代理管理页
- `/fetchers`: 爬取器管理页

## 调度行为

1. `Cron` 任务默认每 15 分钟触发一次。
2. 每次只抓取 `CRON_FETCH_BATCH_SIZE` 个已启用抓取器。
3. Worker 会把当前抓取游标写进 D1 的 `meta` 表，下次从下一个抓取器继续。
4. `POST /admin/fetch` 的手动触发不受这个批量限制，仍然支持单个抓取器或全部抓取器立即执行。

## 这次报错的原因

你日志里的错误：

```text
binding DB of type d1 must have a valid `database_id` specified
```

原因是：

1. Cloudflare 平台构建读取到了仓库里的 `wrangler.toml`
2. 里面的 `DB` 绑定使用的是占位符 `database_id`
3. Cloudflare API 在发布版本前会校验这个值是否是真实 D1 数据库 ID
4. 占位值校验失败，所以部署中断

现在仓库已经移除了这个占位 D1 配置。后续如果你走平台构建，必须在 Dashboard 的 `Bindings` 里配置 `DB`。

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
