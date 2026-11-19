/**
 * 统一缓存服务（对应项目书 P1-02）
 *
 * 替换原先 proxy-util.js 里 SmartCacheManager 的「双 Map（cache + accessOrder）」实现：
 * - 单实例 LRUCache，条目数与字节数双上限，TTL 由 lru-cache 统一管理；
 * - key 规范化（超长 key 取 sha1），按命名空间隔离；
 * - 统计信息集中输出，供 /admin 与健康检查消费；
 * - 淘汰/过期由 dispose 回调计数，不再需要定期全表扫描；
 * - 不再为每个实例注册 process.on('exit') 监听器。
 *
 * @module cacheService
 */

import {createHash} from 'node:crypto';
import {LRUCache} from 'lru-cache';
import {singleFlight} from './singleFlight.js';

/** 默认条目上限 */
export const DEFAULT_MAX_ENTRIES = 1000;

/** 默认字节上限（64MB） */
export const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;

/** 默认 TTL（5 分钟） */
export const DEFAULT_TTL_MS = 5 * 60 * 1000;

/** 超长 key 的阈值，超过则改为定长指纹 */
const MAX_KEY_LENGTH = 1024;

/** 命名空间分隔符 */
const NAMESPACE_SEPARATOR = '::';

/**
 * 规范化缓存 key：字符串化 + 超长截断为指纹，避免巨型 URL 占满内存。
 * @param {*} key
 * @returns {string}
 */
export function normalizeCacheKey(key) {
    if (key === null || key === undefined) {
        throw new TypeError('cache key is required');
    }

    const raw = typeof key === 'string' ? key : String(key);

    if (raw.length <= MAX_KEY_LENGTH) {
        return raw;
    }

    return 'sha1:' + createHash('sha1').update(raw).digest('hex');
}

/**
 * 估算值占用字节数，供 lru-cache 的 sizeCalculation 使用。
 * @param {*} value
 * @returns {number}
 */
export function estimateSize(value) {
    if (value === null || value === undefined) return 8;

    if (typeof value === 'string') return Buffer.byteLength(value, 'utf8') + 24;

    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
        return 16;
    }

    if (Buffer.isBuffer(value)) return value.length + 24;

    if (value instanceof ArrayBuffer) return value.byteLength + 24;

    if (ArrayBuffer.isView(value)) return value.byteLength + 24;

    try {
        return Buffer.byteLength(JSON.stringify(value) || '', 'utf8') + 64;
    } catch {
        return 256;
    }
}

/**
 * 把未知的淘汰原因映射为统计口径。
 * @param {string} reason
 * @returns {'evictions'|'expirations'|null}
 */
function classifyDisposeReason(reason) {
    if (reason === 'evict') return 'evictions';
    if (reason === 'expire') return 'expirations';
    return null;
}

export class CacheService {
    /**
     * @param {Object} [options]
     * @param {string} [options.namespace='cache'] 命名空间，避免不同控制器 key 冲撞
     * @param {number} [options.max] 条目上限
     * @param {number} [options.maxSize] 字节上限
     * @param {number} [options.ttl] 默认 TTL（毫秒）
     * @param {boolean} [options.allowStale=false] TTL 过期后是否允许返回旧值
     * @param {number} [options.cleanupInterval] 定期清理间隔（毫秒），0 表示不启动定时器
     */
    constructor(options = {}) {
        const {
            namespace = 'cache',
            max = DEFAULT_MAX_ENTRIES,
            maxSize = DEFAULT_MAX_BYTES,
            ttl = DEFAULT_TTL_MS,
            allowStale = false,
            cleanupInterval = 0,
        } = options;

        this.namespace = namespace;
        this.defaultTTL = ttl;
        this.max = max;
        this.maxBytes = maxSize;
        this.cleanupInterval = cleanupInterval;
        this.stats = {hits: 0, misses: 0, evictions: 0, expirations: 0, cleanups: 0};

        this._cache = new LRUCache({
            max,
            maxSize,
            ttl,
            allowStale,
            sizeCalculation: (value) => estimateSize(value),
            dispose: (value, key, reason) => {
                const bucket = classifyDisposeReason(reason);
                if (bucket) this.stats[bucket] += 1;
            },
        });

        this._cleanupTimer = null;
        if (cleanupInterval > 0) {
            this.startCleanupTimer();
        }
    }

    /**
     * 命名空间化 key。
     * @param {*} key
     * @returns {string}
     */
    keyOf(key) {
        return this.namespace + NAMESPACE_SEPARATOR + normalizeCacheKey(key);
    }

