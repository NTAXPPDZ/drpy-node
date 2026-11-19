/**
 * 单飞（single-flight）工具（对应项目书 P1-02 / P1-03）
 *
 * 同一个 key 的并发请求只真正发起一次上游调用，其余请求复用同一个 Promise。
 * 用于缓存未命中时的回源、代理探测、M3U8 拉取等重复请求场景。
 *
 * @module singleFlight
 */

/** @type {Map<string, {promise: Promise<*>, startedAt: number}>} */
const inflight = new Map();

/** 统计 */
const stats = {joined: 0, started: 0};

/**
 * 并发去重执行。
 * @param {string} key 去重键
 * @param {() => (Promise<*>|*)} factory 实际执行体
 * @returns {Promise<*>}
 */
export function singleFlight(key, factory) {
    const existing = inflight.get(key);

    if (existing) {
        stats.joined += 1;
        return existing.promise;
    }

    stats.started += 1;

    const entry = {promise: null, startedAt: Date.now()};

    const cleanup = () => {
        if (inflight.get(key) === entry) {
            inflight.delete(key);
        }
    };

    try {
        entry.promise = Promise.resolve(factory());
    } catch (error) {
        entry.promise = Promise.reject(error);
    }

    inflight.set(key, entry);
    entry.promise.then(cleanup, cleanup);

    return entry.promise;
}

/**
 * 当前在途数量。
 * @returns {number}
 */
export function getInflightCount() {
    return inflight.size;
}

/**
 * 单飞统计。
 * @returns {{inflight: number, started: number, joined: number, saved: number}}
 */
export function getSingleFlightStats() {
    return {
        inflight: inflight.size,
        started: stats.started,
        joined: stats.joined,
        saved: stats.joined,
    };
}

/**
 * 清空在途表（仅用于测试/关闭流程）。
 * @returns {void}
 */
export function clearInflight() {
    inflight.clear();
}

export default singleFlight;
