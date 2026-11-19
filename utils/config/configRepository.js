/**
 * 配置仓储（对应项目书 P1-04）
 *
 * 解决 config.js 里「每次请求都同步读盘 + 同步写回」的问题：
 * - 读：fs/promises + (mtimeMs,size) 缓存，命中缓存时不触碰磁盘；
 * - 写：临时文件 + rename 原子替换，避免读到写一半的 JSON；
 * - 同一文件的写操作串行化（进程内锁），避免并发写互相覆盖；
 * - 目录列表按目录 mtime 缓存，减少 readdir 次数。
 *
 * 不改变任何外部接口：调用方仍按自身逻辑组装数据，只是读写方式变了。
 *
 * @module configRepository
 */

import {readFile, writeFile, rename, stat, readdir, mkdir, unlink} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';

/** 文件内容缓存：path -> {mtimeMs, size, content} */
const fileCache = new Map();

/** 目录列表缓存：dir -> {mtimeMs, entries} */
const dirCache = new Map();

/** 每文件的写锁链：path -> Promise */
const writeLocks = new Map();

/** 缓存条目上限，防止长时间运行后无界增长 */
const MAX_CACHE_ENTRIES = 512;

/**
 * 读取文件文本（带 mtime 缓存）。
 * @param {string} filePath
 * @param {Object} [options]
 * @param {boolean} [options.useCache=true]
 * @returns {Promise<string?>} 文件不存在返回 null
 */
export async function readText(filePath, options = {}) {
    const {useCache = true} = options;

    let info;
    try {
        info = await stat(filePath);
    } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
    }

    if (useCache) {
        const cached = fileCache.get(filePath);
        if (cached && cached.mtimeMs === info.mtimeMs && cached.size === info.size) {
            return cached.content;
        }
    }

    const content = await readFile(filePath, 'utf8');

    if (fileCache.size > MAX_CACHE_ENTRIES) {
        const oldest = fileCache.keys().next().value;
        fileCache.delete(oldest);
    }

    fileCache.set(filePath, {mtimeMs: info.mtimeMs, size: info.size, content});

    return content;
}

/**
 * 读取并解析 JSON。
 * @param {string} filePath
 * @param {*} [fallback=null] 文件不存在或解析失败时返回该值
 * @returns {Promise<*>}
 */
export async function readJson(filePath, fallback = null) {
    const content = await readText(filePath);

    if (content === null || content === undefined || content.trim() === '') {
        return fallback;
    }

    try {
        return JSON.parse(content);
    } catch {
        return fallback;
    }
}

/**
 * 原子写入文本：同目录临时文件 + rename。
 * @param {string} filePath
 * @param {string} content
 * @returns {Promise<void>}
 */
export async function writeTextAtomic(filePath, content) {
    const dir = path.dirname(filePath);
    const suffix = createHash('sha1').update(filePath + os.hostname() + process.pid).digest('hex').slice(0, 8);
    const tmpPath = path.join(dir, '.' + path.basename(filePath) + '.' + suffix + '.tmp');

    await mkdir(dir, {recursive: true});
    await writeFile(tmpPath, content, 'utf8');

    try {
        await rename(tmpPath, filePath);
    } catch (error) {
        // Windows 上目标被短暂占用时 rename 可能失败，重试一次
        await unlink(tmpPath).catch(() => {});
        if (error.code === 'EPERM' || error.code === 'EBUSY') {
            await writeFile(filePath, content, 'utf8');
            invalidate(filePath);
            return;
        }
        throw error;
    }

    invalidate(filePath);
}

/**
 * 原子写入 JSON。
 * @param {string} filePath
 * @param {*} data
 * @param {number} [space=2]
 * @returns {Promise<void>}
 */
export function writeJsonAtomic(filePath, data, space = 2) {
    return writeTextAtomic(filePath, JSON.stringify(data, null, space));
}

/**
 * 串行执行同一文件的写操作。
 * @param {string} filePath
 * @param {() => Promise<*>} task
 * @returns {Promise<*>}
 */
export function withFileLock(filePath, task) {
    const previous = writeLocks.get(filePath) || Promise.resolve();

    const next = previous
        .catch(() => {})
        .then(task)
        .finally(() => {
            if (writeLocks.get(filePath) === next) {
                writeLocks.delete(filePath);
            }
        });

    writeLocks.set(filePath, next);
    return next;
}

/**
 * 列出目录（按目录 mtime 缓存）。
 * @param {string} dirPath
 * @param {Object} [options]
 * @param {boolean} [options.withFileTypes=false]
 * @returns {Promise<Array>}
 */
export async function listDir(dirPath, options = {}) {
    let info;
    try {
        info = await stat(dirPath);
    } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
    }

    const cached = dirCache.get(dirPath);
    if (cached && cached.mtimeMs === info.mtimeMs) {
        return cached.entries;
    }

    const entries = await readdir(dirPath, options.withFileTypes ? {withFileTypes: true} : undefined);

    if (dirCache.size > MAX_CACHE_ENTRIES) {
        const oldest = dirCache.keys().next().value;
        dirCache.delete(oldest);
    }

    dirCache.set(dirPath, {mtimeMs: info.mtimeMs, entries});

    return entries;
}

/**
 * 失效单个文件的缓存。
 * @param {string} filePath
 * @returns {void}
 */
export function invalidate(filePath) {
    fileCache.delete(filePath);
}

/**
 * 清空所有缓存（测试/配置热重载使用）。
 * @returns {void}
 */
export function clearRepositoryCache() {
    fileCache.clear();
    dirCache.clear();
}

/**
 * 缓存统计，供健康检查消费。
 * @returns {{files: number, dirs: number, pendingWrites: number}}
 */
export function getRepositoryStats() {
    return {
        files: fileCache.size,
        dirs: dirCache.size,
        pendingWrites: writeLocks.size,
    };
}

export default {
    readText,
    readJson,
    writeTextAtomic,
    writeJsonAtomic,
    withFileLock,
    listDir,
    invalidate,
    clearRepositoryCache,
    getRepositoryStats,
};