    /**
     * 写入缓存。
     * @param {*} key
     * @param {*} value
     * @param {number|Object} [ttlOrOptions] 毫秒 TTL，或 {ttl}
     * @returns {boolean}
     */
    set(key, value, ttlOrOptions) {
        const options = {};

        if (typeof ttlOrOptions === 'number' && Number.isFinite(ttlOrOptions) && ttlOrOptions > 0) {
            options.ttl = ttlOrOptions;
        } else if (ttlOrOptions && typeof ttlOrOptions === 'object') {
            if (Number.isFinite(ttlOrOptions.ttl)) options.ttl = ttlOrOptions.ttl;
            if (Number.isFinite(ttlOrOptions.size)) options.size = ttlOrOptions.size;
        }

        return this._cache.set(this.keyOf(key), value, options);
    }

    /**
     * 读取缓存。
     * @param {*} key
     * @returns {*} 未命中/已过期返回 null
     */
    get(key) {
        const value = this._cache.get(this.keyOf(key));

        if (value === undefined) {
            this.stats.misses += 1;
            return null;
        }

        this.stats.hits += 1;
        return value;
    }

    /**
     * 是否存在且未过期。
     * @param {*} key
     * @returns {boolean}
     */
    has(key) {
        const exists = this._cache.has(this.keyOf(key));
        if (!exists) this.stats.misses += 1;
        return exists;
    }

    /**
     * 删除单项。
     * @param {*} key
     * @returns {boolean}
     */
    delete(key) {
        return this._cache.delete(this.keyOf(key));
    }

    /**
     * 清空命名空间。
     * @returns {void}
     */
    clear() {
        this._cache.clear();
    }

    /**
     * 读缓存，未命中则执行工厂函数并写入；并发相同 key 走 single-flight。
     * @param {*} key
     * @param {() => Promise<*>|*} factory
     * @param {number} [ttl]
     * @returns {Promise<*>}
     */
    async fetch(key, factory, ttl) {
        const cached = this.get(key);
        if (cached !== null) return cached;

        const value = await singleFlight(this.keyOf(key), factory);

        if (value !== null && value !== undefined) {
            this.set(key, value, ttl);
        }

        return value;
    }

    /**
     * 清理过期条目。
     * @returns {number} 清理数量
     */
    purgeStale() {
        const before = this._cache.size;
        this._cache.purgeStale();
        const removed = before - this._cache.size;
        if (removed > 0) {
            this.stats.cleanups += 1;
            this.stats.expirations += removed;
        }
        return removed;
    }

    /**
     * 启动定期清理（single unref 定时器，进程可正常退出）。
     * @returns {void}
     */
    startCleanupTimer() {
        if (this._cleanupTimer || !(this.cleanupInterval > 0)) return;

        this._cleanupTimer = setInterval(() => this.purgeStale(), this.cleanupInterval);
        if (this._cleanupTimer.unref) this._cleanupTimer.unref();
    }

    /**
     * 停止定期清理。
     * @returns {void}
     */
    stopCleanupTimer() {
        if (this._cleanupTimer) {
            clearInterval(this._cleanupTimer);
            this._cleanupTimer = null;
        }
    }

    /** 当前条目数 */
    get size() {
        return this._cache.size;
    }

    /** 当前估算字节数 */
    get bytes() {
        return this._cache.calculatedSize || 0;
    }

    /**
     * 统计快照。
     * @returns {Object}
     */
    getStats() {
        const total = this.stats.hits + this.stats.misses;
        const hitRate = total > 0 ? ((this.stats.hits / total) * 100).toFixed(2) : '0.00';

        return {
            name: this.namespace,
            hits: this.stats.hits,
            misses: this.stats.misses,
            evictions: this.stats.evictions,
            expirations: this.stats.expirations,
            cleanups: this.stats.cleanups,
            size: this._cache.size,
            maxSize: this.max,
            maxBytes: this.maxBytes,
            bytes: this.bytes,
            hitRate: hitRate + '%',
            defaultTTL: this.defaultTTL,
            cleanupInterval: this.cleanupInterval,
            memoryUsage: formatBytes(this.bytes),
        };
    }
}

/**
 * 人类可读的字节数。
 * @param {number} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0B';
    if (bytes < 1024) return bytes + 'B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
    return (bytes / (1024 * 1024)).toFixed(1) + 'MB';
}

const sharedCaches = new Map();

/**
 * 按名称获取共享缓存实例（同名只创建一次）。
 * @param {string} name
 * @param {Object} [options]
 * @returns {CacheService}
 */
export function getSharedCache(name, options = {}) {
    const namespace = name || 'shared';

    if (sharedCaches.has(namespace)) {
        return sharedCaches.get(namespace);
    }

    const cache = new CacheService({namespace, ...options});
    sharedCaches.set(namespace, cache);
    return cache;
}

/**
 * 关闭并释放所有共享缓存。
 * @returns {void}
 */
export function closeSharedCaches() {
    for (const cache of sharedCaches.values()) {
        cache.stopCleanupTimer();
        cache.clear();
    }
    sharedCaches.clear();
}

/**
 * 所有共享缓存的统计快照，供健康检查/管理接口消费。
 * @returns {Object[]}
 */
export function getAllCacheStats() {
    return Array.from(sharedCaches.values()).map((cache) => cache.getStats());
}

export default CacheService;
