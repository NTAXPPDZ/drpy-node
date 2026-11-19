/**
 * 集成冒烟 2：只读模式与未配置凭据（P0-01 fail-closed / P1-07 能力表）
 *
 * 场景 A：READ_ONLY_MODE=1
 *   - 管理面写操作 403 + code=READ_ONLY
 *   - 管理面读操作仍放行
 * 场景 B：未配置 COOKIE_AUTH_CODE
 *   - /admin/cookie-set 直接 503 + code=COOKIE_AUTH_NOT_CONFIGURED
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ErrorCodes } from '../../utils/runtime/errors.js';

// 指向不存在的文件：测试进程不加载仓库本地 .env，保证凭据断言可复现
const MISSING_ENV_FILE = new URL('./.env.absent.test', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BASE_PORT = 16400 + Math.floor(Math.random() * 300);

const ADMIN = { name: 'ro-admin', code: '{{SECRET_ro-admin-code}}' };
const BASIC = `Basic ${Buffer.from(`${ADMIN.name}:${ADMIN.code}`).toString('base64')}`;

const children = [];

function startServer(port, extraEnv) {
    const proc = spawn(process.execPath, ['index.js'], {
        cwd: ROOT,
        env: {
            ...process.env,
            NODE_ENV: 'test',
            DOTENV_CONFIG_PATH: MISSING_ENV_FILE,
            PORT: String(port),
            WS_PORT: String(port + 500),
            DISABLE_PLUGINS: '1',
            DISABLE_PYTHON_DAEMON: '1',
            API_AUTH_NAME: ADMIN.name,
            API_AUTH_CODE: ADMIN.code,
            ...extraEnv,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    const logs = [];
    proc.stdout.on('data', (chunk) => logs.push(chunk.toString()));
    proc.stderr.on('data', (chunk) => logs.push(chunk.toString()));
    proc.capturedLogs = logs;

    children.push(proc);
    return proc;
}

async function waitForHealth(proc, url, timeoutMs = 45000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (proc.exitCode !== null) {
            throw new Error('服务提前退出：\n' + proc.capturedLogs.join(''));
        }
        try {
            const response = await fetch(url + '/health');
            if (response.status < 500) return;
        } catch {
            // 继续等待
        }
        await new Promise((resolve) => setTimeout(resolve, 300));
    }
    throw new Error('等待 /health 超时：\n' + proc.capturedLogs.join(''));
}

after(async () => {
    for (const proc of children) {
        if (!proc || proc.exitCode !== null) continue;
        proc.kill('SIGTERM');
        await new Promise((resolve) => {
            const timer = setTimeout(() => {
                proc.kill('SIGKILL');
                resolve();
            }, 8000);
            proc.once('exit', () => {
                clearTimeout(timer);
                resolve();
            });
        });
    }
});

test('只读模式：写操作 403 READ_ONLY，读操作放行', async () => {
    const port = BASE_PORT;
    const proc = startServer(port, { READ_ONLY_MODE: '1' });
    const baseUrl = `http://127.0.0.1:${port}`;

    await waitForHealth(proc, baseUrl);

    const write = await fetch(`${baseUrl}/api/admin/config`, {
        method: 'POST',
        headers: { authorization: BASIC, 'content-type': 'application/json' },
        body: JSON.stringify({ show_req: '1' }),
    });
    assert.equal(write.status, 403, '只读模式下写配置必须 403');
    const writeBody = await write.json();
    assert.equal(writeBody.code, ErrorCodes.READ_ONLY);
    assert.ok(writeBody.requestId);

    const read = await fetch(`${baseUrl}/api/admin/config`, { headers: { authorization: BASIC } });
    assert.ok(read.status < 400, `只读模式下读配置应放行，实际 ${read.status}`);
});

test('未配置 COOKIE_AUTH_CODE：cookie-set 返回 503 而不是静默通过', async () => {
    const port = BASE_PORT + 100;
    const proc = startServer(port, { COOKIE_AUTH_CODE: '' });
    const baseUrl = `http://127.0.0.1:${port}`;

    await waitForHealth(proc, baseUrl);

    const response = await fetch(`${baseUrl}/admin/cookie-set`, {
        method: 'POST',
        headers: { authorization: BASIC, 'content-type': 'application/json' },
        body: JSON.stringify({ cookie_auth_code: 'drpys', key: 'quark_cookie', value: 'a=1' }),
    });

    assert.equal(response.status, 503, '未配置时必须是 503，不能接受历史默认口令');
    const body = await response.json();
    assert.equal(body.code, 'COOKIE_AUTH_NOT_CONFIGURED');
});
