/**
 * HTTP 请求代理控制器模块
 * 提供 HTTP 请求代理、AI 接口和请求转发功能
 *
 * 安全约束（对应项目书 P0-03 / P0-04）：
 * - /http、/req/* 必须认证（管理员 Basic 或 PROXY_AUTH）；
 * - 出站目标统一走 EgressPolicy：仅 http/https，DNS 解析后拒绝内网/回环/链路本地/元数据地址；
 * - 连接阶段使用 guardedLookup 再校验一次，抵御 DNS 重绑定与重定向绕过；
 * - 限制请求体、响应体、超时与并发；日志脱敏，不打印 Cookie/Authorization。
 * @module http-controller
 */

import axios from 'axios';
import http from 'node:http';
import https from 'node:https';
import { ENV } from '../utils/env.js';
import { keysToLowerCase } from '../utils/utils.js';
import {
    assertPublicUrl,
    guardedLookup,
    EgressPolicyError,
} from '../utils/security/egressPolicy.js';
import { authorizeAdminRequest, extractBasicAuthHeader, secureCompare } from '../utils/security/auth.js';
import { redactHeaders, redactUrl } from '../utils/security/redact.js';
import { sendError, ApiError, ErrorCodes } from '../utils/runtime/errors.js';
import { getRequestId } from '../utils/runtime/requestContext.js';
import { isApiError } from '../utils/runtime/errors.js';

// 最大连接数配置
const maxSockets = 64;
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
const MAX_REQUEST_BYTES = 2 * 1024 * 1024;
const PROXY_TIMEOUT_MS = 15000;
const FORWARD_TIMEOUT_MS = 10000;
const ALLOWED_FORWARD_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
// 不向目标站点透传的请求头
const STRIPPED_FORWARD_HEADERS = new Set([
    'host',
    'cookie',
    'authorization',
    'proxy-authorization',
    'connection',
    'upgrade',
    'transfer-encoding',
    'content-length',
    'keep-alive',
]);

// 出站专用 axios：agent 带 DNS 校验，避免 DoH/系统代理绕过
const lookup = guardedLookup({ mode: 'strict' });
const httpAgent = new http.Agent({ keepAlive: true, maxSockets, lookup });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets, lookup, rejectUnauthorized: false });
const _axios = axios.create({
    httpAgent,
    httpsAgent,
    timeout: PROXY_TIMEOUT_MS,
    maxContentLength: MAX_RESPONSE_BYTES,
    maxBodyLength: MAX_REQUEST_BYTES,
    maxRedirects: 3,
    validateStatus: () => true,
});

/**
 * 代理类接口的认证：管理员凭据 或 PROXY_AUTH
 * @returns {{ok: boolean, statusCode: number, code: string, message: string}}
 */
function authorizeProxyRequest(request) {
    const admin = authorizeAdminRequest(request);
    if (admin.ok) return admin;

    const provided = extractBasicAuthHeader(request);
    const expected = process.env.PROXY_AUTH || ENV.get('PROXY_AUTH', '');
    if (provided && expected && secureCompare(provided, expected)) {
        return { ok: true, statusCode: 200, code: 'OK', message: 'authorized' };
    }
    // 管理员凭据未配置时给出 503，提示部署方补配置
    if (!admin.ok && (admin.code === 'ADMIN_AUTH_NOT_CONFIGURED' || admin.code === 'ADMIN_AUTH_PARTIAL_CONFIG')) {
        return admin;
    }
    return {
        ok: false,
        statusCode: 401,
        code: 'UNAUTHORIZED',
        message: '该接口需要认证',
    };
}

function denyAuth(reply, result) {
    const status = result.statusCode || 401;
    if (status === 401) {
        reply.header('www-authenticate', 'Basic realm="drpy-node"');
    }
    return reply.code(status).send({
        error: result.message,
        code: result.code,
        requestId: undefined,
    });
}

function normalizeProxyError(error) {
    if (error instanceof EgressPolicyError) {
        return new ApiError(ErrorCodes.EGRESS_BLOCKED, error.message, error.statusCode || 403, { expose: true });
    }
    if (isApiError(error)) return error;
    if (error && error.code === 'ECONNABORTED') {
        return new ApiError(ErrorCodes.TIMEOUT, '上游请求超时', 504, { expose: true });
    }
    if (error && (error.code === 'ERR_CANCELED' || error.name === 'AbortError')) {
        return new ApiError(ErrorCodes.CLIENT_CLOSED, '请求已取消', 499, { expose: true });
    }
    return new ApiError(ErrorCodes.UPSTREAM, '上游请求失败', 502, { expose: false, cause: error });
}

/**
 * HTTP 控制器插件
 * @param {Object} fastify - Fastify 实例
 * @param {Object} options - 插件选项
 * @param {Function} done - 完成回调
 */
