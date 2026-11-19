import { performance } from 'perf_hooks';
const startTime = performance.now();

import * as fastlogger from './controllers/fastlogger.js'
import path from 'path';
import {checkPhpAvailable} from './utils/phpEnv.js';
import os from 'os';
import qs from 'qs';
import {fileURLToPath} from 'url';
import {validateBasicAuth, validateJs, validatePwd, validatHtml} from "./utils/api_validate.js";
import {sendError} from "./utils/runtime/errors.js";
import {getRequestId, registerRequestContext} from "./utils/runtime/requestContext.js";
import {registerMetricsHooks} from './utils/runtime/metrics.js';
import {registerCapabilityGuard} from "./utils/runtime/capabilities.js";
import {getAdminCredentials, isAdminPath} from "./utils/security/auth.js";
import {startAllPlugins} from "./utils/pluginManager.js";
import { PROJECT_ROOT } from "./utils/pathHelper.js";
// 注册自定义import钩子
import './utils/esm-register.mjs';
// 引入python守护进程
import {daemon} from "./utils/daemonManager.js";
// 注册控制器
import {registerRoutes, registerWsRoutes} from './controllers/index.js';
import {createLogger as __createLogger} from './utils/logger.js';
const _log = __createLogger('index');

const {fastify, wsApp} = fastlogger;

// 获取当前路径
const __dirname = PROJECT_ROOT;
// 端口可配置（便于多实例/集成测试），默认值与历史行为一致
const PORT = Number.parseInt(process.env.PORT ?? '', 10) || 5757;
const WsPORT = Number.parseInt(process.env.WS_PORT ?? '', 10) || 57575;
// 关闭外部副作用（CI / 集成测试用）
const DISABLE_PLUGINS = process.env.DISABLE_PLUGINS === '1';
const DISABLE_PYTHON_DAEMON = process.env.DISABLE_PYTHON_DAEMON === '1';
const SHUTDOWN_TIMEOUT_MS = Number.parseInt(process.env.SHUTDOWN_TIMEOUT_MS ?? '', 10) || 5000;
const MAX_TEXT_SIZE = process.env.MAX_TEXT_SIZE || 0.1 * 1024 * 1024; // 设置最大文本大小为 0.1 MB
const MAX_IMAGE_SIZE = process.env.MAX_IMAGE_SIZE || 0.5 * 1024 * 1024; // 设置最大图片大小为 500 KB
// 定义options的目录
const rootDir = __dirname;
const docsDir = path.join(__dirname, 'docs');
const jxDir = path.join(__dirname, 'jx');
const publicDir = path.join(__dirname, 'public');
const appsDir = path.join(__dirname, 'apps');
const jsonDir = path.join(__dirname, 'json');
const jsDir = path.join(__dirname, 'spider/js');
const dr2Dir = path.join(__dirname, 'spider/js_dr2');
const pyDir = path.join(__dirname, 'spider/py');
const phpDir = path.join(__dirname, 'spider/php');
const catDir = path.join(__dirname, 'spider/catvod');
const catLibDir = path.join(__dirname, 'spider/catLib');
const xbpqDir = path.join(__dirname, 'spider/xbpq');
const configDir = path.join(__dirname, 'config');

// 异步启动插件，不阻塞主线程
let pluginProcs = {};
if (!DISABLE_PLUGINS) {
    setTimeout(() => {
        pluginProcs = startAllPlugins(__dirname);
    }, 0);
}

// 运行状态快照：供 /health 暴露能力状态（P1-05）
const healthState = {
    status: 'starting',
    startedAt: Date.now(),
    version: process.env.npm_package_version || null,
    degradedReasons: [],
    components: {php: false, python: false, plugins: null, adminAuth: false, ws: false},
};

function markDegraded(reason) {
    if (!healthState.degradedReasons.includes(reason)) healthState.degradedReasons.push(reason);
    if (healthState.status !== 'stopping') healthState.status = 'degraded';
}

