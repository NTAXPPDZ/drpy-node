/**
 * Fastify 5 升级业务回归脚本 v2（临时，验证后可删）。
 * 用法: node scripts/regression-fastify5.mjs http://127.0.0.1:3481 <user> <pass> [apiPwd]
 */
import WebSocket from 'ws';

const base = process.argv[2] || 'http://127.0.0.1:3481';
const user = process.argv[3] || '';
const pass = process.argv[4] || '';
const apiPwd = process.argv[5] || '';
const auth = user && pass ? 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64') : null;
const wsBase = base.replace(/^http/, 'ws');

const rows = [];
async function hit(label, path, opts = {}) {
    const headers = { ...(opts.headers || {}) };
    if (opts.auth !== false && auth) headers.Authorization = auth;
    const t0 = Date.now();
    try {
        const r = await fetch(base + path, { method: opts.method || 'GET', headers, body: opts.body, redirect: 'manual' });
        let body = '';
        try { body = (await r.text()).slice(0, 160); } catch { /* ignore */ }
        rows.push({ label, status: r.status, ms: Date.now() - t0, ct: (r.headers.get('content-type') || '').split(';')[0], body });
        return { status: r.status, body };
    } catch (e) {
        rows.push({ label, status: 'ERR', ms: Date.now() - t0, ct: '', body: e.message });
        return { status: 0, body: e.message };
    }
}

const J = { 'content-type': 'application/json' };
const F = { 'content-type': 'application/x-www-form-urlencoded' };
const q = apiPwd ? `pwd=${apiPwd}` : 'pwd=x';

// ── A. 核心与可观测
await hit('健康检查', '/health');
await hit('指标 Prometheus', '/metrics');
await hit('首页 HTML', '/');
await hit('favicon', '/favicon.ico');

// ── B. @fastify/static 全部前缀（v10 decorateReply 行为回归重点）
for (const p of ['/public/index.html', '/public/axios.min.js', '/public/favicon.ico', '/js/55影视.js',
    '/json/live2cms.json', '/apps/', '/dr2/', '/py/', '/cat/', '/index/', '/txt/']) {
    await hit(`静态 ${p}`, p);
}

// ── C. @fastify/formbody（v9）表单解析
await hit('formbody 表单', '/api/admin/sources/validate', { method: 'POST', headers: F, body: 'name=x' });

// ── D. 管理面（@fastify/websocket v11 之外的全部管理路由）
for (const p of ['/api/admin/health', '/api/admin/routes', '/api/admin/config', '/api/admin/env',
    '/api/admin/version', '/api/admin/sources', '/api/admin/sources/template', '/api/admin/sources/libs',
    '/api/admin/files/list?path=json', '/api/admin/db/tables', '/api/admin/plugins',
    '/api/admin/logs?lines=3', '/api/admin/backup/config', '/api/admin/terminal/status',
    '/api/admin/sub/files', '/api/admin/docs']) {
    await hit(`管理 ${p}`, p);
}
await hit('管理 health 无认证', '/api/admin/health', { auth: false });
await hit('管理 写操作拦截', '/api/admin/config', { method: 'POST', headers: J, body: '{}' });
await hit('管理 终端 WS 状态', '/api/admin/terminal/ws', { auth: false });

// ── E. 业务 API（真实 drpyS 源：分类 / 列表 / 详情）
const SRC = encodeURIComponent('55影视');
await hit('api 空模块', '/api/');
await hit('api 不存在模块', '/api/__nope__');
await hit('api 无 pwd', `/api/${SRC}?do=ds&ac=class`);
await hit('api 源分类', `/api/${SRC}?do=ds&ac=class&${q}`);
await hit('api 源首页', `/api/${SRC}?do=ds&ac=home&${q}`);
await hit('api 源二级列表', `/api/${SRC}?do=ds&ac=videolist&t=2&pg=1&${q}`);
await hit('api 源搜索', `/api/${SRC}?do=ds&ac=videolist&wd=${encodeURIComponent('火影')}&${q}`);
await hit('api 源详情', `/api/${SRC}?do=ds&ac=detail&ids=${encodeURIComponent('https://www.55kpw.com/vod/55990.html')}&${q}`);
await hit('api 路径穿越拦截', '/api/..%2f..%2findex');

