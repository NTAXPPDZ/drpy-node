/**
 * 日志脱敏工具
 *
 * 统一处理：请求头、查询串、对象字段中的凭据与令牌。
 * 原则：只保留可运维的最小信息（域名、路径、状态码、耗时、字节数），
 * 不落 Cookie / Authorization / token / 口令。
 */

export const SENSITIVE_HEADERS = new Set([
    'authorization',
    'proxy-authorization',
    'cookie',
    'set-cookie',
    'x-api-key',
    'x-auth-token',
    'x-access-token',
    'x-csrf-token',
    'sec-websocket-protocol',
]);

export const SENSITIVE_KEY_PATTERN = /(pass(word|wd)?|pwd|secret|token|auth|apikey|api_key|access_key|private_key|credential|session|cookie)/i;

export const REDACTED = '[REDACTED]';

/**
 * 是否为敏感字段名
 * @param {string} key
 */
export function isSensitiveKey(key) {
    return SENSITIVE_KEY_PATTERN.test(String(key || ''));
}

/**
 * 脱敏请求头
 * @param {Record<string, any>} headers
 * @returns {Record<string, any>}
 */
export function redactHeaders(headers) {
    if (!headers || typeof headers !== 'object') return {};
    const result = {};
    for (const [key, value] of Object.entries(headers)) {
        const lower = String(key).toLowerCase();
        if (SENSITIVE_HEADERS.has(lower) || isSensitiveKey(lower)) {
            result[key] = REDACTED;
        } else {
            result[key] = value;
        }
    }
    return result;
}

/**
 * 脱敏 URL：移除 query 中的敏感值，保留域名与路径
 * @param {string} rawUrl
 * @returns {string}
 */
export function redactUrl(rawUrl) {
    if (!rawUrl) return '';
    try {
        const parsed = new URL(String(rawUrl));
        for (const key of [...parsed.searchParams.keys()]) {
            if (isSensitiveKey(key)) parsed.searchParams.set(key, REDACTED);
        }
        return parsed.toString();
    } catch {
        return String(rawUrl).replace(/([?&](?:[^=&#]*(?:token|key|secret|pwd|auth)[^=&#]*)=)[^&#]*/gi, '$1' + REDACTED);
    }
}

/**
 * 递归脱敏对象（限制深度，避免日志对象过大）
 * @param {any} input
 * @param {number} depth
 * @returns {any}
 */
export function redactObject(input, depth = 0) {
    if (input === null || input === undefined) return input;
    if (depth > 4) return '[depth-limit]';
    if (typeof input === 'string') return input.length > 512 ? input.slice(0, 512) + '...[truncated]' : input;
    if (typeof input !== 'object') return input;
    if (Array.isArray(input)) return input.slice(0, 20).map(item => redactObject(item, depth + 1));
    if (input instanceof Error) {
        return {name: input.name, message: input.message, code: input.code};
    }
    const result = {};
    for (const [key, value] of Object.entries(input)) {
        result[key] = isSensitiveKey(key) ? REDACTED : redactObject(value, depth + 1);
    }
    return result;
}

export default {redactHeaders, redactUrl, redactObject, isSensitiveKey, SENSITIVE_HEADERS, REDACTED};
