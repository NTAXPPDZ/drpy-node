import path from 'path';
import {readdirSync, existsSync, createReadStream} from 'fs';
import {readFile, stat as statAsync, writeFile} from 'fs/promises';
import '../utils/marked.min.js';
// import { marked } from "marked";
import {computeHash} from '../utils/utils.js';
import {validateBasicAuth} from "../utils/api_validate.js";
import {daemon} from "../utils/daemonManager.js";
import {toBeijingTime} from "../utils/datetime-format.js"

export default (fastify, options, done) => {
    // 添加 / 接口
    // 首页渲染结果缓存：key = mtimeMs:size，避免每个请求都 readdir + 读文件 + marked 渲染 + 写盘
    let readmeRenderCache = {key: null, html: null};
    let readmePathCache = {dir: null, path: null, isHome: false, checkedAt: 0};

    /**
     * 解析首页 Markdown 路径。
     * 优先 docs/home.md（运行时首页，精简导航页），其次根目录 home.md，最后回退 README.md。
     * README.md 保持完整给 GitHub 展示，不再直接作为 ip:port 的首页。
     */
    function resolveReadmePath() {
        const now = Date.now();
        if (readmePathCache.dir === options.rootDir && now - readmePathCache.checkedAt < 30_000) {
            return readmePathCache;
        }
        let found = null;
        let isHome = false;
        for (const candidate of [path.join(options.docsDir, 'home.md'), path.join(options.rootDir, 'home.md')]) {
            if (existsSync(candidate)) {
                found = candidate;
                isHome = true;
                break;
            }
        }
        if (!found) {
            for (const file of readdirSync(options.rootDir)) {
                if (/^readme\.md$/i.test(file)) {
                    found = path.join(options.rootDir, file);
                    break;
                }
            }
        }
        readmePathCache = {dir: options.rootDir, path: found, isHome, checkedAt: now};
        return readmePathCache;
    }

    fastify.get('/', {preHandler: validateBasicAuth}, async (request, reply) => {
        const indexHtmlPath = path.join(options.rootDir, 'public/index.html');
        const resolved = resolveReadmePath();
        const readmePath = resolved.path;

        if (!readmePath) {
            if (process.env.VERCEL) {
                return reply.type('text/html;charset=utf-8').send(await readFile(indexHtmlPath, 'utf-8'));
            }
            const fileHtml = readdirSync(options.rootDir).map((file) => `<li>${file}</li>`).join('');
            return reply.code(404).type('text/html;charset=utf-8').send(`<h1>README.md not found</h1><ul>${fileHtml}</ul>`);
        }

        const readmeStat = await statAsync(readmePath);
        const cacheKey = `${readmeStat.mtimeMs}:${readmeStat.size}:${process.env.API_PWD || ''}`;
        if (readmeRenderCache.key !== cacheKey || !readmeRenderCache.html) {
            const markdownContent = await readFile(readmePath, 'utf-8');
            const htmlContent = marked.parse(markdownContent).replaceAll('$pwd', process.env.API_PWD || '');
            const indexHtml = [
                '<!DOCTYPE html>',
                '<html lang="en">',
                '<head>',
                '    <meta charset="UTF-8">',
                '    <meta name="viewport" content="width=device-width, initial-scale=1.0">',
                '    <title>drpyS</title>',
                '    <style>',
                '        body { font-family: -apple-system, "Segoe UI", Arial, sans-serif; line-height: 1.7; max-width: 1100px; margin: 0 auto; padding: 20px; color: #222; }',
                '        table { border-collapse: collapse; width: 100%; margin: 12px 0; }',
                '        th, td { border: 1px solid #ddd; padding: 6px 10px; text-align: left; vertical-align: top; }',
                '        th { background: #f5f5f5; }',
                '        code { background: #f4f4f4; padding: 1px 4px; border-radius: 3px; font-family: monospace; }',
                '        pre { background: #f4f4f4; padding: 10px; border-radius: 5px; overflow-x: auto; }',
                '        pre code { background: none; padding: 0; }',
                '        img { max-width: 100%; }',
                '        hr { border: none; border-top: 1px solid #eee; margin: 24px 0; }',
                '        @media (max-width: 640px) { body { padding: 12px; } th, td { padding: 4px 6px; font-size: 14px; } }',
                '    </style>',
                '</head>',
                '<body>',
                `    ${htmlContent}`,
                '</body>',
                '</html>',
            ].join('\n');
            readmeRenderCache = {key: cacheKey, html: indexHtml};

            // 只在内容变化时写盘，且失败不影响响应
            const current = existsSync(indexHtmlPath) ? await readFile(indexHtmlPath, 'utf-8') : null;
            if (current !== indexHtml) {
                await writeFile(indexHtmlPath, indexHtml, 'utf8').catch((error) => {
                    request.log.warn({err: error.message}, 'write public/index.html failed');
                });
            }
        }

        return reply.type('text/html;charset=utf-8').send(readmeRenderCache.html);
    });
    // 轻量指标（P2-06）：文本格式，便于 curl / Prometheus textfile 采集
    fastify.get('/metrics', {preHandler: validateBasicAuth}, async (request, reply) => {
        const memory = process.memoryUsage();
        const snapshot = typeof fastify.getHealthSnapshot === 'function'
            ? fastify.getHealthSnapshot()
            : {status: 'ready', components: {}};
        const lines = [];
        lines.push('# HELP drpy_up 服务是否就绪（1=ready/degraded）');
        lines.push('# TYPE drpy_up gauge');
        lines.push(`drpy_up ${snapshot.status === 'failed' ? 0 : 1}`);
        lines.push('# HELP drpy_component_up 组件状态（1=up）');
        lines.push('# TYPE drpy_component_up gauge');
        for (const [name, component] of Object.entries(snapshot.components || {})) {
            const state = typeof component === 'string' ? component : component && component.status;
            lines.push(`drpy_component_up{component="${name}"} ${state === 'ready' || state === 'up' || state === 'degraded' ? 1 : 0}`);
        }
        lines.push('# HELP drpy_process_heap_bytes 堆内存占用');
        lines.push('# TYPE drpy_process_heap_bytes gauge');
        lines.push(`drpy_process_heap_bytes ${memory.heapUsed}`);
        lines.push('# HELP drpy_process_rss_bytes 常驻内存');
        lines.push('# TYPE drpy_process_rss_bytes gauge');
        lines.push(`drpy_process_rss_bytes ${memory.rss}`);
        lines.push('# HELP drpy_process_uptime_seconds 运行时长');
        lines.push('# TYPE drpy_process_uptime_seconds gauge');
        lines.push(`drpy_process_uptime_seconds ${Math.round(process.uptime())}`);

        try {
            const {getAllCacheStats} = await import('../utils/cache/cacheService.js');
            const stats = getAllCacheStats();
            lines.push('# HELP drpy_cache_entries 缓存条目数');
            lines.push('# TYPE drpy_cache_entries gauge');
            lines.push('# HELP drpy_cache_hits 缓存命中次数');
            lines.push('# TYPE drpy_cache_hits counter');
            for (const [name, item] of Object.entries(stats || {})) {
                lines.push(`drpy_cache_entries{name="${name}"} ${item.size || 0}`);
                lines.push(`drpy_cache_hits{name="${name}"} ${item.hits || 0}`);
            }
        } catch (error) {
            request.log.debug({err: error.message}, 'cache stats unavailable');
        }

        try {
            const {getSingleFlightStats} = await import('../utils/cache/singleFlight.js');
            const inflight = getSingleFlightStats();
            lines.push('# HELP drpy_singleflight_inflight 进行中的合并请求数');
            lines.push('# TYPE drpy_singleflight_inflight gauge');
            lines.push(`drpy_singleflight_inflight ${inflight.inflight || 0}`);
            lines.push('# HELP drpy_singleflight_saved 被合并掉的重复请求数');
            lines.push('# TYPE drpy_singleflight_saved counter');
            lines.push(`drpy_singleflight_saved ${inflight.saved || 0}`);
        } catch (error) {
            request.log.debug({err: error.message}, 'singleflight stats unavailable');
        }

        try {
            const {renderMetrics} = await import('../utils/runtime/metrics.js');
            lines.push(renderMetrics().trimEnd());
        } catch (error) {
            request.log.debug({err: error.message}, 'request metrics unavailable');
        }

        return reply.type('text/plain; version=0.0.4; charset=utf-8').send(lines.join('\n') + '\n');
    });
    // 新增 /robots.txt 路由
    fastify.get('/robots.txt', (request, reply) => {
        const filePath = path.join(options.rootDir, 'public', 'robots.txt');
        const fileStream = createReadStream(filePath);
        // reply.type('text/plain;charset=utf-8').sendFile('robots.txt', path.join(options.rootDir, 'public'));
        reply.type('text/plain;charset=utf-8').send(fileStream);
    });

    // 新增 /favicon.ico 路由
    fastify.get('/favicon.ico', async (request, reply) => {
        try {
            // 设置文件路径
            const faviconPath = path.join(options.rootDir, 'public', 'favicon.ico');

            // 如果文件存在，返回图片
            if (existsSync(faviconPath)) {
                const fileStream = createReadStream(faviconPath);
                // return reply.sendFile('favicon.ico', path.join(options.rootDir, 'public')); // 直接返回图片
                return reply.type('image/x-icon').send(fileStream); // 直接返回图片
            } else {
                reply.status(404).send({error: 'Favicon not found'}); // 如果文件不存在，返回 404 错误
            }
        } catch (error) {
            reply.status(500).send({error: 'Failed to fetch favicon', details: error.message});
        }
    });

    fastify.get('/cat/index.html', {preHandler: validateBasicAuth}, async (request, reply) => {
        try {
            // 设置文件路径
            const catHtmlPath = path.join(options.rootDir, 'data/cat/index.html');

            if (existsSync(catHtmlPath)) {
                const protocol = request.headers['x-forwarded-proto'] || (request.socket.encrypted ? 'https' : 'http');  // http 或 https
                const hostname = request.hostname;
                // const port = request.socket.localPort;  // 获取当前服务的端口
                // let requestUrl = `${protocol}://${hostname}${request.url}`;
                let content = readFileSync(catHtmlPath, 'utf-8');
                // 不再回退到 admin/drpys 之类历史默认口令；未配置凭据时给出不带账号信息的链接
                const validUsername = process.env.API_AUTH_NAME;
                const validPassword = process.env.API_AUTH_CODE;
                let catLink = validUsername && validPassword
                    ? `${protocol}://${encodeURIComponent(validUsername)}:${encodeURIComponent(validPassword)}@${hostname}/config/index.js.md5`
                    : `${protocol}://${hostname}/config/index.js.md5`;
                content = content.replace('$catLink', catLink);
                return reply.type('text/html').send(content);
            } else {
                reply.status(404).send({error: 'Favicon not found'}); // 如果文件不存在，返回 404 错误
            }
        } catch (error) {
            reply.status(500).send({error: 'Failed to fetch cat', details: error.message});
        }
    });

    // 健康检查端点
    fastify.get('/health', async (request, reply) => {
        const snapshot = typeof fastify.getHealthSnapshot === 'function'
            ? fastify.getHealthSnapshot()
            : {status: 'ready', components: {}, degradedReasons: []};
        const ready = snapshot.status === 'ready' || snapshot.status === 'degraded';
        return reply.code(ready ? 200 : 503).send({
            ...snapshot,
            timestamp: toBeijingTime(new Date()),
            python: {
                available: await daemon.isPythonAvailable(),
                daemon_running: daemon.isDaemonRunning()
            }
        });
    });
    done();
};
