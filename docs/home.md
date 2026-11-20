# drpyS (drpy-node)

Node.js 作为服务端的 drpy 实现，全面升级异步写法。

本仓库是 [hjdhnx/drpy-node](https://github.com/hjdhnx/drpy-node) 的优化分支（当前 **V1.5.1**）：Fastify 5、Node 22 基线、安全止血与可回归性建设。对外接口契约不变。

> ⚠️ **仅供学习研究交流，禁止任何商业用途。完整免责条款见 [README 免责协议](https://github.com/NTAXPPDZ/drpy-node/blob/main/README.md#五免责协议)。**

---

## 配置接口

把下面任意一条粘贴到影视壳子 / 客户端里即可使用。链接里的 `pwd` 已自动填好当前 `API_PWD`。

| 接口 | 链接 | 用途 |
| --- | --- | --- |
| 本地配置接口-动态本地 | [`/config?healthy=1&pwd=$pwd`](/config?healthy=1&pwd=$pwd) | 接口地址固定写 `http://127.0.0.1:端口`，给跑服务这台机器自己用 |
| 本地配置接口-动态外网/局域网 | [`/config/1?healthy=1&pwd=$pwd`](/config/1?healthy=1&pwd=$pwd) | 接口地址跟随你访问时用的域名/IP，换地址不用重新生成 |
| 其他配置接口-订阅过滤 | [订阅过滤说明](/docs/sub.md) | 按分类/关键词过滤订阅内容 |

- **动态本地**：生成的 `api` 字段是 `http://127.0.0.1:<PORT>`，只对服务所在机器有效。
- **动态外网/局域网**：生成的 `api` 字段取你访问时用的 `协议://域名`，所以从手机或外网访问本页复制这条，地址才是对的那个；反代到 80/443 时尤其要用它。
  - ⚠️ 它只取域名**不带端口**。如果你没走反代、直接用 `http://ip:5757` 访问，这条生成的地址会丢掉 `:5757`，此时请用上一条。
- 两条都支持附加参数：`sub=`（订阅码）、`healthy=1`（生成前做源健康检查，慢但可用率高）。
- 详细参数见 [接口文档](/docs/apidoc.md) 与 [订阅过滤说明](/docs/sub.md)。

---

## 快速开始

```bash
npm ci
npm run dev        # 或 npm run pm2 常驻
```

默认端口 `5757`，WebSocket 端口 `57575`，可用 `PORT` / `WS_PORT` 覆盖。

**首次启动必改**（不改等于管理面裸奔）：

| 变量 | 说明 |
| --- | --- |
| `API_AUTH_NAME` / `API_AUTH_CODE` | 管理面 Basic 认证凭据 |
| `API_PWD` | 业务 API 的 `pwd` 参数，也就是上面配置接口里的 `pwd` |
| `ADMIN_SESSION_SECRET` | 管理会话 cookie 的 HMAC 密钥，不配则每次重启随机 |
| `COOKIE_SECURE=1` | HTTPS 部署时开启 |
| `CORS_ALLOWED_ORIGINS` | 跨域白名单，不配则拒绝跨域 |

完整环境变量见 [环境变量说明](/docs/envdoc.md)。

---

## 插件应用

- [Admin 管理面板](/apps/admin)
- [DrPlayer](/apps/drplayer)
- [Websocket 实时日志](/apps/websocket)
- [cookie 管理插件](/apps/cookie-butler/index.html)
- [cron 表达式插件](/apps/cron-generator/index.html)
- [剪切板智能推送](/apps/clipboard-pusher/index.html)
- [DS 源可用性检测](/apps/source-checker/index.html)
- [DS 解析检测](/apps/vip-parser/index.html)
- [DS 源配置编辑](/apps/source-editor/index.html)
- [DS 内存图片管理](/apps/image-manager/index.html)
- [DS 时钟插件](/apps/clock/white_clock.html) | [日历时钟](/apps/clock/index.html)
- [bookReader](/apps/book-reader)
- [系统备份与恢复](/apps/backup-restore/index.html)
- [代码加解密工具](/admin/encoder)
- [在线猫 ds 源主页](/cat/index.html)

---

## 文档索引

| 文档 | 文档 |
| --- | --- |
| [接口文档](/docs/apidoc.md) | [接口列表](/docs/apiList.md) |
| [管理接口](/docs/admin_api.md) | [环境变量说明](/docs/envdoc.md) |
| [订阅过滤](/docs/sub.md) | [关姐算法搭建说明](/docs/suanfa.md) |
| [drpyS 源属性说明](/docs/ruleAttr.md) | [drpy2 写源简述](/docs/ruleDesc.md) |
| [猫源调试教程](/docs/catDebug.md) | [接口压测教程](/docs/httpTest.md) |
| [webdav 使用教程](/docs/webdav.md) | [puppeteer 使用教程](/docs/pupInstall.md) |
| [python 环境](/docs/pyenv.md) | [crypto-js-wasm](/docs/crypto-js-wasm/readme-CN.md) |
| [代码质量评估工具](/docs/codeCheck.md) | [代码评估报告](/docs/codeCheckReport.md) |
| [重要问题记录](/docs/issue.md) | [更新记录](/docs/updateRecord.md) |

---

## 接口参考（开发者）

以下为服务端注册的全部路由，供二次开发与排查使用，日常使用不需要关心。

### 业务接口

| 路径 | 方法 | 说明 |
| --- | --- | --- |
| `/api/:module` | GET / POST | 主 API。`ac`+`t` 分类、`ac`+`ids` 详情、`wd` 搜索、`play` 播放解析、`refresh` 强制刷新；需 `pwd` |
| `/config*` | GET | 配置生成（`/config`、`/config/1`、`/config/index.js.md5` 等），需 `pwd` + Basic |
| `/index` | GET | 首页数据，需 `pwd` |
| `/parse/:jx` | GET | 解析规则 |
| `/req/*` | ALL | 通用代理转发，需认证 |
| `/proxy/:module/*` | GET | 源内代理 |
| `/http` | POST | 通用 HTTP 请求 |
| `/ai` | GET | AI 接口 |
| `/encoder` `/decoder` | POST | 代码加解密 |
| `/authcoder` | GET | 授权码 |
| `/gh/release` | GET | GitHub Release 信息 |

### 服务与运维

| 路径 | 说明 |
| --- | --- |
| `/health` | 健康检查（JSON） |
| `/metrics` | Prometheus 文本指标，需 Basic |
| `/ws` | WebSocket 实时日志；`/ws/status`、`/ws/broadcast` 需 Basic |
| `/docs/*` | 文档，`.md` 自动渲染为 HTML |
| `/tasks`、`/execute-now/:taskName?` | 定时任务查询与立即执行，需 Basic |
| `/clipboard/read`、`/clipboard/add`、`/clipboard/clear` | 剪切板推送 |
| `/image/upload`、`/image/list`、`/image/:imageId`、`/image/memory`、`/image/cleanup` | 内存图片管理 |
| `/source-checker/config/default`、`/source-checker/reports/latest`、`/source-checker/reports/save` | 源可用性检测 |

### 代理子系统

| 路径 | 说明 |
| --- | --- |
| `/m3u8-proxy/playlist`、`/m3u8-proxy/status`、`/m3u8-proxy/health` | HLS 代理与改写 |
| `/mediaProxy` | 媒体透传（支持 Range） |
| `/unified-proxy/health`、`/unified-proxy/status` | 统一智能代理 |
| `/webdav/list`、`/webdav/file`、`/webdav/info`、`/webdav/config`、`/webdav/status`、`/webdav/health` | WebDAV |
| `/ftp/list`、`/ftp/info`、`/ftp/config`、`/ftp/status`、`/ftp/health` | FTP |
| `/file-proxy/info`、`/file-proxy/status`、`/file-proxy/health` | 远程文件代理 |

### 静态与页面

| 前缀 | 内容 |
| --- | --- |
| `/public/` | 公共资源（CSS、JS、图片、油猴脚本） |
| `/apps/` | 插件应用页面 |
| `/js/` `/json/` `/py/` `/php/` | 源脚本与配置 |
| `/cat/` `/catLib/` `/xbpq/` | 猫影视相关文件 |
| `/admin/*` | 管理面板页面（如 `/admin/encoder`、`/admin/download`） |
| `/api/admin/*` | 管理接口，需 Basic 认证 |

完整接口文档：[接口文档](/docs/apidoc.md)、[接口列表](/docs/apiList.md)、[管理接口](/docs/admin_api.md)。

---

## 更多

- [完整 README](https://github.com/NTAXPPDZ/drpy-node/blob/main/README.md) —— 优化清单、验证结果、致谢与免责协议
- [上游仓库 hjdhnx/drpy-node](https://github.com/hjdhnx/drpy-node)
- [DS 本地包下载中心](/admin/download)

本页源码：`docs/home.md`（可直接编辑后刷新生效）。