// 启动时检查管理面凭据完整性：缺配置直接告警（接口层 fail-closed 返回 503）
function checkStartupConfig() {
    const credentials = getAdminCredentials();
    healthState.components.adminAuth = credentials.ok;
    if (!credentials.ok) {
        markDegraded('admin-auth');
        fastify.log.error({
            code: credentials.code,
        }, `[安全] 管理面认证未配置（API_AUTH_NAME / API_AUTH_CODE），管理接口将返回 ${credentials.statusCode}。请配置环境变量后重启。`);
    }
    const weakSecrets = ['API_AUTH_CODE', 'COOKIE_AUTH_CODE', 'DOWNLOAD_AUTH_SECRET', 'PROXY_AUTH']
        .filter((key) => process.env[key] === 'drpys' || process.env[key] === 'drpys_download_secret');
    if (weakSecrets.length > 0) {
        fastify.log.warn({keys: weakSecrets}, '[安全] 正在使用历史默认口令，请尽快更换');
    }
    if (!process.env.PROXY_AUTH) {
        fastify.log.warn('[安全] PROXY_AUTH 未配置，代理接口将拒绝未授权访问');
    }
}

// 添加钩子事件
fastify.addHook('onReady', async () => {
    await checkPhpAvailable();
    const endTime = performance.now();
    _log.info(`🚀 Server started in ${(endTime - startTime).toFixed(2)}ms`);
    checkStartupConfig();
    try {
        if (!process.env.VERCEL && !DISABLE_PYTHON_DAEMON) {
            await daemon.startDaemon();
            healthState.components.python = true;
            fastify.log.info('Python守护进程已启动');
        } else {
            fastify.log.warn('已跳过 Python 守护进程（DISABLE_PYTHON_DAEMON=1 或 Vercel 环境）');
        }
    } catch (error) {
        markDegraded('python-daemon');
        fastify.log.error(`启动Python守护进程失败: ${error.message}`);
        fastify.log.error('Python相关功能将不可用');
    }
});

async function onClose() {
    try {
        await daemon.stopDaemon();
        fastify.log.info('Python守护进程已停止');
    } catch (error) {
        fastify.log.error(`停止Python守护进程失败: ${error.message}`);
    }
}

// 停止时清理守护进程
fastify.addHook('onClose', async () => {
    await onClose();
});

// 管理面 / 静态插件中心统一鉴权（fail-closed，P0-01）
// 覆盖：/apps/*、/admin*、/api/admin*；源码目录 /js/、/py/ 走接口密码 + 路径校验
// 例外：/admin/download* 依赖其自身的下载 token，不再叠加 Basic，避免破坏分享链接
fastify.addHook('preHandler', (req, reply, done) => {
    const rawUrl = req.raw.url || '';
    if (rawUrl.startsWith('/js/') || rawUrl.startsWith('/py/')) {
        validatePwd(req, reply)
            .then(() => {
                if (reply.sent) return undefined;
                return validateJs(req, reply, dr2Dir);
            })
            .then(() => {
                if (!reply.sent) done();
            })
            .catch(done);
        return;
    }
    const isTokenDownload = rawUrl.startsWith('/admin/download');
    const needsAdminAuth = !isTokenDownload && (rawUrl.startsWith('/apps/') || isAdminPath(rawUrl));
    if (!needsAdminAuth) {
        done();
        return;
    }
    validateBasicAuth(req, reply, () => {
        if (rawUrl.includes('clipboard-pusher/index.html')) {
            validatHtml(req, reply, rootDir).then(() => done()).catch(done);
            return;
        }
        done();
    });
});

// 自定义插件替换 querystring 解析行为.避免出现两个相同参数被解析成列表
fastify.addHook('onRequest', async (req, reply) => {
    // 获取原始 URL 中的 query 部分
    const rawUrl = req.raw.url;
    const urlParts = rawUrl.split('?');
    const urlPath = urlParts[0];
    let rawQuery = urlParts.slice(1).join('?'); // 处理可能存在的多个 '?' 情况
    // log('rawQuery:', rawQuery);
    // 使用 qs 库解析 query 参数，确保兼容参数值中包含 '?' 的情况
    req.query = qs.parse(rawQuery, {
        strictNullHandling: true, // 确保 `=` 被解析为空字符串
        arrayLimit: 100,         // 自定义数组限制
        allowDots: false,        // 禁止点号表示嵌套对象
    });
    // 如果需要，可以在这里对 req.query 进行进一步处理
});

// 进程级错误：记录后优雅关闭并退出，避免带着未知状态继续服务
async function exitAfterFatal(error, label) {
    fastify.log.fatal({err: error}, `${label}，进程即将退出`);
    try {
        await gracefulShutdown(label, 1);
    } catch {
        process.exit(1);
    }
}

process.on('uncaughtException', (err) => {
    exitAfterFatal(err, '未捕获异常');
});

