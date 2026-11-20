/**
 * 请求上下文（项目书 P1-06 / P0-04）：requestId 贯穿日志与错误响应。
 */
import { randomUUID } from 'node:crypto';

export const REQUEST_ID_HEADER = 'x-request-id';

const VALID_ID = /^[A-Za-z0-9._:-]{6,80}$/;
const MAX_HEADER_LENGTH = 80;

/**
 * 只接受可见、无注入风险的短字符串，其余一律丢弃重新生成。
 * @param {unknown} raw
 * @returns {string|null}
 */
export function normalizeRequestId(raw) {
    if (typeof raw !== 'string') return null;
    const value = raw.trim();
    if (!value || value.length > MAX_HEADER_LENGTH) return null;
    return VALID_ID.test(value) ? value : null;
}

/**
 * @param {import('fastify').FastifyRequest} request
 * @returns {string}
 */
export function getRequestId(request) {
    if (request && typeof request.requestId === 'string' && request.requestId) return request.requestId;
    const fromHeader = normalizeRequestId(request && request.headers ? request.headers[REQUEST_ID_HEADER] : null);
    if (fromHeader) {
        if (request) request.requestId = fromHeader;
        return fromHeader;
    }
    const id = randomUUID();
    if (request) request.requestId = id;
    return id;
}

/**
 * 给响应回写 requestId，便于前端工单定位。
 */
export function applyRequestId(request, reply) {
    const id = getRequestId(request);
    if (reply && typeof reply.header === 'function') {
        try { reply.header(REQUEST_ID_HEADER, id); } catch { /* 已发送则忽略 */ }
    }
    return id;
}

/**
 * 注册全局 onRequest 钩子。
 * @param {import('fastify').FastifyInstance} fastify
 */
export function registerRequestContext(fastify) {
    fastify.addHook('onRequest', (request, reply, done) => {
        applyRequestId(request, reply);
        done();
    });
}

/**
 * 取带上下文的子 logger；没有 logger 时返回空实现，调用方不必判空。
 * @param {any} fastify
 * @param {import('fastify').FastifyRequest} [request]
 * @param {object} [extra]
 */
export function getRequestLogger(fastify, request, extra = {}) {
    const base = (fastify && fastify.log) || console;
    const bindings = { ...extra };
    if (request) {
        bindings.reqId = getRequestId(request);
        const routeTemplate = request.routeOptions && request.routeOptions.url;
        if (routeTemplate || request.url) bindings.route = routeTemplate || request.url;
        bindings.method = request.method;
    }
    if (base && typeof base.child === 'function') return base.child(bindings);
    return base;
}

export default {
    REQUEST_ID_HEADER,
    normalizeRequestId,
    getRequestId,
    applyRequestId,
    registerRequestContext,
    getRequestLogger,
};
