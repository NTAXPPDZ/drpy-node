/**
 * 上游文件/分片流式中继（P2-01）。
 *
 * 之前 m3u8-proxy 的 /m3u8-proxy/ts 与 unified-proxy 的 handleFileProxy 各自重复实现：
 * 发起上游请求（透传 Range）→ 状态码 >= 400 原样返回 → 转发白名单响应头 + CORS →
 * HEAD 只返回头部 → GET 把上游流直接交给 Fastify（由 Fastify 处理背压）。
 * 这里统一为一个函数，两条路由只保留各自的错误前缀文案。
 */
import { makeRemoteRequest, forwardResponseHeaders, setCorsHeaders } from '../proxy-util.js';
import { observeUpstream } from '../runtime/metrics.js';

function upstreamTarget(targetUrl) {
    try {
        return new URL(targetUrl).hostname || 'unknown';
    } catch {
        return 'invalid';
    }
}

/**
 * @param {object} request Fastify 请求
 * @param {object} reply Fastify 响应
 * @param {object} options
 * @param {string} options.targetUrl 上游地址（已校验 http/https 与出口策略）
 * @param {object} options.requestHeaders 发给上游的请求头
 * @param {string} [options.errorPrefix='Failed to fetch file'] 上游失败时的 502 文案前缀
 * @returns {Promise<any>} reply
 */
export async function relayUpstream(request, reply, { targetUrl, requestHeaders, errorPrefix = 'Failed to fetch file' }) {
    const startedAt = process.hrtime.bigint();
    const target = upstreamTarget(targetUrl);
    const elapsed = () => Number(process.hrtime.bigint() - startedAt) / 1e9;
    try {
        const range = request.headers.range;
        const remoteResponse = await makeRemoteRequest(targetUrl, requestHeaders, request.method, range);
        observeUpstream(target, remoteResponse.statusCode >= 400 ? 'http_error' : 'ok', elapsed());

        if (remoteResponse.statusCode >= 400) {
            return reply.status(remoteResponse.statusCode).send({
                error: `Remote server error: ${remoteResponse.statusCode}`,
            });
        }

        reply.status(remoteResponse.statusCode);
        forwardResponseHeaders(reply, remoteResponse.headers);
        setCorsHeaders(reply);

        if (request.method === 'HEAD') {
            return reply.send();
        }
        return reply.send(remoteResponse.stream);
    } catch (requestError) {
        const timedOut = /timeout|ETIMEDOUT|ECONNABORTED/i.test(`${requestError.code || ''} ${requestError.message || ''}`);
        observeUpstream(target, timedOut ? 'timeout' : 'error', elapsed());
        return reply.status(502).send({
            error: `${errorPrefix}: ${requestError.message}`,
        });
    }
}

export default { relayUpstream };
