import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';

import { ApiError, ErrorCodes, isApiError, toApiError, errorPayload } from '../../utils/runtime/errors.js';
import { redactHeaders, redactUrl, redactObject, REDACTED } from '../../utils/security/redact.js';
import { CacheService } from '../../utils/cache/cacheService.js';
import { singleFlight, getSingleFlightStats, clearInflight } from '../../utils/cache/singleFlight.js';
import { checkCapability, resolveCapability, isReadOnlyMode, CAPABILITIES } from '../../utils/runtime/capabilities.js';
import { writeTextAtomic, writeJsonAtomic, readJson, readText, withFileLock, listDir, clearRepositoryCache } from '../../utils/config/configRepository.js';
import { PathSecurityError } from '../../utils/security/pathGuard.js';
import { getAdminCredentials, isPlaceholderCredential, secureCompare } from '../../utils/security/auth.js';

describe('errors', () => {
    test('ApiError 携带 code/statusCode', () => {
        const error = ApiError.badRequest('bad');
        assert.equal(error.code, ErrorCodes.INVALID_PARAM);
        assert.equal(error.statusCode, 400);
        assert.ok(isApiError(error));
    });

    test('未知错误归为 INTERNAL', () => {
        const error = toApiError(new Error('boom'));
        assert.equal(error.code, ErrorCodes.INTERNAL);
        assert.equal(error.statusCode, 500);
    });

    test('PathSecurityError 映射状态码', () => {
        const error = toApiError(new PathSecurityError('PATH_ESCAPE', 'escape', 403));
        assert.equal(error.code, 'PATH_ESCAPE');
        assert.equal(error.statusCode, 403);
    });

    test('5xx 细节不外泄', () => {
        const payload = errorPayload(new Error('db password is x'), { requestId: 'req-123456' });
        assert.equal(payload.error, 'Internal Server Error');
        assert.equal(payload.requestId, 'req-123456');
    });

    test('4xx expose 时保留原始信息', () => {
        const payload = errorPayload(ApiError.badRequest('module 名非法'), { requestId: 'req-123456' });
        assert.equal(payload.message, 'module 名非法');
        assert.equal(payload.code, ErrorCodes.INVALID_PARAM);
    });
});

describe('redact', () => {
    test('敏感头被脱敏', () => {
        const result = redactHeaders({ authorization: 'Basic abc', cookie: 'a=1', accept: '*/*' });
        assert.equal(result.authorization, REDACTED);
        assert.equal(result.cookie, REDACTED);
        assert.equal(result.accept, '*/*');
    });

    test('URL query 敏感参数被脱敏', () => {
        const result = redactUrl('https://a.com/x?token=abc&wd=电影&pwd=1');
        assert.ok(!result.includes('abc'));
        assert.ok(!result.includes('pwd=1'));
        assert.ok(result.includes('wd='));
    });

    test('嵌套对象递归脱敏', () => {
        const result = redactObject({ headers: { Authorization: 'Bearer x' }, nested: { password: 'p' }, ok: 1 });
        assert.equal(result.headers.Authorization, REDACTED);
        assert.equal(result.nested.password, REDACTED);
        assert.equal(result.ok, 1);
    });
});

describe('cacheService', () => {
    test('条目上限触发淘汰', () => {
        const cache = new CacheService({ namespace: 'test-max', max: 3 });
        for (let i = 0; i < 6; i += 1) cache.set('k' + i, i);
        assert.equal(cache.size, 3);
        assert.ok(cache.getStats().evictions > 0);
    });

    test('TTL 过期后读不到', async () => {
        const cache = new CacheService({ namespace: 'test-ttl', ttl: 20 });
        cache.set('a', 1, 10);
        await new Promise((resolve) => setTimeout(resolve, 40));
        assert.equal(cache.get('a'), null);
    });

    test('命中有统计', () => {
        const cache = new CacheService({ namespace: 'test-hit' });
        cache.set('a', 1);
        cache.get('a');
        cache.get('missing');
        const stats = cache.getStats();
        assert.equal(stats.hits, 1);
        assert.equal(stats.misses, 1);
    });

    test('命名空间隔离', () => {
        const first = new CacheService({ namespace: 'ns1' });
        const second = new CacheService({ namespace: 'ns2' });
        first.set('same', 'x');
        assert.equal(second.get('same'), null);
    });

    test('超长 key 被折叠', () => {
        const cache = new CacheService({ namespace: 'test-long' });
        const longKey = 'x'.repeat(5000);
        cache.set(longKey, 'v');
        assert.equal(cache.get(longKey), 'v');
    });

    test('fetch 命中缓存后不重复执行', async () => {
        const cache = new CacheService({ namespace: 'test-fetch' });
        let calls = 0;
        const factory = async () => {
            calls += 1;
            return 'v';
        };
        assert.equal(await cache.fetch('a', factory), 'v');
        assert.equal(await cache.fetch('a', factory), 'v');
        assert.equal(calls, 1);
    });
});