process.on('unhandledRejection', (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    if (process.env.UNHANDLED_REJECTION_TOLERANT === '1') {
        fastify.log.error({err}, '未处理的Promise拒绝（容忍模式，不退出）');
        return;
    }
    exitAfterFatal(err, '未处理的Promise拒绝');
});

// 统一优雅关闭：顺序关闭，整体受 SHUTDOWN_TIMEOUT_MS 约束（默认 5s）
let shuttingDown = false;
const gracefulShutdown = async (reason, exitCode = 0) => {
    if (shuttingDown) return false;
    shuttingDown = true;
    healthState.status = 'stopping';
    fastify.log.info(`收到 ${reason}，开始优雅关闭（上限 ${SHUTDOWN_TIMEOUT_MS}ms）`);
    const closeAll = async () => {
        await Promise.resolve(onClose()).catch((error) => fastify.log.error(`关闭Python守护进程失败: ${error.message}`));
        await stopWebSocketServer();
        await fastify.close();
        const {stopAllPlugins} = await import('./utils/pluginManager.js');
        await stopAllPlugins(pluginProcs);
    };
    let timer;
    const deadline = new Promise((resolve) => {
        timer = setTimeout(resolve, SHUTDOWN_TIMEOUT_MS);
        if (typeof timer.unref === 'function') timer.unref();
    });
    try {
        await Promise.race([closeAll(), deadline]);
        fastify.log.info('所有服务已关闭');
    } catch (error) {
        fastify.log.error(`关闭服务器时出错: ${error.message}`);
        exitCode = exitCode || 1;
    } finally {
        clearTimeout(timer);
        process.exit(exitCode);
    }
};

const handleExit = (signal) => {
    gracefulShutdown(signal, 0).catch(() => process.exit(1));
};

// 捕获常见退出信号（Linux 上 pm2 stop 会发 SIGINT 或 SIGTERM）
['SIGINT', 'SIGTERM', 'SIGUSR2'].forEach((sig) => {
    process.on(sig, () => handleExit(sig));
});

// Windows 上的兼容处理：捕获 Ctrl+C
if (process.platform === 'win32') {
    const rl = (await import('readline')).createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    rl.on('SIGINT', () => {
        handleExit('SIGINT');
    });
}

// 捕获 Node.js 主动退出（比如 pm2 stop 也会触发 exit）
process.on('exit', async (code) => {
    _log.info(`Process exiting with code: ${code}`);
    // 这里不能直接用 await fastify.close()（Node 在 exit 里不等异步）
    // 但 Fastify 的 SIGINT/SIGTERM 会提前触发，所以这里只记录日志
    for (const [name, proc] of Object.entries(pluginProcs)) {
        _log.info(`[pluginManager] 结束插件 ${name} ${proc.pid}`);
        proc.kill();
    }
});

// 请求上下文与统一错误出口（P1-06）：必须在路由注册之前挂到根实例，子插件才能继承
registerRequestContext(fastify);
registerMetricsHooks(fastify);

// 只读模式能力守卫（P1-07）：READ_ONLY_MODE=1 时统一拦截管理面写操作
registerCapabilityGuard(fastify);

fastify.setErrorHandler((error, request, reply) => {
    return sendError(reply, error, {requestId: getRequestId(request)});
});

// 只接管 /api/* 的 404：根路径的 notFound 归属 SPA 路由插件（controllers/fastify-spa-routes.js）
fastify.register((instance, _opts, done) => {
    instance.setNotFoundHandler((request, reply) => {
        return sendError(reply, {
            statusCode: 404,
            code: 'NOT_FOUND',
            message: `接口不存在: ${request.method} ${request.url}`,
        }, {requestId: getRequestId(request)});
    });
    done();
}, {prefix: '/api'});

// /health 路由由 controllers/root.js 注册；这里只暴露运行状态快照给它使用
fastify.decorate('healthState', healthState);
fastify.decorate('getHealthSnapshot', () => ({
    status: healthState.status,
    uptimeMs: Date.now() - healthState.startedAt,
    components: {...healthState.components, plugins: pluginProcs ? Object.keys(pluginProcs).length : 0},
    degradedReasons: [...healthState.degradedReasons],
    runtime: {node: process.version, platform: process.platform},
}));