export default (fastify, options, done) => {
    /**
     * HTTP 代理请求接口
     * POST /http - 代理 HTTP 请求
     */
    fastify.post('/http', async (req, reply) => {
        const requestId = getRequestId(req);
        const auth = authorizeProxyRequest(req);
        if (!auth.ok) return denyAuth(reply, auth);

        const {
            url,
            headers: userHeaders = {},
            params = {},
            method = 'GET',
            data = {},
            responseType,
            maxRedirects,
        } = req.body || {};

        if (!url) {
            return sendError(reply, ApiError.badRequest('Missing required field: url'), { requestId });
        }

        const headers = keysToLowerCase({ ...userHeaders });
        if (!Object.keys(headers).includes('accept')) {
            headers['accept'] = '*/*';
        }

        // 日志只记录脱敏后的目标与方法，不打印请求头与请求体
        req.log.info({
            url: redactUrl(url),
            method,
            headerKeys: Object.keys(headers),
            paramCount: Object.keys(params || {}).length,
        }, 'http proxy request');

        try {
            await assertPublicUrl(url, { mode: 'strict' });

            const response = await _axios({
                url,
                method,
                headers,
                responseType,
                maxRedirects: Number.isFinite(maxRedirects) ? Number(maxRedirects) : 3,
                params,
                data,
            });

            return reply.status(response.status).send({
                status: response.status,
                headers: redactHeaders(response.headers),
                data: response.data,
            });
        } catch (error) {
            if (error && error.response) {
                return reply.status(error.response.status).send({
                    error: typeof error.response.data === 'string'
                        ? error.response.data.slice(0, 2048)
                        : error.response.data,
                    headers: redactHeaders(error.response.headers),
                    status: error.response.status,
                });
            }
            return sendError(reply, normalizeProxyError(error), { requestId });
        }
    });

    /**
     * AI 聊天接口
     * GET /ai - 提供 AI 对话功能
     */
    fastify.get('/ai', async (request, reply) => {
        const userInput = request.query.text;

        if (!userInput || userInput.trim() === '') {
            return sendError(reply, ApiError.badRequest('请提供文本内容'), { requestId: getRequestId(request) });
        }

        const postFields = {
            messages: [{ role: 'user', content: userInput }],
            model: 'gpt-4o-mini-2024-07-18',
        };

        try {
            const response = await axios.post(
                'https://api.s01s.cn/API/ai_zdy/?type=2',
                postFields,
                {
                    headers: { 'Content-Type': 'application/json' },
                    timeout: 30000,
                    maxContentLength: MAX_RESPONSE_BYTES,
                    validateStatus: () => true,
                },
            );
            return reply.status(response.status).send(response.data);
        } catch (error) {
            request.log.error({ err: error }, 'AI 请求失败');
            return sendError(reply, new ApiError(ErrorCodes.UPSTREAM, '请求失败，请稍后重试', 502, { expose: true }), {
                requestId: getRequestId(request),
            });
        }
    });

    /**
     * 请求转发接口
     * ALL /req/* - 转发 HTTP 请求到指定 URL
     */
    fastify.all('/req/*', async (request, reply) => {
        const requestId = getRequestId(request);

        if (!process.env.VERCEL && ENV.get('allow_forward') !== '1') {
            return sendError(reply, ApiError.forbidden('Forward api is not allowed by owner'), { requestId });
        }

        const auth = authorizeProxyRequest(request);
        if (!auth.ok) return denyAuth(reply, auth);

        const method = String(request.method || 'GET').toUpperCase();
        if (!ALLOWED_FORWARD_METHODS.has(method)) {
            return sendError(reply, ApiError.badRequest('不支持的转发方法：' + method), { requestId });
        }

        const targetUrl = request.params['*'];
        if (!/^https?:\/\//i.test(String(targetUrl || ''))) {
            return sendError(reply, ApiError.badRequest('Invalid URL. Must start with http:// or https://'), { requestId });
        }

        request.log.info({ url: redactUrl(targetUrl), method }, 'forward request');

        try {
            await assertPublicUrl(targetUrl, { mode: 'strict' });

            const headers = keysToLowerCase({ ...request.headers });
            for (const name of Object.keys(headers)) {
                if (STRIPPED_FORWARD_HEADERS.has(name)) delete headers[name];
            }
            if (!headers['accept']) headers['accept'] = '*/*';

            const response = await _axios({
                method,
                url: targetUrl,
                headers,
                data: request.body,
                params: request.query,
                timeout: FORWARD_TIMEOUT_MS,
                maxRedirects: 0,
            });

            return reply
                .code(response.status)
                .headers(redactHeaders(response.headers))
                .send(response.data);
        } catch (error) {
            if (error && error.response) {
                return reply
                    .code(error.response.status)
                    .headers(redactHeaders(error.response.headers))
                    .send(error.response.data);
            }
            return sendError(reply, normalizeProxyError(error), { requestId });
        }
    });

    done();
};
