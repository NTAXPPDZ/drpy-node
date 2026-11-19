/**
 * 统一错误契约（项目书 P1-06）。
 *
 * 目标：
 *  - 所有控制器用同一个错误对象与同一份响应信封 { error, message, code, requestId }
 *  - 内部细节不外泄：>=500 默认返回 Internal Server Error
 *  - 兼容旧字段：error 与 message 同值，历史调用方继续可用
 */

export const ErrorCodes = Object.freeze({
    INVALID_PARAM: 'INVALID_PARAM',
    UNAUTHORIZED: 'UNAUTHORIZED',
    FORBIDDEN: 'FORBIDDEN',
    NOT_FOUND: 'NOT_FOUND',
    CONFLICT: 'CONFLICT',
    READ_ONLY: 'READ_ONLY_MODE',
    EGRESS_BLOCKED: 'EGRESS_BLOCKED',
    PATH_ESCAPE: 'PATH_ESCAPE',
    TIMEOUT: 'UPSTREAM_TIMEOUT',
    UPSTREAM: 'UPSTREAM_ERROR',
    TOO_MANY: 'TOO_MANY_REQUESTS',
    UNAVAILABLE: 'SERVICE_UNAVAILABLE',
    CLIENT_CLOSED: 'CLIENT_CLOSED_REQUEST',
    INTERNAL: 'INTERNAL_ERROR',
});

const DEFAULT_STATUS = Object.freeze({
    [ErrorCodes.INVALID_PARAM]: 400,
    [ErrorCodes.UNAUTHORIZED]: 401,
    [ErrorCodes.FORBIDDEN]: 403,
    [ErrorCodes.NOT_FOUND]: 404,
    [ErrorCodes.CONFLICT]: 409,
    [ErrorCodes.READ_ONLY]: 403,
    [ErrorCodes.EGRESS_BLOCKED]: 403,
    [ErrorCodes.PATH_ESCAPE]: 400,
    [ErrorCodes.TIMEOUT]: 504,
    [ErrorCodes.UPSTREAM]: 502,
    [ErrorCodes.TOO_MANY]: 429,
    [ErrorCodes.UNAVAILABLE]: 503,
    [ErrorCodes.CLIENT_CLOSED]: 499,
    [ErrorCodes.INTERNAL]: 500,
});

const AXIOS_TIMEOUT_CODES = new Set(['ECONNABORTED', 'ETIMEDOUT', 'ESOCKETTIMEDOUT']);
const AXIOS_ABORT_CODES = new Set(['ERR_CANCELED', 'ABORT_ERR']);
const UPSTREAM_CODES = new Set([
    'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'EPIPE', 'EHOSTUNREACH',
    'ENETUNREACH', 'EPROTO', 'ERR_TLS_CERT_ALTNAME_INVALID', 'CERT_HAS_EXPIRED',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'ERR_INVALID_PROTOCOL',
]);

export class ApiError extends Error {
    /**
     * @param {string} code 稳定错误码，见 ErrorCodes
     * @param {string} message 对外可读信息
     * @param {number} [statusCode] HTTP 状态码
     * @param {{ expose?: boolean, details?: any, cause?: Error }} [options]
     */
    constructor(code, message, statusCode, options = {}) {
        super(message);
        this.name = 'ApiError';
        this.code = code || ErrorCodes.INTERNAL;
        this.statusCode = Number.isInteger(statusCode) ? statusCode : (DEFAULT_STATUS[this.code] || 500);
        this.expose = options.expose !== undefined ? !!options.expose : this.statusCode < 500;
        this.details = options.details;
        if (options.cause) this.cause = options.cause;
    }

    static badRequest(message = '参数错误', details) {
        return new ApiError(ErrorCodes.INVALID_PARAM, message, 400, { details });
    }

    static unauthorized(message = '未认证') {
        return new ApiError(ErrorCodes.UNAUTHORIZED, message, 401);
    }

    static forbidden(message = '没有权限') {
        return new ApiError(ErrorCodes.FORBIDDEN, message, 403);
    }

    static notFound(message = '资源不存在') {
        return new ApiError(ErrorCodes.NOT_FOUND, message, 404);
    }

    static readOnly(message = '只读模式，禁止修改') {
        return new ApiError(ErrorCodes.READ_ONLY, message, 403);
    }

    static tooMany(message = '请求过于频繁', details) {
        return new ApiError(ErrorCodes.TOO_MANY, message, 429, { details });
    }

    static timeout(operation = '操作', timeoutMs) {
        return new ApiError(ErrorCodes.TIMEOUT, `${operation}超时${timeoutMs ? `(${timeoutMs}ms)` : ''}`, 504);
    }

    static upstream(message = '上游服务异常') {
        return new ApiError(ErrorCodes.UPSTREAM, message, 502, { expose: true });
    }