describe('singleFlight', () => {
    test('并发同 key 只执行一次', async () => {
        clearInflight();
        let calls = 0;
        const factory = async () => {
            calls += 1;
            await new Promise((resolve) => setTimeout(resolve, 20));
            return 'v';
        };
        const results = await Promise.all([singleFlight('k', factory), singleFlight('k', factory), singleFlight('k', factory)]);
        assert.deepEqual(results, ['v', 'v', 'v']);
        assert.equal(calls, 1);
        assert.ok(getSingleFlightStats().joined >= 2);
    });

    test('执行体抛错时其他调用同样收到错误', async () => {
        clearInflight();
        const failing = async () => {
            throw new Error('boom');
        };
        await assert.rejects(() => Promise.all([singleFlight('e', failing), singleFlight('e', failing)]), /boom/);
    });
});

describe('capabilities', () => {
    test('只读模式识别', () => {
        assert.equal(isReadOnlyMode({ READ_ONLY_MODE: '1' }), true);
        assert.equal(isReadOnlyMode({ READ_ONLY_MODE: 'true' }), true);
        assert.equal(isReadOnlyMode({ READ_ONLY_MODE: '0' }), false);
        assert.equal(isReadOnlyMode({}), false);
    });

    test('能力映射', () => {
        assert.equal(resolveCapability('GET', '/api/admin/config'), CAPABILITIES.READ_CONFIG);
        assert.equal(resolveCapability('POST', '/api/admin/config'), CAPABILITIES.WRITE_CONFIG);
        assert.equal(resolveCapability('POST', '/api/admin/terminal/exec'), CAPABILITIES.RUN_TERMINAL);
        assert.equal(resolveCapability('POST', '/api/admin/plugins/install'), CAPABILITIES.WRITE_PLUGIN);
        assert.equal(resolveCapability('POST', '/api/admin/files/write'), CAPABILITIES.WRITE_FILE);
    });

    test('只读模式拦截写、放行读', () => {
        const env = { READ_ONLY_MODE: '1' };
        assert.equal(checkCapability('POST', '/api/admin/config', env).allowed, false);
        assert.equal(checkCapability('GET', '/api/admin/config', env).allowed, true);
        assert.equal(checkCapability('POST', '/api/foo', env).allowed, true);
    });

    test('非只读模式全部放行', () => {
        assert.equal(checkCapability('POST', '/api/admin/config', {}).allowed, true);
    });
});

describe('configRepository', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'drpy-repo-'));

    test('原子写入 + 读取', async () => {
        const file = path.join(dir, 'a.json');
        await writeJsonAtomic(file, { hello: '世界' });
        assert.deepEqual(await readJson(file, null), { hello: '世界' });
        assert.equal(await readText(path.join(dir, 'missing.json')), null);
    });

    test('写入后无残留临时文件', async () => {
        const file = path.join(dir, 'b.json');
        await writeTextAtomic(file, 'x');
        const leftovers = readdirSync(dir).filter((name) => name.endsWith('.tmp'));
        assert.deepEqual(leftovers, []);
    });

    test('并发写同一文件串行完成且内容完整', async () => {
        const file = path.join(dir, 'c.txt');
        await Promise.all(
            Array.from({ length: 20 }, (_, i) =>
                withFileLock(file, () => writeTextAtomic(file, 'value-' + i)),
            ),
        );
        const content = readFileSync(file, 'utf8');
        assert.ok(content.startsWith('value-'));
    });

    test('目录列表可读且带缓存', async () => {
        const entries = await listDir(dir);
        assert.ok(entries.includes('a.json'));
        assert.deepEqual(await listDir(path.join(dir, 'nope')), []);
    });

    test('清理缓存不影响文件', async () => {
        clearRepositoryCache();
        assert.ok(existsSync(path.join(dir, 'a.json')));
    });

    test('清理临时目录', () => {
        rmSync(dir, { recursive: true, force: true });
    });
});

describe('auth 占位口令', () => {
    test('历史默认值被识别为占位', () => {
        assert.equal(isPlaceholderCredential('drpys'), true);
        assert.equal(isPlaceholderCredential('CHANGE_ME_PROXY_AUTH'), true);
        assert.equal(isPlaceholderCredential('your_password'), true);
        assert.equal(isPlaceholderCredential('strong-secret-123'), false);
    });

    test('占位口令不算已配置', () => {
        const result = getAdminCredentials({ API_AUTH_NAME: 'admin', API_AUTH_CODE: 'drpys' });
        assert.equal(result.ok, false);
    });

    test('双缺返回 503 语义', () => {
        const result = getAdminCredentials({});
        assert.equal(result.ok, false);
        assert.equal(result.statusCode, 503);
    });

    test('定长比较', () => {
        assert.equal(secureCompare('abc', 'abc'), true);
        assert.equal(secureCompare('abc', 'abd'), false);
        assert.equal(secureCompare('abc', 'abcd'), false);
        assert.equal(secureCompare(null, 'abc'), false);
    });
});
