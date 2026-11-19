/**
 * 超时与取消（项目书 P1-01）。
 *
 * 要点：
 *  - 定时器必须 clearTimeout，避免事件循环被挂住
 *  - 超时触发 AbortController，信号透传给 axios/undici/socket，真正中断上游
 *  - 父信号（客户端断开）取消时同样 abort，并归类为 499/408
 */
import { ApiError, ErrorCodes } from './errors.js';

function envInt(name, fallback) {
    const n = Number.parseInt(process.env[name] ?? '', 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}

function envSecondsToMs(name, fallbackSeconds) {
    return envInt(name, fallbackSeconds) * 1000;
}

export const TimeoutBudgets = Object.freeze({
    // 注意：API_TIMEOUT / API_ACTION_TIMEOUT 在项目里是「秒」（见 controllers/api.js），
    // 其余 PROXY_* 是毫秒。这里统一返回毫秒。
    api: () => envSecondsToMs('API_TIMEOUT', 20),
    action: () => envSecondsToMs('API_ACTION_TIMEOUT', 60),
    proxy: () => envInt('PROXY_TIMEOUT', 30000),
    head: () => envInt('PROXY_HEAD_TIMEOUT', 5000),
    content: () => envInt('PROXY_CONTENT_TIMEOUT', 15000),
});

export function isAbortError(error) {
    if (!error) return false;
    return error.name === 'AbortError'
        || error.code === 'ABORT_ERR'
        || error.code === 'ERR_CANCELED'
        || (typeof error.name === 'string' && /abort/i.test(error.name));
}

/**
 * 合并多个 AbortSignal；任一 abort 即 abort 结果信号。
 * @param {Array<AbortSignal|undefined|null>} signals
 * @returns {AbortSignal|undefined}
 */
export function combineSignals(signals) {
    const list = (signals || []).filter((s) => s && typeof s.aborted === 'boolean');
    if (list.length === 0) return undefined;
    if (list.length === 1) return list[0];
    if (typeof AbortSignal.any === 'function') return AbortSignal.any(list);

    const controller = new AbortController();
    const onAbort = (event) => {
        controller.abort(event && event.target ? event.target.reason : undefined);
        cleanup();
    };
    const cleanup = () => {
        for (const signal of list) signal.removeEventListener('abort', onAbort);
    };
    for (const signal of list) {
        if (signal.aborted) {
            controller.abort(signal.reason);
            return controller.signal;
        }
        signal.addEventListener('abort', onAbort, { once: true });
    }
    return controller.signal;
}

/**
 * 带取消能力的超时包装。
 *
 * @template T
 * @param {(signal: AbortSignal) => Promise<T>|T} executor 业务函数，必须把 signal 透传给底层请求
 * @param {number} [timeoutMs] 超时毫秒数；非正数/NaN 表示不设超时
 * @param {{ operation?: string, logger?: any, route?: string, module?: string, phase?: string,
 *           parentSignal?: AbortSignal, statusCode?: number }} [options]
 * @returns {Promise<T>}
 */
export async function withTimeout(executor, timeoutMs, options = {}) {
    const {
        operation = '操作',
        logger,
        route,
        module: moduleName,
        phase,
        parentSignal,
        statusCode = 504,
    } = options;

    const controller = new AbortController();
    const startedAt = Date.now();
    let timer = null;
    let timedOut = false;
    let parentAborted = false;

    const timeoutError = new ApiError(
        ErrorCodes.TIMEOUT,
        `${operation}超时(${timeoutMs}ms)`,
        statusCode,
        { expose: true },
    );
    const abortError = new ApiError(ErrorCodes.CLIENT_CLOSED, `${operation}已被取消`, 408, { expose: true });

    const onParentAbort = () => {
        parentAborted = true;
        controller.abort(abortError);
    };

    if (parentSignal) {
        if (parentSignal.aborted) throw abortError;
        parentSignal.addEventListener('abort', onParentAbort, { once: true });
    }

    const bounded = Number.isFinite(timeoutMs) && timeoutMs > 0;
    const work = Promise.resolve().then(() => executor(controller.signal));

    let timerReject = null;
    const timerPromise = new Promise((_, reject) => { timerReject = reject; });

    if (bounded) {
        timer = setTimeout(() => {
            timedOut = true;
            controller.abort(timeoutError);
            timerReject(timeoutError);
            logTimeout();
        }, timeoutMs);
        if (typeof timer.unref === 'function') timer.unref();
    }

    function logTimeout() {
        if (!logger || typeof logger.warn !== 'function') return;
        try {
            logger.warn({
                route,
                module: moduleName,
                phase,
                operation,
                elapsedMs: Date.now() - startedAt,
                timeoutMs,
                code: ErrorCodes.TIMEOUT,
            }, `[timeout] ${operation}`);
        } catch { /* 日志失败不影响主流程 */ }
    }

    try {
        if (!bounded) return await work;
        return await Promise.race([work, timerPromise]);
    } catch (error) {
        if (timedOut) {
            work.catch(() => {});
            throw timeoutError;
        }
        if (parentAborted || isAbortError(error)) {
            work.catch(() => {});
            throw abortError;
        }
        throw error;
    } finally {
        if (timer) clearTimeout(timer);
        if (parentSignal) parentSignal.removeEventListener('abort', onParentAbort);
    }
}

/**
 * 直接给一个 promise 套超时（无取消能力时的降级路径）。
 * @template T
 * @param {Promise<T>} promise
 * @param {number} timeoutMs
 * @param {string} [operation]
 */
export function raceTimeout(promise, timeoutMs, operation = '操作') {
    return withTimeout(() => promise, timeoutMs, { operation });
}

export default { withTimeout, raceTimeout, combineSignals, isAbortError, TimeoutBudgets };
