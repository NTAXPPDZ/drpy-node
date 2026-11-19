/**
 * P2 模块单元测试：备份服务、源索引、M3U8 改写、Range 解析、指标、统一日志。
 * 使用临时目录，测试结束后清理，不依赖真实项目数据。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// 日志在测试中静默，避免 TAP 输出被业务日志干扰（必须在动态 import 之前设置）
process.env.LOG_LEVEL = 'silent';

async function makeTempProject() {
    const base = await fsp.mkdtemp(path.join(os.tmpdir(), 'drpy-p2-'));
    const root = path.join(base, 'proj');
    await fsp.mkdir(root, { recursive: true });
    return { base, root };
}

// ---------- 备份服务（P2-02） ----------
test('backupService: 备份后可从备份目录恢复被删除的文件', async () => {
    const { base, root } = await makeTempProject();
    try {
        const backup = await import('../../utils/backup/backupService.js');
        await fsp.writeFile(path.join(root, '.env'), 'A=1\n');
        await fsp.mkdir(path.join(root, 'config'), { recursive: true });
        await fsp.writeFile(path.join(root, 'config', 'player.json'), '{"k":1}');

        const created = await backup.createBackup(root);
        assert.ok(created, 'createBackup 应返回结果');
        const backupDir = backup.getBackupRootDir(root);
        assert.equal(fs.existsSync(path.join(backupDir, '.env')), true);
        assert.equal(fs.existsSync(path.join(backupDir, 'config', 'player.json')), true);

        await fsp.rm(path.join(root, '.env'));
        await backup.restoreBackup(root);
        assert.equal(await fsp.readFile(path.join(root, '.env'), 'utf8'), 'A=1\n');
    } finally {
        await fsp.rm(base, { recursive: true, force: true });
        await fsp.rm(path.join(base, 'proj-backup'), { recursive: true, force: true });
    }
});

test('backupService: 备份目录不存在时 restore 抛 BACKUP_NOT_FOUND', async () => {
    const { base, root } = await makeTempProject();
    try {
        const backup = await import('../../utils/backup/backupService.js');
        await assert.rejects(
            () => backup.restoreBackup(root),
            (error) => error instanceof backup.BackupError && error.code === 'BACKUP_NOT_FOUND',
        );
    } finally {
        await fsp.rm(base, { recursive: true, force: true });
    }
});

test('backupService: updateBackupPaths 拒绝非数组输入', async () => {
    const { base, root } = await makeTempProject();
    try {
        const backup = await import('../../utils/backup/backupService.js');
        await assert.rejects(
            () => backup.updateBackupPaths('not-array', root),
            (error) => error instanceof backup.BackupError && error.code === 'INVALID_PARAM',
        );
    } finally {
        await fsp.rm(base, { recursive: true, force: true });
    }
});

// ---------- 源索引（P2-03） ----------
test('sourceIndex: listKindSources 按扩展名过滤并排除 _ 前缀', async () => {
    const { base, root } = await makeTempProject();
    try {
        const idx = await import('../../utils/sources/sourceIndex.js');
        const dir = path.join(root, 'spider', 'js');
        await fsp.mkdir(dir, { recursive: true });
        await fsp.writeFile(path.join(dir, 'a.js'), '');
        await fsp.writeFile(path.join(dir, 'b.js'), '');
        await fsp.writeFile(path.join(dir, '_hidden.js'), '');
        await fsp.writeFile(path.join(dir, 'd.txt'), '');

        assert.deepEqual(await idx.listKindSources(root, 'js'), ['a.js', 'b.js']);
    } finally {
        await fsp.rm(base, { recursive: true, force: true });
    }
});

test('sourceIndex: 目录不存在返回空数组；目录变化后缓存失效', async () => {
    const { base, root } = await makeTempProject();
    try {
        const idx = await import('../../utils/sources/sourceIndex.js');
        assert.deepEqual(await idx.listKindSources(root, 'py'), []);

        const dir = path.join(root, 'spider', 'py');
        await fsp.mkdir(dir, { recursive: true });
        await fsp.writeFile(path.join(dir, 'x.py'), '');
        assert.deepEqual(await idx.listKindSources(root, 'py'), ['x.py']);

        // 显式推进目录 mtime，避免文件系统时间分辨率导致的假阴性
        await fsp.writeFile(path.join(dir, 'y.py'), '');
        const future = new Date(Date.now() + 5000);
        fs.utimesSync(dir, future, future);
        assert.deepEqual(await idx.listKindSources(root, 'py'), ['x.py', 'y.py']);
    } finally {
        await fsp.rm(base, { recursive: true, force: true });
    }
});

// ---------- M3U8 改写（P2-01） ----------
test('m3u8Rewriter: 媒体行与 URI 属性均经代理包装，相对地址按 baseUrl 解析', async () => {
    const { rewriteM3u8Content } = await import('../../utils/proxy/m3u8Rewriter.js');
    const input = [
        '#EXTM3U',
        '#EXT-X-KEY:METHOD=AES-128,URI="key.bin"',
        '#EXTINF:10,',
        'seg1.ts',
        'https://cdn.example.com/abs/seg2.ts',
        '',
        '# 普通注释',
    ].join('\n');
    const out = rewriteM3u8Content(input, {
        baseUrl: 'https://a.example.com/path/index.m3u8',
        buildProxyUrl: (abs) => `P?u=${encodeURIComponent(abs)}`,
    });
    const lines = out.split('\n');
    assert.equal(lines[0], '#EXTM3U');
    assert.equal(lines[1], `#EXT-X-KEY:METHOD=AES-128,URI="P?u=${encodeURIComponent('https://a.example.com/path/key.bin')}"`);
    assert.equal(lines[2], '#EXTINF:10,');
    assert.equal(lines[3], `P?u=${encodeURIComponent('https://a.example.com/path/seg1.ts')}`);
    assert.equal(lines[4], `P?u=${encodeURIComponent('https://cdn.example.com/abs/seg2.ts')}`);
    assert.equal(lines[5], '');
    assert.equal(lines[6], '# 普通注释');
});

test('m3u8Rewriter: createProxyUrlBuilder 生成带编码参数的代理地址', async () => {
    const { createProxyUrlBuilder } = await import('../../utils/proxy/m3u8Rewriter.js');
    const build = createProxyUrlBuilder({
        proxyBaseUrl: 'http://h',
        path: '/m3u8-proxy/ts',
        authCode: 'abc',
        headersParam: '{"a":"b"}',
    });
    const url = build('https://x.com/v.ts?t=1&s=2');
    assert.equal(
        url,
        `http://h/m3u8-proxy/ts?url=${encodeURIComponent('https://x.com/v.ts?t=1&s=2')}&auth=abc&headers=${encodeURIComponent('{"a":"b"}')}`,
    );
});

// ---------- Range 解析（P2-01） ----------
test('rangeStreamer: parseRange 覆盖开区间、闭区间、后缀、越界与非法输入', async () => {
    const { parseRange, contentRange } = await import('../../utils/proxy/rangeStreamer.js');
    assert.deepEqual(parseRange('bytes=0-', 1000), { start: 0, end: 999 });
    assert.deepEqual(parseRange('bytes=0-0', 1000), { start: 0, end: 0 });
    assert.deepEqual(parseRange('bytes=-500', 1000), { start: 500, end: 999 });
    assert.deepEqual(parseRange('bytes=900-2000', 1000), { start: 900, end: 999 });
    assert.equal(parseRange('bytes=1000-', 1000), null);
    assert.equal(parseRange('bytes=abc', 1000), null);
    assert.equal(parseRange('bytes=5-2', 1000), null);
    assert.equal(parseRange('', 1000), null);
    assert.equal(parseRange('bytes=0-', Number.NaN), null);
    assert.equal(contentRange(0, 0, 1000), 'bytes 0-0/1000');
});

// ---------- 指标（P2-05） ----------
test('metrics: Counter 与 Histogram 渲染为 Prometheus 文本，累计桶正确', async () => {
    const { Counter, Histogram } = await import('../../utils/runtime/metrics.js');
    const c = new Counter('t_total', 'test', ['a']);
    c.inc(['x']);
    c.inc(['x'], 2);
    const h = new Histogram('t_seconds', 'test', ['a'], [0.1, 1]);
    h.observe(['x'], 0.05);
    h.observe(['x'], 0.5);
    const lines = [];
    c.render(lines);
    h.render(lines);
    const text = lines.join('\n');
    assert.match(text, /t_total\{a="x"\} 3/);
    assert.match(text, /t_seconds_bucket\{a="x",le="0.1"\} 1/);
    assert.match(text, /t_seconds_bucket\{a="x",le="1"\} 2/);
    assert.match(text, /t_seconds_bucket\{a="x",le="\+Inf"\} 2/);
    assert.match(text, /t_seconds_count\{a="x"\} 2/);
});

test('metrics: 标签值转义，超过基数上限合并到“其余”', async () => {
    const { Counter, MAX_SERIES } = await import('../../utils/runtime/metrics.js');
    const c = new Counter('t2_total', 'test', ['v']);
    c.inc(['a"b\\c']);
    const escaped = [];
    c.render(escaped);
    assert.match(escaped.join('\n'), /t2_total\{v="a\\"b\\\\c"\} 1/);

    for (let i = 0; i < MAX_SERIES + 20; i += 1) c.inc([`v${i}`]);
    assert.ok(c.series.size <= MAX_SERIES + 1, `基数应受控，实际 ${c.series.size}`);
    const rendered = [];
    c.render(rendered);
    assert.match(rendered.join('\n'), /其余/);
});

test('metrics: renderMetrics 含 HTTP 与上游指标头', async () => {
    const { renderMetrics, observeUpstream } = await import('../../utils/runtime/metrics.js');
    observeUpstream('example.com', 'ok', 0.02);
    const text = renderMetrics();
    assert.match(text, /# TYPE drpy_http_requests_total counter/);
    assert.match(text, /# TYPE drpy_upstream_duration_seconds histogram/);
    assert.match(text, /drpy_upstream_requests_total\{target="example.com",outcome="ok"\} 1/);
});

// ---------- 统一日志（P2-04） ----------
test('logger: 文本经 util.format 合并，敏感 key=value 被脱敏，tap 收到 (level,text,module)', async () => {
    const logger = await import('../../utils/logger.js');
    const received = [];
    logger.setLogTap((level, text, moduleName) => received.push({ level, text, moduleName }));
    try {
        const log = logger.createLogger('t/mod');
        log.info('user', 'token=abc123', 3);
        assert.deepEqual(received[0], { level: 'info', text: 'user token=[REDACTED] 3', moduleName: 't/mod' });
    } finally {
        logger.setLogTap(null);
    }
});

test('logger: Basic 凭据在文本中被脱敏', async () => {
    const logger = await import('../../utils/logger.js');
    const received = [];
    logger.setLogTap((level, text) => received.push(text));
    try {
        logger.createLogger('t/basic').warn('header Authorization: Basic YWJjOmRlZg==');
        assert.equal(received[0].includes('YWJjOmRlZg=='), false);
        assert.match(received[0], /\[REDACTED\]/);
    } finally {
        logger.setLogTap(null);
    }
});

test('logger: tap 抛错不影响业务日志调用', async () => {
    const logger = await import('../../utils/logger.js');
    logger.setLogTap(() => { throw new Error('boom'); });
    try {
        const log = logger.createLogger('t/throw');
        assert.doesNotThrow(() => log.error('still works'));
    } finally {
        logger.setLogTap(null);
    }
});
