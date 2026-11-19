#!/usr/bin/env node
/**
 * 全仓语法自检：对每个 Node 源码文件执行 `node --check`。
 * 用途：CI 第一道门禁（比等测试跑完才发现语法错误快得多）。
 *
 * 用法：node scripts/check-syntax.mjs [--quiet]
 */
import { readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const QUIET = process.argv.includes('--quiet');
const EXTENSIONS = new Set(['.js', '.mjs', '.cjs']);
// 这些目录不是 Node 运行时源码（前端产物、源库、第三方依赖、数据目录）
const IGNORE_DIRS = new Set([
    'node_modules', '.git', '.github', '.codegraph', '.idea', '.vscode',
    'public', 'apps', 'spider', 'docs', 'json', 'logs', 'tmp', 'database',
    'backup', 'backups', 'plugins', 'drpy-node-bundle', 'drpy-node-admin',
    'dist', 'coverage', 'tests/fixtures',
]);

function walk(dir, acc = []) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        const relative = path.relative(ROOT, full).split(path.sep).join('/');
        if (entry.isDirectory()) {
            if (IGNORE_DIRS.has(entry.name) || IGNORE_DIRS.has(relative)) continue;
            walk(full, acc);
            continue;
        }
        if (!entry.isFile()) continue;
        if (entry.name.endsWith('.min.js')) continue;
        if (!EXTENSIONS.has(path.extname(entry.name))) continue;
        acc.push(full);
    }
    return acc;
}

const files = walk(ROOT).sort();
const failures = [];

for (const file of files) {
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (result.status !== 0) {
        failures.push({ file: path.relative(ROOT, file), stderr: (result.stderr || '').trim() });
    }
}

if (!QUIET) {
    console.log(`[check-syntax] 检查 ${files.length} 个文件，失败 ${failures.length} 个`);
}

for (const failure of failures) {
    console.error(`\n✗ ${failure.file}\n${failure.stderr.split('\n').slice(0, 6).join('\n')}`);
}

process.exit(failures.length === 0 ? 0 : 1);
