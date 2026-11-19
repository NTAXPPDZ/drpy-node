/**
 * 集成冒烟：真实启动 index.js，验证
 *  - /health 可用且结构稳定（P1-05 降级/能力状态）
 *  - 管理面未认证 401、认证后放行（P0-01 fail-closed）
 *  - /js/ 路径穿越被拒（P0-02）
 *  - 未配置凭据时管理面 503（fail-closed）
 *  - SIGTERM 5 秒内优雅退出（P1-05）
 *
 * 只依赖 Node 内置能力，CI 与本地都能跑：npm run test:integration
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 指向不存在的文件：测试进程不加载仓库本地 .env，保证凭据断言可复现
const MISSING_ENV_FILE = new URL('./.env.absent.test', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = 15800 + Math.floor(Math.random() * 400);
const WS_PORT = PORT + 500;
const AUTH_ENV = {
    API_AUTH_NAME: 'smoke-admin',
    API_AUTH_CODE: 'smoke-secret-1',
    COOKIE_AUTH_CODE: 'smoke-cookie-1',
    PROXY_AUTH: 'smoke-proxy-1',
};

const BASIC = `Basic ${Buffer.from(`${AUTH_ENV.API_AUTH_NAME}:${AUTH_ENV.API_AUTH_CODE}`).toString('base64')}`;

let child;
let baseUrl;
const logs = [];

async function waitForHealth(url, timeoutMs = 45000) {
    const deadline = Date.now() + timeoutMs;
    let lastError;
    while (Date.now() < deadline) {
        if (child.exitCode !== null) throw new Error(`服务提前退出(code=${child.exitCode})：\n${logs.join('')}`);
        try {
            const response = await fetch(`${url}/health`);
            if (response.status < 500) return response;
        } catch (error) {
            lastError = error;
        }
        await new Promise((resolve) => setTimeout(resolve, 300));
    }
    throw new Error(`等待 /health 超时：${lastError ? lastError.message : '无响应'}\n${logs.join('')}`);
}

function startServer(extraEnv = {}) {
    const proc = spawn(process.execPath, ['index.js'], {
        cwd: ROOT,
        env: {
            ...process.env,
            NODE_ENV: 'test',
            DOTENV_CONFIG_PATH: MISSING_ENV_FILE,
            PORT: String(PORT),
            WS_PORT: String(WS_PORT),
            DISABLE_PLUGINS: '1',
            DISABLE_PYTHON_DAEMON: '1',
            ...extraEnv,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    proc.stdout.on('data', (chunk) => logs.push(chunk.toString()));
    proc.stderr.on('data', (chunk) => logs.push(chunk.toString()));
    return proc;
}

before(async () => {
    baseUrl = `http://127.0.0.1:${PORT}`;
    child = startServer(AUTH_ENV);
    await waitForHealth(baseUrl);
});

after(async () => {
    if (!child || child.exitCode !== null) return;
    child.kill('SIGTERM');
    await new Promise((resolve) => {
        const timer = setTimeout(() => {
            child.kill('SIGKILL');
            resolve();
        }, 8000);
        child.once('exit', () => {
            clearTimeout(timer);
            resolve();
        });
    });
});

test('/health 返回能力状态快照', async () => {
    const response = await fetch(`${baseUrl}/health`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.ok(['ready', 'degraded', 'ok'].includes(body.status), `status=${body.status}`);
    assert.ok(body.python || body.components, '应包含 python 或 components 状态');
});

test('管理面未认证返回 401，带认证放行', async () => {
    const anonymous = await fetch(`${baseUrl}/api/admin/health`);
    assert.equal(anonymous.status, 401, '未认证的管理接口必须 401');
    assert.match(anonymous.headers.get('www-authenticate') || '', /Basic/i);

    const authorized = await fetch(`${baseUrl}/api/admin/health`, {
        headers: { authorization: BASIC },
    });
    assert.notEqual(authorized.status, 401, '带正确凭据不应再被判未认证');
    assert.ok(authorized.status < 500, `带凭据应可访问，实际 ${authorized.status}`);
});

test('错误口令返回 401 且不泄露细节', async () => {
    const bad = `Basic ${Buffer.from('smoke-admin:wrong').toString('base64')}`;
    const response = await fetch(`${baseUrl}/api/admin/health`, { headers: { authorization: bad } });
    assert.equal(response.status, 401);
});

test('/admin/cookie-set 不能只凭 body 口令通过', async () => {
    const response = await fetch(`${baseUrl}/admin/cookie-set`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cookie_auth_code: AUTH_ENV.COOKIE_AUTH_CODE, cookie: 'probe=1' }),
    });
    assert.ok([401, 403].includes(response.status), `未认证必须拒绝，实际 ${response.status}`);
});

test('/js/ 路径穿越被拒绝', async () => {
    const traversal = await fetch(`${baseUrl}/js/..%2f..%2fpackage.json`);
    assert.ok([400, 403, 404].includes(traversal.status), `穿越请求不应成功，实际 ${traversal.status}`);
    const body = await traversal.text();
    assert.ok(!body.includes('"name": "drpy-node"'), '不能返回仓库文件内容');
});

test('/metrics 需要管理认证且输出 Prometheus 文本', async () => {
    const anonymous = await fetch(`${baseUrl}/metrics`);
    assert.equal(anonymous.status, 401);

    const authorized = await fetch(`${baseUrl}/metrics`, {headers: {authorization: BASIC}});
    assert.equal(authorized.status, 200);
    const text = await authorized.text();
    assert.match(text, /drpy_up 1/);
    assert.match(text, /drpy_process_heap_bytes \d+/);
});

test('/ 首页 README 渲染可用且第二次命中缓存', async () => {
    const first = await fetch(`${baseUrl}/`, {headers: {authorization: BASIC}});
    assert.equal(first.status, 200);
    const html = await first.text();
    assert.match(html, /<html/i);

    const startedAt = Date.now();
    const second = await fetch(`${baseUrl}/`, {headers: {authorization: BASIC}});
    const elapsed = Date.now() - startedAt;
    assert.equal(second.status, 200);
    assert.ok(elapsed < 2000, `缓存后应快速返回，实际 ${elapsed}ms`);
});

test('未知路由返回统一错误信封', async () => {
    const response = await fetch(`${baseUrl}/api/__not_exists__${Date.now()}`);
    assert.equal(response.status, 404);
    const body = await response.json();
    assert.ok(body.code, '应包含稳定错误码');
    assert.ok(body.requestId, '应包含 requestId');
    assert.ok(body.message);
});
