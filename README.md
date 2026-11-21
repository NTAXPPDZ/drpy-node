# drpyS (drpy-node)

[![zread](https://img.shields.io/badge/Ask_Zread-_.svg?style=plastic&color=00b0aa&labelColor=000000&logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB3aWR0aD0iMTYiIGhlaWdodD0iMTYiIHZpZXdCb3g9IjAgMCAxNiAxNiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTQuOTYxNTYgMS42MDAxSDIuMjQxNTZDMS44ODgxIDEuNjAwMSAxLjYwMTU2IDEuODg2NjQgMS42MDE1NiAyLjI0MDFWNC45NjAxQzEuNjAxNTYgNS4zMTM1NiAxLjg4ODEgNS42MDAxIDIuMjQxNTYgNS42MDAxSDQuOTYxNTZDNS4zMTUwMiA1LjYwMDEgNS42MDE1NiA1LjMxMzU2IDUuNjAxNTYgNC45NjAxVjIuMjQwMUM1LjYwMTU2IDEuODg2NjQgNS4zMTUwMiAxLjYwMDEgNC45NjE1NiAxLjYwMDFaIiBmaWxsPSIjZmZmIi8%2BCjxwYXRoIGQ9Ik00Ljk2MTU2IDEwLjM5OTlIMi4yNDE1NkMxLjg4ODEgMTAuMzk5OSAxLjYwMTU2IDEwLjY4NjQgMS42MDE1NiAxMS4wMzk5VjEzLjc1OTlDMS42MDE1NiAxNC4xMTM0IDEuODg4MSAxNC4zOTk5IDIuMjQxNTYgMTQuMzk5OUg0Ljk2MTU2QzUuMzE1MDIgMTQuMzk5OSA1LjYwMTU2IDE0LjExMzQgNS42MDE1NiAxMy43NTk5VjExLjAzOTlDNS42MDE1NiAxMC42ODY0IDUuMzE1MDIgMTAuMzk5OSA0Ljk2MTU2IDEwLjM5OTlaIiBmaWxsPSIjZmZmIi8%2BCjxwYXRoIGQ9Ik0xMy43NTg0IDEuNjAwMUgxMS4wMzg0QzEwLjY4NSAxLjYwMDEgMTAuMzk4NCAxLjg4NjY0IDEwLjM5ODQgMi4yNDAxVjQuOTYwMUMxMC4zOTg0IDUuMzEzNTYgMTAuNjg1IDUuNjAwMSAxMS4wMzg0IDUuNjAwMUgxMy43NTg0QzE0LjExMTkgNS42MDAxIDE0LjM5ODQgNS4zMTM1NiAxNC4zOTg0IDQuOTYwMVYyLjI0MDFDMTQuMzk4NCAxLjg4NjY0IDE0LjExMTkgMS42MDAxIDEzLjc1ODQgMS42MDAxWiIgZmlsbD0iI2ZmZiIvPgo8cGF0aCBkPSJNNCAxMkwxMiA0TDQgMTJaIiBmaWxsPSIjZmZmIi8%2BCjxwYXRoIGQ9Ik00IDEyTDEyIDQiIHN0cm9rZT0iI2ZmZiIgc3Ryb2tlLXdpZHRoPSIxLjUiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIvPgo8L3N2Zz4K&logoColor=ffffff)](https://zread.ai/hjdhnx/drpy-node)
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/hjdhnx/drpy-node)
[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)

![drpyS](./public/images/drpys.png)

Node.js 作为服务端的 drpy 实现，全面升级异步写法。

**本仓库是 [hjdhnx/drpy-node](https://github.com/hjdhnx/drpy-node) 的优化分支。** 主体框架、源生态与全部原创设计归道长（hjdhnx）及社区贡献者所有。本分支不改变对外接口契约，只做代码级治理、依赖升级和可回归性建设。

> ⚠️ **本项目仅供学习研究交流，禁止任何商业用途。使用前请务必阅读文末《免责协议》。**

---

## 目录

- [一、这个分支做了什么](#一这个分支做了什么)
  - [1.1 为什么要做优化](#11-为什么要做优化)
  - [1.2 优化清单](#12-优化清单)
  - [1.3 验证结果](#13-验证结果)
  - [1.4 明确没做的事](#14-明确没做的事)
- [二、快速开始](#二快速开始)
- [三、常用链接与文档](#三常用链接与文档)
- [四、致谢](#四致谢)
- [五、免责协议](#五免责协议)
- [六、版权与许可](#六版权与许可)
- [七、更新记录](#七更新记录)

---

## 一、这个分支做了什么

### 1.1 为什么要做优化

上游项目功能已经非常完整：Fastify 提供 API、代理、配置生成和后台管理，Node 侧通过 `vm` 加载 JS 源，Python/PHP 通过子进程执行，另有 M3U8、媒体、WebDAV、FTP、统一代理等链路。

问题不在功能多少，而在于**少数入口同时承担了认证、参数解析、文件访问、网络访问和错误处理**，导致安全边界和性能边界都不清晰。审计覆盖 108 个 Node 源文件、约 31,336 行代码、113 个路由注册点，具体表现在五个方面：

| 问题 | 具体表现 | 后果 |
| --- | --- | --- |
| 入口边界不清 | 管理面认证分散在多个 controller，缺配置时是 fail-open（默认放行）；文件路径用 `startsWith` 判界；代理是开放代理 | 未配置凭据即裸奔、目录穿越、SSRF 打内网和云元数据 |
| 请求生命周期无边界 | 无超时取消、定时器不清理、`console` 被全局 patch 后广播到 WebSocket | 请求结束后后台仍在跑；日志里的 token/cookie 被推给所有连接 |
| 性能隐患 | 配置读写同步阻塞事件循环、代理对同一上游重复探测、缓存双 Map 且容量矛盾 | 大配置文件下整个进程卡顿；上游被打爆 |
| 完全不可回归 | 没有自动化测试、没有 CI，任何改动只能人工点点点 | 改一行不敢发版，问题只能等用户报 |
| 依赖漂移 | Fastify 4 已于 2025-06-30 停止支持，Node 版本未固化 | 安全补丁拿不到，行为随环境漂移 |

做这件事的出发点很朴素：**这是自己每天在用的服务，跑在自托管机器上，暴露在内网，改它之前得先能证明改不坏。** 所以顺序是「先止血、后优化；保留外部契约、内部渐进重构」，每个工作包独立可回滚。

### 1.2 优化清单

按提交顺序分组，全部为内部实现变更，**不改变任何对外 URL、参数名和成功响应结构**。

#### 安全止血（P0）

- **管理面认证 fail-closed**：`utils/security/auth.js` 在凭据双缺时返回 `503 ADMIN_AUTH_NOT_CONFIGURED`、单缺时返回 `ADMIN_AUTH_PARTIAL_CONFIG`；`isPlaceholderCredential()` 把 `drpys`、`CHANGE_ME*`、`admin:admin` 一类占位值视为未配置；比较改用 `crypto.timingSafeEqual`。`index.js` 用统一 `preHandler` 覆盖 `/apps/`、`/api/admin/`、`isAdminPath()`。
- **管理会话 cookie**：解决浏览器 WebSocket 无法携带 `Authorization` 头的问题。`createSessionToken()` / `verifySessionToken()` 使用 HMAC-SHA256、12 小时过期并绑定用户名；`buildSessionCookie()` 下发 `HttpOnly; SameSite=Lax; Path=/`，`COOKIE_SECURE=1` 时追加 `Secure`。
- **路径守卫**：`utils/security/pathGuard.js` 的 `resolveInside()` 拒绝空字节、绝对路径、`..`、最多两次 percent 解码，用 `path.relative` 判界并 `realpathSync` 校验，符号链接逃逸返回 403。文件、文档、源模块加载全部改走统一入口。
- **出口策略（SSRF 防护）**：`utils/security/egressPolicy.js` 只放行 http/https，拦截 IPv4 私有/保留/回环/链路本地/组播、IPv6 回环/ULA/链路本地/组播，识别 IPv4-mapped 与 NAT64 内嵌地址，云元数据地址（`169.254.169.254`、`fd00:ec2::254`、`100.100.100.200` 等）任何模式都拒。三种模式：`strict`（默认）、`metadata`、`lan`（播放链路默认）。`guardedLookup()` 作为 axios 的 `lookup` 在**连接时**校验真实解析结果，抵御 DNS 重绑定。
- **日志脱敏与广播收敛**：Pino `redact.paths` 覆盖 authorization、cookie、x-api-key、set-cookie、password、token、secret、pwd、apiKey；`/ws` 的 console 广播改为需 `CONSOLE_WS_LOG=1` 显式开启，内容统一 `redactObject`。CORS 从 `*` + credentials 改为 `CORS_ALLOWED_ORIGINS` 白名单。
- **SQL 与命令执行**：`PRAGMA table_info` 表名白名单 + 参数序列化；`execSync` 换 `spawn` 并带 `PACKAGE_BUILD_TIMEOUT` 超时 SIGKILL。

#### 运行时与生命周期（P1）

- **超时可取消**：`utils/runtime/timeout.js` 的 `withTimeout()` 支持 Promise 或 `(signal) => Promise` 工厂，`AbortController` + `finally` 清理定时器，超时抛 `ApiError(TIMEOUT, 504)` 并记录 `{route, module, phase, elapsedMs}`。
- **缓存重写**：`utils/cache/cacheService.js` 基于 `lru-cache`，条目数 + 字节数双上限、TTL、`dispose` 统计淘汰、`fetch()` 带 single-flight；`utils/cache/singleFlight.js` 合并同名并发。`SmartCacheManager` 退化为薄适配层，删除双 Map 与每实例 `process.on('exit')`。
- **配置仓储**：`utils/config/configRepository.js` 提供 `readText`（mtime+size 缓存）、`writeTextAtomic`（临时文件 + rename，Windows EPERM 回退）、`writeJsonAtomic`、`withFileLock`。配置读写移出同步阻塞路径。
- **统一错误契约**：`utils/runtime/errors.js` 的 `ApiError` / `toApiError` / `errorPayload` / `sendError`，5xx 默认不回显内部信息（`EXPOSE_INTERNAL_ERRORS=1` 放开），401 自动加 `WWW-Authenticate`；`requestId` 贯穿响应与日志。
- **只读能力表**：`utils/runtime/capabilities.js` 定义 8 类能力与 `ROUTE_CAPABILITIES` 路径映射，`READ_ONLY_MODE=1` 时写操作在 `onRequest` 即被拦截并抛 `READ_ONLY`。
- **生命周期**：启动状态快照 `healthState`（ready/degraded）、`uncaughtException` 记录后退出、`gracefulShutdown()` 按 daemon → ws → fastify → 插件顺序关闭并受 `SHUTDOWN_TIMEOUT_MS` 约束；插件进程 `SIGTERM → SIGKILL` 分级停止与 1s/2s/4s 退避重启。

#### 结构重构（P2）

- **代理去重**：`utils/proxy/m3u8Rewriter.js` 统一逐行改写，补上 `URI="..."` 标签属性（`#EXT-X-KEY`、`#EXT-X-MAP`、`#EXT-X-MEDIA`）的改写，修正加密 HLS 密钥地址暴露原始地址的缺陷；`utils/proxy/streamRelay.js` 作为上游透传统一入口；`utils/proxy/rangeStreamer.js` 修正 `bytes=0-0` 被误判 416 的边界。
- **健康检查参数修复**：`/m3u8-proxy/health`、`/ftp/health`、`/webdav/health` 三个端点的 `createHealthResponse()` 调用参数错位（服务名位置收到缓存对象，`JSON.stringify` 抛循环引用错误导致 500）。修正 `controllers/m3u8-proxy.js`、`controllers/ftp-proxy.js`、`controllers/webdav-proxy.js`、`controllers/file-proxy.js`、`controllers/unified-proxy.js` 五个调用点，`features` 改由响应对象合并；`service` 字段与 `cache.requests/additional.stats` 现在都正确输出。
- **备份单服务**：`utils/backup/backupService.js`，`/admin/backup` 与 `/admin/restore` 均改为薄适配层。
- **运行时首页拆分**：原先 `/` 直接把这份 README 渲染成 HTML，README 变长后手机打开体验很差。现在 `/` 优先渲染 `docs/home.md`（精简导航页：快速开始、接口速查、插件应用、文档索引），找不到才回退 README；渲染结果按 mtime+size 缓存并写 `public/index.html`，同时补了基础排版样式（表格边框、代码块、移动端断点）。
- **源目录统一索引**：`utils/sources/sourceIndex.js` 按目录 mtime 缓存，`controllers/config.js` 六处 `readdirSync` 与 `sourcesController` 四处 `readdir` 收敛为统一入口。
- **统一日志**：`utils/logger.js` 的 `createLogger(module)` 输出带 `module` 字段的 Pino JSON 行，`redactText` 处理文本脱敏，`setLogTap()` 作为 WebSocket 广播订阅点；一次性 codemod 迁移 55 个文件、546 处 `console.*`。
- **指标扩展**：`utils/runtime/metrics.js` 新增 `drpy_http_requests_total`、`drpy_http_request_duration_seconds`（直方图，5ms–30s 桶）、`drpy_upstream_requests_total`、`drpy_upstream_duration_seconds`；每指标最多 500 条时间序列，路由标签使用 Fastify 路由模板而非真实 URL 以控制基数。

#### 依赖升级与可回归性

- **Fastify 4 → 5**：`fastify` 4.29.1 → 5.12.8，`@fastify/static` 7.0.4 → 10.1.12，`@fastify/websocket` 10.0.1 → 11.3.7，`@fastify/formbody` 7.4.0 → 9.0.2。适配的破坏性变更：
  - `controllers/fastlogger.js` 两处 `Fastify({ logger })` → `loggerInstance`（v5 不再接受自定义 logger 实例）
  - `utils/proxy-util.js` 的 `request.connection.encrypted` → `request.socket.encrypted`（v5 删除 `request.connection`）
  - `utils/runtime/metrics.js`、`utils/runtime/requestContext.js` 的路由标签从 `request.routerPath` 改为 `request.routeOptions.url`（v5 删除 `routerPath`）
  - `controllers/api.js` 删除 `schema.consumes`（v5 schema 白名单外，静默失效）
- **Node 矩阵固化**：`engines` 为 `>=22 <25`，新增 `.nvmrc`（22），CI 矩阵 22 / 24（Node 20 已 EOL，不再纳入）。
- **测试与 CI**：`tests/unit/`（egressPolicy、p2、pathGuard、runtime）+ `tests/integration/`（readonly、server）+ `scripts/check-syntax.mjs`，`.github/workflows/ci.yml` 跑语法检查、单测、集成和 `npm audit`。
- **业务回归脚本**：`scripts/regression-fastify5.mjs`，74 条用例覆盖核心路由、静态前缀、表单解析、管理面认证、业务 API 全链路、三个代理子系统、路由边界和 WebSocket 握手，可用于升级前后的逐条对比。

#### CI 与镜像发布

- **测试脚本跨版本可用**：`package.json` 的 `test` / `test:unit` / `test:integration` 去掉 glob 外层引号，交给 shell 展开成文件列表。原先的 `node --test "tests/unit/**/*.test.mjs"` 在 Node 20 会报 `Could not find`（`--test` 支持 glob 是 Node 21 才加的），而 Node 24 又不接受目录参数，去掉引号后 20 / 22 / 24 都能跑。
- **Dockerfile 不再克隆上游**：原第 15 行 `RUN git clone https://github.com/hjdhnx/drpy-node.git .` 指向的上游仓库已 404，导致镜像构建从未成功过。改为使用构建上下文（`COPY package.json package-lock.json` → `npm ci` → `COPY . .`），并新增 `.dockerignore` 排除 `node_modules` 与各子项目，构建上下文从 400MB+ 降到几十 MB。
- **构建/运行基础镜像统一到 Node 22**：builder `node:20-alpine` → `node:22-alpine3.22`，runner `alpine:latest` → `alpine:3.22`（3.22 的 `apk add nodejs` 是 22.x，与 builder ABI 一致；用 `latest` 会装成 Node 24，`node-pty` 原生模块直接失效）。
- **修掉两个必然失败的 `apk add`**：`php83-cli` 由 `php83` 提供、`php83-json` 由 `php83-common` 提供，两者都不是独立包名，单独安装会整条 `apk add` 失败。
- **`yarn` 换成 `npm ci`**：仓库没有 `yarn.lock`，`RUN yarn && yarn add puppeteer` 不可复现。puppeteer 属可选能力（`libs/drpyS.js` 里是 `try { await import('../utils/headless-util.js') } catch`），缺失只影响该功能，不再预装。
- **Release 附件上传修复**：原用已废弃的 `actions/create-release@v1` + `curl --data-binary @file "$upload_url?name=$file"`，`upload_url` 带 `{?name,label}` 模板，返回 400 `Multipart form data required`，而验证步骤不检查状态码，于是每次都“成功”但附件为空。改用 `softprops/action-gh-release@v2`（`fail_on_unmatched_files: true`），并在末尾用 `gh release view --json assets` 真实校验。

### 1.3 验证结果

| 项目 | 结果 |
| --- | --- |
| 语法检查 | 219 个文件，0 失败 |
| 单元测试 | 97 通过 / 0 失败 |
| 集成测试 | 10 通过 / 0 失败 |
| 业务回归（74 条） | 与 Fastify 4 基线逐条一致，唯一差异是畸形 JSON 从 500 变为 400（v5 行为改进） |
| 并发 | 100 并发 `/health` 全部 200 |
| WebSocket | `/ws` 握手正常，welcome 消息正常下发 |
| 弃用告警 | 启动日志无 `FSTDEP*` / `FSTWRN*` / `FST_ERR*` |

复现命令：

```bash
npm ci
npm run check:syntax
npm test
# 业务回归（需先起服务）
node scripts/regression-fastify5.mjs http://127.0.0.1:5757 <管理员账号> <管理员密码> [API_PWD]
```

### 1.4 明确没做的事

1. **不做安全沙箱**。源脚本仍在主进程 `eval`/`vm` 执行，第三方源默认可信。本次只把该边界显式化，不承诺隔离；不可信源需进程级隔离运行。
2. **不改外部契约**。URL、参数名、成功响应结构保持原样，错误响应只在原有 `error`/`message` 上追加 `code`、`requestId`。
3. **不重写引擎和源生态**，不改变 Python/PHP/CatVod 兼容面，不迁移 TypeScript，不替换 Fastify，不引入 Redis/Kubernetes。
4. **已知遗留问题**（非本次引入，`main` 分支同样存在）：
   - `mediaProxy` 单线程路径的 `Content-Range` 总长取自上游 `content-length`，上游已返回 Range 子响应时不准。
   - 文本日志脱敏为模式匹配，覆盖常见 `key=value` 与 Basic 形式，不能保证穷尽。

---

## 二、快速开始

### 环境要求

- Node.js `>=22 <25`，推荐 22 LTS（见 `.nvmrc`）
- 需要 Python/PHP 源时另行准备对应运行时，见 [python环境](/docs/pyenv.md)、`spider/php/readme.md`

### 安装

**方案一：通用多平台安装**

参见 [多平台安装教程](https://zy.catni.cn/otherShare/drpyS-build.html)。

**方案二：自动化安装脚本**

```bash
bash -c "$(curl -fsSLk https://git-proxy.playdreamer.cn/hjdhnx/drpy-node/raw/refs/heads/main/install/autorun.sh)"
```

定时更新：

```bash
echo "30 7 * * * cd /patch && bash -c \"\$(curl -fsSLk https://git-proxy.playdreamer.cn/hjdhnx/drpy-node/raw/refs/heads/main/install/autorun.sh)\" >> /patch/drpyslog.log 2>&1" | crontab -
```

或下载脚本到本地后：

```bash
chmod a+x /path/autorun.sh
echo "30 7 * * * bash /path/autorun.sh >> /path/logfile.log 2>&1" | crontab -
```

`/patch` 为脚本存放路径（放在与源码同级的自定义目录中）。

**方案三：手动部署（推荐用于本分支）**

```bash
mkdir /home/node_work && cd /home/node_work
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.35.3/install.sh | bash
source ~/.bashrc
nvm install 22
npm config set registry https://registry.npmmirror.com
npm i -g pm2
git clone https://github.com/NTAXPPDZ/drpy-node.git
cd drpy-node
npm ci
npm run pm2
pm2 logs drpys
```

**方案四：Docker**

镜像发布在 GitHub Container Registry（不在 Releases 页面），标签为版本号与 `latest`：

```bash
docker pull ghcr.io/ntaxppdz/drpy-node:latest
docker run -d --name drpys -p 5757:5757 -p 57575:57575 \
  -v $(pwd)/.env:/app/.env ghcr.io/ntaxppdz/drpy-node:latest
```

本地自行构建：

```bash
docker build -t drpys:local .
docker run -d --name drpys -p 5757:5757 -p 57575:57575 drpys:local
```

镜像基于 `node:22-alpine3.22` 构建、`alpine:3.22` 运行，内含 Node 22、PHP 8.3 与 Python 虚拟环境；首次运行请挂载改好的 `.env`，默认凭据来自 `.env.development`（均为 `CHANGE_ME_*` 占位符）。

### 启动

```bash
npm run dev        # 直接运行
npm run pm2        # pm2 常驻，进程名 drpys
```

默认端口 `5757`，WebSocket 端口 `57575`，可用 `PORT` / `WS_PORT` 覆盖。

浏览器打开 `http://<ip>:5757` 看到的是运行时首页 [`docs/home.md`](docs/home.md)——一份精简导航页（快速开始、接口速查、插件应用、文档索引），不是这份 README。README 保持完整供 GitHub 阅读；要改运行时首页直接编辑 `docs/home.md`，刷新即生效（渲染结果按 mtime 缓存）。`docs/home.md` 不存在时回退渲染 `README.md`。

### 首次启动必改

以下默认值必须先改，否则管理面等于裸奔：

| 变量 | 说明 |
| --- | --- |
| `API_AUTH_NAME` / `API_AUTH_CODE` | 管理面 Basic 认证凭据 |
| `API_PWD` | 业务 API 的 `pwd` 参数 |
| `ADMIN_SESSION_SECRET` | 管理会话 cookie 的 HMAC 密钥；不配则每次重启随机 |
| `COOKIE_SECURE=1` | HTTPS 部署时开启 |
| `CORS_ALLOWED_ORIGINS` | 需要跨域时的白名单，不配则拒绝跨域 |

完整环境变量见 [DS项目环境变量说明](/docs/envdoc.md) 与 [优化新增环境变量](#优化新增环境变量)。

### 优化新增环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` / `WS_PORT` | 5757 / 57575 | 监听端口 |
| `SHUTDOWN_TIMEOUT_MS` | 5000 | 优雅关闭总超时 |
| `UNHANDLED_REJECTION_TOLERANT` | 未设置 | `1` 未处理拒绝只记日志不退出 |
| `EXPOSE_INTERNAL_ERRORS` | 未设置 | `1` 放开 5xx 内部信息（仅调试） |
| `CONSOLE_WS_LOG` | 未设置 | `1` 才接管 console 并广播到 WebSocket |
| `LOG_LEVEL` | `info` | Pino 日志级别 |
| `CORS_ALLOWED_ORIGINS` | 空 | 逗号分隔白名单 |
| `PROXY_EGRESS_MODE` | `lan` | `strict` / `metadata` / `lan` |
| `MEDIA_PROXY_EGRESS_MODE` | 跟随 `PROXY_EGRESS_MODE` | 媒体代理出口模式 |
| `MEDIA_PROBE_TTL_MS` | 30000 | 媒体探测缓存时长 |
| `PACKAGE_BUILD_TIMEOUT` | 180000 | 打包超时 |
| `READ_ONLY_MODE` | 未设置 | `1` 只读模式 |
| `ADMIN_AUTH_TRUST_LOOPBACK` | 未设置 | `1` 回环地址免管理认证，仅本机调试 |
| `DOTENV_CONFIG_PATH` | `.env` | 指定 env 文件路径 |
| `ENABLE_TERMINAL` | 未设置 | `1` 开启 Web 终端 |
| `DISABLE_PLUGINS` / `DISABLE_PYTHON_DAEMON` | 未设置 | `1` 跳过插件 / Python 守护 |

---

## 三、常用链接与文档

### 上游与本项目

- [上游仓库 hjdhnx/drpy-node](https://github.com/hjdhnx/drpy-node)
- [本项目主页-免翻](https://git-proxy.playdreamer.cn/hjdhnx/drpy-node)
- [DS源仓库-去中心化](http://183.87.133.60:5678/)
- [DS本地包下载中心](/admin/download)

### 配置接口

实际给影视壳子 / 客户端用的三条链接（`pwd` 用你自己的 `API_PWD`）：

- [本地配置接口-动态本地](/config?healthy=1&pwd=$pwd) —— 接口地址固定为 `http://127.0.0.1:<PORT>`，本机自用
- [本地配置接口-动态外网/局域网](/config/1?healthy=1&pwd=$pwd) —— 接口地址跟随访问域名，手机/外网/反代场景用这条
- [其他配置接口-订阅过滤](docs/sub.md) —— 按分类与关键词过滤订阅内容

### 文档

- [运行时首页（ip:5757 显示内容）](docs/home.md)
- [接口文档](docs/apidoc.md) | [接口列表如定时任务](docs/apiList.md)
- [DS项目环境变量说明](docs/envdoc.md) | [python环境](docs/pyenv.md)
- [drpyS源属性说明](docs/ruleAttr.md) | [drpy2写源简述](docs/ruleDesc.md)
- [订阅过滤说明](docs/sub.md) | [关姐算法搭建说明](docs/suanfa.md)
- [猫源调试教程](docs/catDebug.md) | [接口压测教程](docs/httpTest.md)
- [webdav使用教程](docs/webdav.md) | [puppeteer使用教程](docs/pupInstall.md)
- [crypto-js-wasm使用教程](docs/crypto-js-wasm/readme-CN.md)
- [代码质量评估工具说明](docs/codeCheck.md) | [DS项目代码评估报告](docs/codeCheckReport.md)
- [重要问题记录](docs/issue.md)
- 代码级优化项目书与验收记录见仓库外 `doc/` 目录

### 插件应用列表

- [Admin 管理面板](/apps/admin)
- [DrPlayer](/apps/drplayer)
- [Websocket实时日志](/apps/websocket)
- [cookie管理插件](/apps/cookie-butler/index.html)
- [cron表达式插件](/apps/cron-generator/index.html)
- [剪切板智能推送插件](/apps/clipboard-pusher/index.html)
- [DS源可用性检测插件](/apps/source-checker/index.html)
- [DS解析检测插件](/apps/vip-parser/index.html)
- [DS源配置编辑插件](/apps/source-editor/index.html)
- [DS内存图片管理器插件](/apps/image-manager/index.html)
- [DS时钟插件](/apps/clock/white_clock.html) | [日历时钟](/apps/clock/index.html)
- [bookReader](/apps/book-reader)
- [系统备份与恢复](/apps/backup-restore/index.html)
- [代码加解密工具](/admin/encoder)
- [在线猫ds源主页](/cat/index.html)

### 油猴脚本

- [反切屏检测](/public/monkey/check_screen_leave.user.js)
- [通用网页脚本框架](/public/monkey/clipboard-sender.user.js)
- [通用指令集-道长](/public/monkey/自定义指令集-道长.json)

### 代理转发功能测试

- [代理转发 ds](/req/https://github.com/hjdhnx/drpy-node)
- [代理转发百度](/req/https://www.baidu.com)
- [代理转发范冰冰直播源](/req/https://live.fanmingming.com/tv/m3u/ipv6.m3u)

### 同作者项目

- [DS源适配猫影视](https://github.com/hjdhnx/CatPawOpen/tree/ds-cat)
- [DS插件项目-golang](https://github.com/hjdhnx/drpy-plugin)
- [DS 二进制插件项目-pup-sniffer](https://github.com/hjdhnx/pup-sniffer)
- [DS 二进制插件项目-file-index](https://github.com/hjdhnx/file-index)
- [DS web插件项目-drplayer](https://github.com/hjdhnx/DrPlayer)
- [drpy2打包项目](https://github.com/hjdhnx/drpy-webpack)

### 免费壳子推荐

- [酷9](https://wwbty.lanzouv.com/iGoUV3d3hxuf)
- [千寻](https://wwbty.lanzouv.com/iSSN93d3hyzg)
- [皮卡丘](https://github.com/ingriddaleusag-dotcom/PeekPiliRelease)

### 友链

- [猫影视git文件加速](https://github.catvod.com/)
- [猫影视多功能主页](https://catvod.com/)
- [ZY写源教学](https://zy.catni.cn/editSource/edit-grammar.html)
- [源动力](https://tvshare.cn/)
- [桌面启动器](https://wwbty.lanzouv.com/iDZaP3d3i5ud)

---

## 四、致谢

这个项目能跑起来、能一直更新到今天，靠的不是一个人。

### 道长（hjdhnx）

框架作者，`drpy` / `drpyS` / `drpy2` 整套源生态的奠基者。从 CatVod 规则到 drpy 语法，从 Node 端实现到 Python/PHP/CatVod 多引擎兼容，把一套原本零散的写源方案做成了有规范、有文档、有社区的体系。项目里绝大多数设计决策和"为什么这么写"的答案，都在道长的代码和文档里。本分支的所有工作都建立在道长打好的地基上。

道长在 README 里写过：「上班当牛马，下班要带娃，阶段性佛系趁娃睡觉熬夜更新。」——这套东西是这么写出来的。

### 社区贡献者

按本仓库提交数统计：

| 贡献者 | 提交数 | 主要贡献 |
| --- | --- | --- |
| Taois | 381 | 迅雷播放链路、bundle 打包与测试、代码加解密工具、后台接口文档、运行时长统计、手机端 Python 支持 |
| 晚风拂柳颜 | 130 | 番茄小说等源维护、推送链路、123 网盘、UC 相关修复 |
| eylinsir | 48 | 大量 JS 源的新增与维护（动漫、古籍、动漫屋等），配置模板整理 |
| sanshu | 23 | 安装/卸载/升级脚本重构，增强版计划任务（开机自启、指定更新代理、可配置定时更新） |
| Hiram | 16 | Dockerfile 与 CI/CD、PHP 镜像构建、mcpb/dxt 打包支持 |
| 雨桐、ZXSYZ、mine 及其他贡献者 | — | 零散修复、源补充与文档改进 |

以及所有提交过源、报过 issue、在群里帮忙回答问题的用户——写源这件事的难点从来不在代码本身，而在有人愿意持续把失效的源修好。

### 开源项目

Fastify、`@fastify/static`、`@fastify/websocket`、`@fastify/formbody`、axios、pino、lru-cache、cheerio、better-sqlite3 等依赖的作者与维护者。

### 开发工具：[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)

本分支的代码级治理、Fastify 5 迁移评估与实施、74 条业务回归脚本、以及 v4/v5 逐条行为对比，是在 **DeepSeek Harness（DSH）** 这个 AI 编码环境下完成的：读代码、查依赖、跑测试、起服务、比对响应、写文档，全程由它在这个仓库里实操。

工具再好也只是工具——所有决策、验收标准和"这版能不能发"的判断仍然由人来做。但该记的功要记：**没有它，这套重构和回归不可能在两三天内落地。**

---

### 本分支的优化工作

代码级治理、安全加固、运行时重构、Fastify 5 升级与测试体系，由本仓库维护者（xppdz）在道长原有架构上完成，开发过程使用 DeepSeek Harness 辅助。再次强调：**这些是增量改进，不是重写，功劳的大头在上游和社区。**

---

## 五、免责协议

> **请在使用本项目之前完整阅读本节。一旦克隆、部署、运行或以任何方式使用本项目，即视为您已阅读、理解并完全接受以下全部条款。**

**第一条 性质与目的**

本项目为开源技术学习与研究项目，用于学习 Node.js 服务端开发、爬虫与媒体解析、接口聚合、插件化架构等技术主题。项目本身不提供、不存储、不分发任何音视频内容，不运营任何服务，不构成任何形式的商业产品。

**第二条 内容来源与责任划分**

项目内所有源脚本（`spider/` 目录）及相关配置均由社区用户自行编写、收集或提交，来源于互联网公开信息。**源所指向的一切内容均由第三方站点提供，与本项目作者、维护者、贡献者无任何关联。** 因使用某个源而产生的版权、内容合规、数据安全等一切责任，由该源的使用者自行承担。

**第三条 使用者的全部责任**

您在使用本项目时，须自行确保：

1. 您的使用行为符合您所在国家或地区的法律法规；
2. 您访问、解析、播放的内容已获得合法授权；
3. 您不会将本项目用于任何商业用途、付费服务、二次销售或引流变现；
4. 您不会将本项目部署为面向公众的公开服务；
5. 您已充分理解自托管服务的安全责任，包括但不限于端口暴露、凭据强度、访问控制与日志留存。

**第四条 禁止商业使用**

本项目及其衍生作品**严禁用于任何商业或营利目的**，包括但不限于：付费会员服务、广告变现、代搭建收费、打包出售、作为商业产品的一部分分发。违反者须自行承担全部法律与经济后果，本项目作者与维护者不承担任何连带责任。

**第五条 24 小时删除条款**

本项目仅供技术学习与研究。请您在下载或部署后 **24 小时内**将所有相关内容从您的计算机、手机、服务器或任何存储设备中完全删除。逾期未删除或继续使用所产生的一切后果，由您自行负责。

**第六条 无担保**

本项目按"现状"（AS-IS）提供，不附带任何明示或默示的担保，包括但不限于适销性、特定用途适用性、不侵权、无错误、不间断运行。作者与维护者不保证项目的合法性、准确性、完整性、有效性或安全性。

**第七条 责任限制**

在适用法律允许的最大范围内，本项目作者、维护者及贡献者**不对**因使用或无法使用本项目而导致的任何直接、间接、偶然、特殊、惩罚性或后果性损害承担责任，包括但不限于：数据丢失、设备损坏、服务中断、利润损失、商誉损失、法律纠纷、行政处罚、第三方索赔。即使已被告知此类损害的可能性，亦不承担责任。

**第八条 隐私与数据**

本项目不收集、不上传任何用户数据。但请注意：项目运行过程中产生的日志、缓存、Cookie、数据库文件均保存在您自己的设备上，其安全与合规由您自行负责。项目包含向第三方站点发起网络请求的功能，第三方站点的数据处理行为不受本项目控制。

**第九条 安全提示**

本项目历史上存在、未来也可能存在安全缺陷。**请勿将管理面直接暴露在公网**，务必修改所有默认凭据，建议仅在可信内网或 VPN 内使用。因配置不当、凭据泄露、端口暴露导致的安全事件，作者与维护者不承担责任。

**第十条 侵权处理**

任何单位或个人若认为本项目（含其中某个源脚本）涉嫌侵犯其合法权益，请及时联系并提供身份证明、权属证明及具体侵权说明。经核实确认后，我们将尽快删除相关内容。

**第十一条 条款变更**

作者与维护者保留随时修改、补充或删除本免责协议任何条款的权利，且无需事先通知。修改后的条款自发布之时起生效。您应定期查阅本节内容，继续使用即视为接受修改后的条款。

**第十二条 条款可分性**

本协议任何条款被认定为无效或不可执行的，不影响其余条款的效力，其余条款仍应完整有效。

---

## 六、版权与许可

- 本项目主体框架由**道长（hjdhnx）**开发，遵循 [GPL-3.0](LICENSE) 许可。
- 项目内相关源收集于互联网，仅供学习交流测试使用，**禁止商用或直接转卖代码**；转载代码请带上出处。
- 本优化分支的增量修改同样遵循 GPL-3.0，并保留上游全部版权声明。

---

## 七、更新记录

### 本分支版本

当前版本 **V1.7.0**（2026-11-21）。

主版本号规则与上游保持一致（`V主.次.修订`），`package.json` 里的 `version` 字段与本节同步，后台管理「系统信息」读取的就是这个值。

| 版本 | 内容 |
| --- | --- |
| **V1.7.0** | 影视源大更新：星辰影院[优] 按新版详情模板重写二级/搜索/lazy（`.anthology-*` 线路与剧集、`http下载` mp4 线路、`page=` 搜索分页）；腾云驾雾[官] 列表与搜索切换到腾讯新版 `getPage` / `MbSearchHttp` 接口（`filter_value` 筛选、`page_context` 翻页、dataType=2 专辑过滤、`FillUnionInfo` 兜底）；修正反向代理下 `x-forwarded-host` 与 undici fetch 导入；新增 51吃瓜源，清理 12 个失效源。 |
| V1.6.0 | 依赖全面升级：安全修复（axios / form-data / qs / node-forge / undici）、日志链（pino 10 / rotating-file-stream 4 / dotenv 18）、网络链（https-proxy-agent 9 / basic-ftp 6）、缓存解析（lru-cache 11 / cheerio 1.2 / mime-types 3 / iconv-lite 0.7 / google-protobuf 4）、其余（lodash / sync-fetch / nodemailer 10 / p-queue 10）；移除未使用的 marked 与 import。 |
| V1.5.1 | 修正五个代理健康检查端点的 500（`createHealthResponse` 参数错位）；修复 CI 在 Node 20 上的测试失败、Docker 镜像构建与 Release 附件上传；拆分运行时首页为 `docs/home.md`。 |
| V1.5.0 | Fastify 4 → 5 全量升级（含 `@fastify/static` / `@fastify/websocket` / `@fastify/formbody` 配套主版本）；安全止血、运行时重构、结构治理、测试与 CI 体系；74 条业务回归与 v4 逐条对比一致。 |
| V1.4.3 | 上游基线版本（2026-03-22），本分支的起点。 |

### 优化分支提交

| 提交 | 内容 |
| --- | --- |
| `8c48651` | fix(security): 管理面认证 fail-closed、路径守卫、出口策略与日志脱敏 |
| `d700bc7` | refactor(runtime): 超时可取消、缓存重写、配置仓储、生命周期与统一错误契约 |
| `3030b78` | refactor(p2): 代理去重、备份单服务、源目录索引、统一日志与指标 |
| `2e7424b` | test: 补齐单元/集成测试与 CI，固化 Node 版本矩阵 |
| `f53c023` | fix(admin): 插件/订阅/系统/终端管理路由接入只读拦截与统一日志 |
| `a36c9af` | chore(deps): 升级 Fastify 4 → 5，适配 v5 破坏性变更 |
| `7735918` | test: 新增 Fastify 5 升级业务回归脚本 |
| `a10d213` | fix(proxy): 修正 createHealthResponse 参数错位导致的健康检查 500 |
| `91d0224` | fix(ci,docker): 修复 CI Node 20 测试失败与镜像构建、Release 附件上传 |
| `70195c3` | feat: 拆分运行时首页为 docs/home.md，README 保持完整供 GitHub 阅读 |
| `a9b9c3b` | docs: 首页置顶配置接口三条链接（动态本地/动态外网局域网/订阅过滤） |
| `dc16928` | chore: gitignore 排除 AI 助手项目级约束文件 AGENTS.md |

### 上游版本

上游最新版本为 **V1.4.3**（2026-03-22），本分支已在其基础上推进到 V1.5.1。上游完整历史见 [更新记录](docs/updateRecord.md)。

### 已知问题

1. Windows 上直接运行 `index.js` 可能日志中文乱码，建议用 `yarn dev` 或 `npm run dev-win`。
2. `pinyin` 库依赖的 `nodejieba` 已停止维护，无法安装。
3. `new Promise` 内抛出的错误无法被外部 `try/catch` 捕获，可能导致进程崩溃。

---

<p align="center">
  <sub>如果这个项目帮到了你，请给上游 <a href="https://github.com/hjdhnx/drpy-node">hjdhnx/drpy-node</a> 点个 Star。</sub>
</p>
