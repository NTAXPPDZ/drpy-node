import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, realpathSync, rmSync } from 'node:fs';

import {
    PathSecurityError,
    isPathInside,
    resolveInside,
    assertSafeModuleName,
    resolveModulePath,
} from '../../utils/security/pathGuard.js';

const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'drpy-pathguard-')));

mkdirSync(path.join(root, 'js'), { recursive: true });
mkdirSync(path.join(root, 'js/sub'), { recursive: true });
writeFileSync(path.join(root, 'js/a.js'), 'export default 1;');
writeFileSync(path.join(root, 'js/sub/b.js'), 'export default 2;');

const outside = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'drpy-outside-')));
writeFileSync(path.join(outside, 'secret.txt'), 'x');

describe('isPathInside', () => {
    test('子路径判定为内部', () => {
        assert.equal(isPathInside(path.join('/a','b'), path.join('/a','b','c')), true);
    });

    test('父路径判定为外部', () => {
        assert.equal(isPathInside(path.join('/a','b'), path.join('/a')), false);
    });

    test('同前缀目录不算内部', () => {
        assert.equal(isPathInside(path.join('/a','b'), path.join('/a','bb')), false);
    });
});

describe('resolveInside', () => {
    test('正常相对路径可解析', () => {
        const resolved = resolveInside(root, 'js/a.js');
        assert.ok(resolved.endsWith(path.join('js', 'a.js')));
    });

    test('中文与空格路径可用', () => {
        mkdirSync(path.join(root, 'js/中文 目录'), { recursive: true });
        writeFileSync(path.join(root, 'js/中文 目录/源.js'), 'x');
        const resolved = resolveInside(root, 'js/中文 目录/源.js');
        assert.ok(resolved.includes('中文'));
    });

    test('../ 穿越被拒', () => {
        assert.throws(() => resolveInside(root, '../etc/passwd'), (error) => {
            assert.ok(error instanceof PathSecurityError);
            assert.ok([400, 403].includes(error.statusCode));
            return true;
        });
    });

    test('percent 编码穿越被拒', () => {
        assert.throws(() => resolveInside(root, '..%2f..%2fetc%2fpasswd'), PathSecurityError);
        assert.throws(() => resolveInside(root, '%2e%2e/%2e%2e/etc/passwd'), PathSecurityError);
    });

    test('绝对路径被拒', () => {
        assert.throws(() => resolveInside(root, path.join(outside, 'secret.txt')), PathSecurityError);
        assert.throws(() => resolveInside(root, '/etc/passwd'), PathSecurityError);
    });

    test('空字节被拒', () => {
        assert.throws(() => resolveInside(root, 'js/a.js\u0000.png'), PathSecurityError);
    });

    test('根目录本身默认被拒，allowRoot 时放行', () => {
        assert.throws(() => resolveInside(root, ''), PathSecurityError);
        assert.equal(resolveInside(root, '', { allowRoot: true }), root);
    });

    test('同前缀目录逃逸被拒', () => {
        assert.throws(() => resolveInside(path.join(root, 'js'), '../js-evil/../../secret'), PathSecurityError);
    });

    test('符号链接逃逸被拒', () => {
        const linkPath = path.join(root, 'js/link-out');
        try {
            symlinkSync(outside, linkPath, 'junction');
        } catch {
            return; // 无权限创建符号链接时跳过
        }

        assert.throws(() => resolveInside(root, 'js/link-out/secret.txt'), (error) => {
            assert.ok(error instanceof PathSecurityError);
            assert.ok(['SYMLINK_ESCAPE', 'PATH_ESCAPE', 'BROKEN_SYMLINK'].includes(error.code));
            return true;
        });
    });
});

describe('assertSafeModuleName', () => {
    test('正常模块名通过', () => {
        assert.equal(assertSafeModuleName('牛牛'), '牛牛');
        assert.equal(assertSafeModuleName('test_1'), 'test_1');
    });

    test('含分隔符被拒', () => {
        assert.throws(() => assertSafeModuleName('../a'), PathSecurityError);
        assert.throws(() => assertSafeModuleName('a/b'), PathSecurityError);
    });

    test('Windows 非法字符被拒', () => {
        assert.throws(() => assertSafeModuleName('a:b'), PathSecurityError);
        assert.throws(() => assertSafeModuleName('a*b'), PathSecurityError);
        assert.throws(() => assertSafeModuleName('a?b'), PathSecurityError);
    });

    test('空名与纯点被拒', () => {
        assert.throws(() => assertSafeModuleName(''), PathSecurityError);
        assert.throws(() => assertSafeModuleName('.'), PathSecurityError);
        assert.throws(() => assertSafeModuleName('..'), PathSecurityError);
    });
});

describe('resolveModulePath', () => {
    test('解析存在的模块文件', () => {
        const resolved = resolveModulePath(path.join(root, 'js'), 'a', '.js');
        assert.ok(resolved.endsWith('a.js'));
    });

    test('非法扩展名被拒', () => {
        assert.throws(() => resolveModulePath(path.join(root, 'js'), 'a', '.exe'), PathSecurityError);
    });

    test('穿越模块名被拒', () => {
        assert.throws(() => resolveModulePath(path.join(root, 'js'), '../a', '.js'), PathSecurityError);
    });
});

test('清理临时目录', () => {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
});
