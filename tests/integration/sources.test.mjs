/**
 * 集成冒烟：源管理「新增 / 删除」接口
 *  - 未认证 401
 *  - 新增源后文件落盘且出现在列表
 *  - 重名 409、非法名称 400
 *  - 删除后文件消失、列表不再包含
 *  - 删除不存在 404、越界路径 400
 *
 * 只依赖 Node 内置能力，CI 与本地都能跑：npm run test:integration
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// 指向不存在的文件：测试进程不加载仓库本地 .env，保证凭据可复现
const MISSING_ENV_FILE = new URL('./.env.absent.sources.test', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = 16400 + Math.floor(Math.random() * 300);
const WS_PORT = PORT + 500;

const AUTH_ENV = {
    API_AUTH_NAME: 'src-admin',
    API_AUTH_CODE: 'src-secret-1',
    COOKIE_AUTH_CODE: 'src-cookie-1',
    PROXY_AUTH: 'src-proxy-1',
};

const BASIC = 'Basic ' + Buffer.from(AUTH_ENV.API_AUTH_NAME + ':' + AUTH_ENV.API_AUTH_CODE).toString('base64');

const STAMP = Date.now().toString(36);
const SOURCE_NAME = 'zz-inttest' + STAMP;
const SOURCE_REL = 'spider/js/' + SOURCE_NAME + '.js';
const SOURCE_ABS = path.join(ROOT, 'spider', 'js', SOURCE_NAME + '.js');

let child;
let baseUrl;
const logs = [];

async function waitForHealth(url, timeoutMs = 45000) {
    const deadline = Date.now() + timeoutMs;
    let lastError;
    while (Date.now() < deadline) {
        if (child.exitCode !== null) throw new Error('服务提前退出(code=' + child.exitCode + ')：\n' + logs.join(''));
        try {
            const response = await fetch(url + '/health');
            if (response.status < 500) return response;
        } catch (error) {
            lastError = error;
        }
        await new Promise((resolve) => setTimeout(resolve, 300));
    }
    throw new Error('等待 /health 超时：' + (lastError ? lastError.message : '无响应') + '\n' + logs.join(''));
}

function startServer(extraEnv = {}) {
    const proc = spawn(process.execPath, ['index.js'], {
        cwd: ROOT,
        env: Object.assign({}, process.env, {
            NODE_ENV: 'test',
            DOTENV_CONFIG_PATH: MISSING_ENV_FILE,
            PORT: String(PORT),
            WS_PORT: String(WS_PORT),
            DISABLE_PLUGINS: '1',
            DISABLE_PYTHON_DAEMON: '1',
        }, extraEnv),
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    proc.stdout.on('data', (chunk) => logs.push(chunk.toString()));
    proc.stderr.on('data', (chunk) => logs.push(chunk.toString()));
    return proc;
}

async function api(method, url, body) {
    const init = { method: method, headers: { authorization: BASIC } };
    if (body !== undefined) {
        init.headers['content-type'] = 'application/json';
        init.body = JSON.stringify(body);
    }
    const response = await fetch(baseUrl + url, init);
    const text = await response.text();
    let data = null;
    try {
        data = text ? JSON.parse(text) : null;
    } catch {
        data = text;
    }
    return { status: response.status, data: data };
}

before(async () => {
    baseUrl = 'http://127.0.0.1:' + PORT;
    child = startServer(AUTH_ENV);
    await waitForHealth(baseUrl);
});

after(async () => {
    await fsp.rm(SOURCE_ABS, { force: true });
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

test('未认证不能新增源', async () => {
    const response = await fetch(baseUrl + '/api/admin/sources/create', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'no-auth-probe', type: 'js' }),
    });
    assert.equal(response.status, 401);
});

test('新增 js 源：文件落盘且出现在源列表', async () => {
    const created = await api('POST', '/api/admin/sources/create', { name: SOURCE_NAME, type: 'js' });
    assert.equal(created.status, 200, JSON.stringify(created.data));
    assert.equal(created.data.success, true);
    assert.equal(created.data.path, SOURCE_REL);
    assert.equal(created.data.type, 'js');

    const stat = await fsp.stat(SOURCE_ABS);
    assert.ok(stat.isFile(), '源文件应落盘');
    const content = await fsp.readFile(SOURCE_ABS, 'utf-8');
    assert.match(content, /var rule = \{/, '默认内容应为 JS 源模板');

    const listed = await api('GET', '/api/admin/sources');
    assert.equal(listed.status, 200);
    assert.ok(listed.data.js.includes(SOURCE_NAME + '.js'), '新源应出现在源列表');
});

test('同名源重复新增返回 409', async () => {
    const again = await api('POST', '/api/admin/sources/create', { name: SOURCE_NAME, type: 'js' });
    assert.equal(again.status, 409, JSON.stringify(again.data));
});

test('非法源名称返回 400', async () => {
    const badNames = ['../../evil', 'sub/dir', '_hidden', '.dot'];
    for (const name of badNames) {
        const res = await api('POST', '/api/admin/sources/create', { name: name, type: 'js' });
        assert.equal(res.status, 400, '名称 ' + name + ' 应被拒绝，实际 ' + res.status);
    }
});

test('删除源：文件消失且列表移除', async () => {
    const deleted = await api('DELETE', '/api/admin/sources/delete?path=' + encodeURIComponent(SOURCE_REL));
    assert.equal(deleted.status, 200, JSON.stringify(deleted.data));
    assert.equal(deleted.data.success, true);

    await assert.rejects(() => fsp.stat(SOURCE_ABS), /ENOENT/);

    const listed = await api('GET', '/api/admin/sources');
    assert.ok(!listed.data.js.includes(SOURCE_NAME + '.js'), '删除后不应再出现在源列表');
});

test('删除不存在的源返回 404', async () => {
    const res = await api('DELETE', '/api/admin/sources/delete?path=' + encodeURIComponent(SOURCE_REL));
    assert.equal(res.status, 404, JSON.stringify(res.data));
});

test('删除越界路径被拒绝', async () => {
    const res = await api('DELETE', '/api/admin/sources/delete?path=' + encodeURIComponent('spider/js/../../package.json'));
    assert.ok([400, 403].includes(res.status), '越界路径必须被拒绝，实际 ' + res.status);
});
