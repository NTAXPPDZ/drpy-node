/**
 * 源目录统一索引（P2-03）。
 *
 * 之前 controllers/config.js（JS/DR2/PY/PHP/CatVod/JX 六处 readdirSync）与
 * controllers/admin/sourcesController.js（四处 fs.readdir）各自扫描目录，既阻塞事件循环
 * 又各自做过滤。这里统一为：
 *   - 异步 readdir；
 *   - 以目录 mtimeMs 为键的内存缓存（新增/删除/重命名文件会改变目录 mtime，从而失效）；
 *   - 按类型的命名约定过滤（以 `_` 开头、扩展名白名单等）。
 * 注意：目录 mtime 不随文件内容修改而变化，因此索引只缓存“名字列表”，不缓存文件内容。
 */
import path from 'node:path';
import fsp from 'node:fs/promises';

const MAX_CACHED_DIRS = 256;
const cache = new Map(); // absDir -> { mtimeMs, names }
const stats = { hits: 0, misses: 0 };

/** 源类型的目录约定（相对项目根目录）。 */
export const SOURCE_KINDS = Object.freeze({
    js: { dir: 'spider/js', ext: '.js' },
    catvod: { dir: 'spider/catvod', ext: '.js' },
    php: { dir: 'spider/php', ext: '.php' },
    py: { dir: 'spider/py', ext: '.py' },
});

/**
 * 列出目录下全部条目名（与 readdir 行为一致，目录不存在时抛错由调用方处理）。
 * @param {string} dir 绝对或相对路径
 * @returns {Promise<string[]>}
 */
export async function listSourceNames(dir) {
    const absDir = path.resolve(dir);
    const dirStat = await fsp.stat(absDir);
    const cached = cache.get(absDir);
    if (cached && cached.mtimeMs === dirStat.mtimeMs) {
        stats.hits += 1;
        return cached.names.slice();
    }
    stats.misses += 1;
    const names = await fsp.readdir(absDir);
    if (cache.size >= MAX_CACHED_DIRS) {
        cache.delete(cache.keys().next().value);
    }
    cache.set(absDir, { mtimeMs: dirStat.mtimeMs, names });
    return names.slice();
}

/**
 * 按类型约定列出可用源文件名（排除 `_` 前缀，扩展名匹配）。
 * @param {string} dir
 * @param {{ext: string, exclude?: string[], excludePrefixes?: string[]}} options
 * @returns {Promise<string[]>}
 */
export async function listSources(dir, { ext, exclude = [], excludePrefixes = ['_'] }) {
    const names = await listSourceNames(dir);
    return names.filter((name) => name.endsWith(ext)
        && !excludePrefixes.some((prefix) => name.startsWith(prefix))
        && !exclude.includes(name));
}

/** 按项目根目录 + 类型列出源文件，不存在目录返回空数组（与 sourcesController 的 pathExists 语义一致）。 */
export async function listKindSources(projectRoot, kind) {
    const spec = SOURCE_KINDS[kind];
    if (!spec) throw new Error(`unknown source kind: ${kind}`);
    const dir = path.join(projectRoot, spec.dir);
    try {
        const names = await listSources(dir, { ext: spec.ext });
        return names.sort();
    } catch (error) {
        if (error && error.code === 'ENOENT') return [];
        throw error;
    }
}

export function invalidateSourceIndex(dir) {
    if (dir) {
        cache.delete(path.resolve(dir));
    } else {
        cache.clear();
    }
}

export function getSourceIndexStats() {
    return { cachedDirs: cache.size, hits: stats.hits, misses: stats.misses };
}

export default {
    SOURCE_KINDS,
    listSourceNames,
    listSources,
    listKindSources,
    invalidateSourceIndex,
    getSourceIndexStats,
};