const registerOptions = {
    rootDir,
    docsDir,
    jxDir,
    publicDir,
    appsDir,
    jsonDir,
    jsDir,
    dr2Dir,
    pyDir,
    phpDir,
    catDir,
    catLibDir,
    xbpqDir,
    PORT,
    WsPORT,
    MAX_TEXT_SIZE,
    MAX_IMAGE_SIZE,
    configDir,
    indexFilePath: path.join(__dirname, 'index.json'),
    customFilePath: path.join(__dirname, 'custom.json'),
    subFilePath: path.join(__dirname, 'public/sub/sub.json'),
    wsApp,
    fastify,
};
registerRoutes(fastify, registerOptions);
registerWsRoutes(wsApp, registerOptions);

// 启动WebSocket服务器
const startWebSocketServer = async (option) => {
    try {
        const address = await wsApp.listen(option);
        return wsApp;
    } catch (err) {
        wsApp.log.error(`WebSocket服务器启动失败,将会影响一些实时弹幕源的使用:${err.message}`);
    }
};

// 停止WebSocket服务器
const stopWebSocketServer = async () => {
    try {
        await wsApp.server.close();
        wsApp.log.info('WebSocket服务器已停止');
    } catch (err) {
        wsApp.log.error(`停止WebSocket服务器失败:${err.message}`);
    }
};

// 启动服务
const start = async () => {
    try {
        // 启动 Fastify 主服务
        // await fastify.listen({port: PORT, host: '0.0.0.0'});
        await fastify.listen({port: PORT, host: '::'});
        // 启动 WebSocket 服务器
        const wsServer = await startWebSocketServer({port: WsPORT, host: '::'});
        healthState.components.ws = !!wsServer;
        if (!wsServer) markDegraded('websocket');
        if (healthState.status === 'starting') healthState.status = 'ready';

        // 获取本地和局域网地址
        const localAddress = `http://localhost:${PORT}`;
        const wsLocalAddress = `http://localhost:${WsPORT}`;
        const interfaces = os.networkInterfaces();
        let lanAddress = 'Not available';
        let wsLanAddress = 'Not available';
        // _log.info('interfaces:', interfaces);
        for (const [key, iface] of Object.entries(interfaces)) {
            if (key.startsWith('VMware Network Adapter VMnet') || !iface) continue;
            for (const config of iface) {
                if (config.family === 'IPv4' && !config.internal) {
                    lanAddress = `http://${config.address}:${PORT}`;
                    wsLanAddress = `http://${config.address}:${WsPORT}`;
                    break;
                }
            }
        }

        _log.info(`🚀 服务器启动成功:`);
        _log.info(`📡 主服务 (端口 ${PORT}):`);
        _log.info(`  - Local: ${localAddress}`);
        _log.info(`  - LAN:   ${lanAddress}`);
        _log.info(`🔌 WebSocket服务 (端口 ${WsPORT}):`);
        _log.info(`  - Local: ${wsLocalAddress}`);
        _log.info(`  - LAN:   ${wsLanAddress}`);
        _log.info(`⚙️  系统信息:`);
        _log.info(`  - PLATFORM: ${process.platform} ${process.arch}`);
        _log.info(`  - VERSION:  ${process.version}`);
        if (process.env.VERCEL) {
            _log.info('Running on Vercel!');
            _log.info('Vercel Environment:', process.env.VERCEL_ENV); // development, preview, production
            _log.info('Vercel URL:', process.env.VERCEL_URL);
            _log.info('Vercel Region:', process.env.VERCEL_REGION);
        } else {
            _log.info('Not running on Vercel!');
        }
        return true;
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};

// 停止服务
const stop = async () => {
    try {
        // 停止 WebSocket 服务器
        await stopWebSocketServer();
        // 停止主服务器
        await fastify.server.close();
        _log.info('🛑 所有服务已优雅停止');
        return true;
    } catch (err) {
        fastify.log.error(`停止服务器时发生错误:${err.message}`);
        return false;
    }
};

// 导出 start 和 stop 方法
export {start, stop};
export default async function handler(req, res) {
    await fastify.ready()
    fastify.server.emit('request', req, res)
}

// 判断当前模块是否为主模块，如果是主模块，则启动服务
const currentFile = path.normalize(fileURLToPath(import.meta.url)); // 使用 normalize 确保路径一致
const indexFile = path.normalize(path.resolve(__dirname, 'index.js')); // 标准化路径

if (!process.env.VERCEL && currentFile === indexFile) {
    await start();
}