// ── F. 配置 / 工具类路由
await hit('config index.js', '/config/index.js');
await hit('config 穿越拦截', '/config/../index.js');
await hit('parse 路由', `/parse/jx1?url=${encodeURIComponent('https://x/y.m3u8')}&${q}`);
await hit('decoder', `/decoder?${q}`);
await hit('encoder', `/encoder?${q}`);
await hit('authcoder', `/authcoder?${q}`);
await hit('index 页', '/index');
await hit('tasks 列表', '/tasks');
await hit('tasks 单项', '/tasks/__nope__');
await hit('clipboard 读', '/clipboard/read');
await hit('docs 静态', '/docs/');
await hit('docs 穿越拦截', '/docs/../index.js');

// ── G. 代理类（3 个 proxy 子系统的 health / info / status）
for (const p of ['/m3u8-proxy/health', '/m3u8-proxy/playlist', '/m3u8-proxy/status',
    '/unified-proxy/health', '/unified-proxy/status', '/file-proxy/health', '/file-proxy/info',
    '/file-proxy/status', '/ftp/health', '/ftp/status']) {
    await hit(`代理 ${p}`, p);
}

// ── H. 路由边界行为（v5 改动重点）
await hit('405 方法不允许', '/health', { method: 'DELETE' });
await hit('404 信封', '/nope-404');
await hit('CORS 预检', '/health', { method: 'OPTIONS', headers: { Origin: 'http://example.com', 'Access-Control-Request-Method': 'GET' } });
await hit('trailing slash', '/health/');
await hit('超长 URL', '/health?x=' + 'a'.repeat(4000));
await hit('无效 JSON body', '/api/admin/config', { method: 'POST', headers: J, body: '{bad' });

// ── I. WebSocket（@fastify/websocket v11 握手）
async function wsTest() {
    return new Promise((resolve) => {
        const t0 = Date.now();
        let done = false;
        const finish = (ok, note) => {
            if (done) return;
            done = true;
            rows.push({ label: 'WS /ws 握手', status: ok ? 'OK' : 'ERR', ms: Date.now() - t0, ct: 'websocket', body: note.slice(0, 160) });
            try { sock.close(); } catch { /* ignore */ }
            resolve();
        };
        const headers = auth ? { Authorization: auth } : {};
        const sock = new WebSocket(`${wsBase}/ws`, { headers });
        sock.on('message', (d) => finish(true, String(d)));
        sock.on('error', (e) => finish(false, e.message));
        sock.on('open', () => setTimeout(() => finish(false, 'open 但无消息'), 3000));
    });
}
await wsTest();

// ── J. 并发压测（100 并发 × 健康检查，验证 v5 无内存/句柄问题）
async function loadTest() {
    const t0 = Date.now();
    const N = 100;
    const res = await Promise.all(Array.from({ length: N }, () =>
        fetch(base + '/health', { headers: auth ? { Authorization: auth } : {} }).then(r => r.status).catch(() => 0)));
    const ok = res.filter(s => s === 200).length;
    rows.push({ label: `并发 ${N}x /health`, status: ok === N ? 'OK' : 'ERR', ms: Date.now() - t0, ct: '', body: `${ok}/${N} 成功` });
}
await loadTest();

// ── 输出
const pad = (s, n) => String(s).padEnd(n);
console.log(pad('状态', 6) + pad('耗时', 9) + pad('类型', 22) + '用例');
console.log('-'.repeat(96));
for (const r of rows) console.log(pad(r.status, 6) + pad(r.ms + 'ms', 9) + pad(r.ct, 22) + r.label);

const bad = rows.filter(r => r.status === 'ERR' || (typeof r.status === 'number' && r.status >= 500));
console.log(`\n合计 ${rows.length} 条；5xx/ERR ${bad.length} 条`);
if (bad.length) for (const b of bad) console.log(`  ⚠ ${b.label} → ${b.status} ${b.body.replace(/\s+/g, ' ').slice(0, 120)}`);
