/**
 * 路由能力表与只读模式策略（对应项目书 P1-07）
 *
 * 原先每个控制器各自写一份 `process.env.READ_ONLY_MODE === '1'`，
 * 既不统一也容易漏。现在集中成一张「路由 → 能力」表：
 * - 读能力（read:*）在只读模式下照常放行；
 * - 写能力（write:* / run:* / restart:*）在只读模式下统一 403 READ_ONLY；
 * - 未登记的写路由默认按 write:config 处理（保守策略，宁拒绝不放行）。
 *
 * @module capabilities
 */

import {ApiError, ErrorCodes} from './errors.js';

/**
 * 能力枚举。
 */
export const CAPABILITIES = Object.freeze({
    READ_CONFIG: 'read:config',
    WRITE_CONFIG: 'write:config',
    READ_FILE: 'read:file',
    WRITE_FILE: 'write:file',
    RUN_TERMINAL: 'run:terminal',
    RESTART_SERVICE: 'restart:service',
    WRITE_PLUGIN: 'write:plugin',
    WRITE_SUB: 'write:sub',
});

/**
 * 只读模式下禁止的能力。
 */
export const WRITE_CAPABILITIES = new Set([
    CAPABILITIES.WRITE_CONFIG,
    CAPABILITIES.WRITE_FILE,
    CAPABILITIES.RUN_TERMINAL,
    CAPABILITIES.RESTART_SERVICE,
    CAPABILITIES.WRITE_PLUGIN,
    CAPABILITIES.WRITE_SUB,
]);

/**
 * 路由能力表，按顺序匹配，先命中先用。
 * @type {{method?: string[], pattern: RegExp, capability: string}[]}
 */
export const ROUTE_CAPABILITIES = Object.freeze([
    {method: ['POST', 'PUT', 'PATCH', 'DELETE'], pattern: /^\/(?:api\/)?admin\/(?:terminal|exec|cmd|shell)/i, capability: CAPABILITIES.RUN_TERMINAL},
    {method: ['POST', 'PUT', 'PATCH', 'DELETE'], pattern: /^\/(?:api\/)?admin\/(?:restart|reload|stop|start|upgrade|update)/i, capability: CAPABILITIES.RESTART_SERVICE},
    {method: ['POST', 'PUT', 'PATCH', 'DELETE'], pattern: /^\/(?:api\/)?admin\/(?:plugins?|plugin-manager)/i, capability: CAPABILITIES.WRITE_PLUGIN},
    {method: ['POST', 'PUT', 'PATCH', 'DELETE'], pattern: /^\/(?:api\/)?admin\/(?:sub|subs|subscribe|subscription|source|sources)/i, capability: CAPABILITIES.WRITE_SUB},
    {method: ['POST', 'PUT', 'PATCH', 'DELETE'], pattern: /^\/(?:api\/)?admin\/(?:files?|fs|upload|delete-file|write-file)/i, capability: CAPABILITIES.WRITE_FILE},
    {method: ['POST', 'PUT', 'PATCH', 'DELETE'], pattern: /^\/(?:api\/)?admin\/(?:backup|restore|import|export)/i, capability: CAPABILITIES.WRITE_FILE},
    {method: ['POST', 'PUT', 'PATCH', 'DELETE'], pattern: /^\/admin\/(?:cookie-set|backup|restore|download\/clear)/i, capability: CAPABILITIES.WRITE_CONFIG},
    {method: ['POST', 'PUT', 'PATCH', 'DELETE'], pattern: /^\/(?:api\/)?admin\//i, capability: CAPABILITIES.WRITE_CONFIG},
    {method: ['POST', 'PUT', 'PATCH', 'DELETE'], pattern: /^\/api\/admin\/db/i, capability: CAPABILITIES.WRITE_CONFIG},
]);

/** @type {{method: string[], pattern: RegExp, capability: string}[]} */
const COMPILED = ROUTE_CAPABILITIES.map((rule) => ({
    method: rule.method ? rule.method.slice() : null,
    pattern: rule.pattern,
    capability: rule.capability,
}));

/**
 * 是否处于只读模式。
 * @param {Object} [env]
 * @returns {boolean}
 */
export function isReadOnlyMode(env = process.env) {
    const value = String(env.READ_ONLY_MODE || '').trim().toLowerCase();
    return value === '1' || value === 'true' || value === 'yes' || value === 'on';
}

/**
 * 是否为写方法。
 * @param {string} method
 * @returns {boolean}
 */
export function isMutatingMethod(method) {
    return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(String(method || '').toUpperCase());
}

/**
 * 解析请求所需能力；读取类请求返回 read:*，未登记写路由按 write:config 兜底。
 * @param {string} method
 * @param {string} url 只取 pathname（如 /api/admin/config?x=1）
 * @returns {string}
 */
export function resolveCapability(method, url) {
    const upper = String(method || 'GET').toUpperCase();
    const pathname = String(url || '/').split('?')[0];

    if (!isMutatingMethod(upper)) {
        return /^\/(?:api\/)?admin\/(?:files?|fs|download)/i.test(pathname)
            ? CAPABILITIES.READ_FILE
            : CAPABILITIES.READ_CONFIG;
    }

    for (const rule of COMPILED) {
        if (rule.method && !rule.method.includes(upper)) continue;
        if (rule.pattern.test(pathname)) return rule.capability;
    }

    // 写方法 + 管理面路径：保守按写配置处理
    return /^\/(?:api\/)?admin\//i.test(pathname) ? CAPABILITIES.WRITE_CONFIG : CAPABILITIES.READ_CONFIG;
}

/**
 * 判断该请求在只读模式下是否被禁止。
 * @param {string} method
 * @param {string} url
 * @param {Object} [env]
 * @returns {{allowed: boolean, capability: string}}
 */
export function checkCapability(method, url, env = process.env) {
    const capability = resolveCapability(method, url);

    if (!isReadOnlyMode(env)) {
        return {allowed: true, capability};
    }

    return {allowed: !WRITE_CAPABILITIES.has(capability), capability};
}

/**
 * 只读模式下拒绝写请求。
 * @param {string} method
 * @param {string} url
 * @param {Object} [env]
 * @returns {void}
 * @throws {ApiError} 403 READ_ONLY
 */
export function assertCapabilityAllowed(method, url, env = process.env) {
    const result = checkCapability(method, url, env);

    if (!result.allowed) {
        throw new ApiError(
            ErrorCodes.READ_ONLY,
            'Server is in read-only mode (' + result.capability + ')',
            403,
            {expose: true, details: {capability: result.capability}},
        );
    }
}

/**
 * 注册全局只读守卫（onRequest 阶段，早于业务 handler）。
 * 只检查管理面路径，业务 API/播放链路不受影响。
 *
 * @param {Object} fastify
 * @returns {void}
 */
export function registerCapabilityGuard(fastify) {
    fastify.addHook('onRequest', async (request) => {
        if (!isReadOnlyMode()) return;

        const pathname = String(request.raw?.url || request.url || '/').split('?')[0];

        if (!/^\/(?:api\/)?admin\//i.test(pathname) && !/^\/admin\//i.test(pathname)) {
            return;
        }

        assertCapabilityAllowed(request.method, pathname);
    });
}

export default {
    CAPABILITIES,
    WRITE_CAPABILITIES,
    ROUTE_CAPABILITIES,
    isReadOnlyMode,
    isMutatingMethod,
    resolveCapability,
    checkCapability,
    assertCapabilityAllowed,
    registerCapabilityGuard,
};