    static unavailable(message = '服务暂不可用') {
        return new ApiError(ErrorCodes.UNAVAILABLE, message, 503);
    }

    static internal(message = '服务器内部错误', cause) {
        return new ApiError(ErrorCodes.INTERNAL, message, 500, { expose: false, cause });
    }

    static clientClosed(message = '客户端已断开') {
        return new ApiError(ErrorCodes.CLIENT_CLOSED, message, 499);
    }
}

export function isApiError(error) {
    return error instanceof ApiError;
}

const FASTIFY_CODE_MAP = Object.freeze({
    FST_ERR_VALIDATION: [ErrorCodes.INVALID_PARAM, 400],
    FST_ERR_CTP_INVALID_MEDIA_TYPE: [ErrorCodes.INVALID_PARAM, 400],
    FST_ERR_CTP_BODY_TOO_LARGE: [ErrorCodes.INVALID_PARAM, 413],
    FST_ERR_CTP_EMPTY_JSON_BODY: [ErrorCodes.INVALID_PARAM, 400],
    FST_ERR_CTP_INVALID_JSON_BODY: [ErrorCodes.INVALID_PARAM, 400],
    FST_ERR_BAD_URL: [ErrorCodes.INVALID_PARAM, 400],
    FST_ERR_NOT_FOUND: [ErrorCodes.NOT_FOUND, 404],
    FST_ERR_REP_ALREADY_SENT: [ErrorCodes.INTERNAL, 500],
});

function isString(value) {
    return typeof value === 'string' && value.length > 0;
}

/**
 * 把任意异常归一化成 ApiError。
 * 兼容项目内既有的 PathSecurityError / EgressPolicyError（都带 code + statusCode）。
 */
export function toApiError(error) {
    if (error instanceof ApiError) return error;
    if (!error) return ApiError.internal('未知错误');

    const fastifyMapped = isString(error.code) ? FASTIFY_CODE_MAP[error.code] : undefined;
    if (fastifyMapped) {
        const [mappedCode, mappedStatus] = fastifyMapped;
        return new ApiError(mappedCode, error.message || '请求参数不合法', mappedStatus);
    }

    if (isString(error.code) && Number.isInteger(error.statusCode) && error.statusCode >= 400) {
        return new ApiError(error.code, error.message || '请求被拒绝', error.statusCode, {
            expose: error.statusCode < 500,
            details: error.details,
        });
    }

    const code = error.code;
    if (AXIOS_TIMEOUT_CODES.has(code) || error.name === 'TimeoutError') {
        return ApiError.timeout('上游请求', error.timeout);
    }
    if (AXIOS_ABORT_CODES.has(code) || error.name === 'AbortError') {
        return new ApiError(ErrorCodes.CLIENT_CLOSED, '请求已取消', 499);
    }
    if (UPSTREAM_CODES.has(code) || error.isAxiosError) {
        return ApiError.upstream(`上游服务异常${code ? `(${code})` : ''}`);
    }
    if (code === 'ERR_INVALID_URL' || code === 'ERR_UNSUPPORTED_PROTOCOL') {
        return ApiError.badRequest('URL 不合法');
    }
    return ApiError.internal(error.message || '服务器内部错误', error);
}

function internalMessageVisible(error) {
    if (process.env.EXPOSE_INTERNAL_ERRORS === '1') return true;
    return error && error.expose === true;
}

/**
 * 生成统一错误响应体。始终包含旧字段 error，便于既有前端继续解析。
 */
export function errorPayload(error, { requestId } = {}) {
    const apiError = toApiError(error);
    const visible = apiError.statusCode < 500 || internalMessageVisible(apiError);
    const message = visible ? apiError.message : 'Internal Server Error';
    const payload = {
        error: message,
        message,
        code: apiError.code || ErrorCodes.INTERNAL,
    };
    if (requestId) payload.requestId = requestId;
    if (apiError.details && apiError.statusCode < 500) payload.details = apiError.details;
    return payload;
}

/**
 * 统一出口：设置状态码与 JSON 类型后发送。
 * @param {import('fastify').FastifyReply} reply
 * @param {any} error
 * @param {{ requestId?: string, extra?: object }} [options]
 */
export function sendError(reply, error, options = {}) {
    const apiError = toApiError(error);
    const { requestId } = options;
    if (requestId) {
        try { reply.header('x-request-id', requestId); } catch { /* reply 可能已发出 */ }
    }
    const payload = { ...errorPayload(apiError, { requestId }), ...(options.extra || {}) };
    if (apiError.statusCode === 401 && !reply.hasHeader?.('www-authenticate')) {
        try { reply.header('www-authenticate', 'Basic realm="drpy-node"'); } catch { /* ignore */ }
    }
    return reply.code(apiError.statusCode).type('application/json; charset=utf-8').send(payload);
}

export default {
    ApiError,
    ErrorCodes,
    isApiError,
    toApiError,
    errorPayload,
    sendError,
};
