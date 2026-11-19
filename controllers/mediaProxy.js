import {parseRange, contentRange} from '../utils/proxy/rangeStreamer.js';
import {base64Decode, md5} from '../libs_drpy/crypto-util.js';
import '../utils/random-http-ua.js'
import {keysToLowerCase} from '../utils/utils.js';
import {ENV} from "../utils/env.js";
import chunkStream, {testSupport} from '../utils/chunk.js';
import createAxiosInstance from '../utils/createAxiosAgent.js';
import {guardedLookup} from '../utils/security/egressPolicy.js';
import {once} from 'node:events';
import {singleFlight} from '../utils/cache/singleFlight.js';
import {createLogger as __createLogger} from '../utils/logger.js';
const _log = __createLogger('controllers/mediaProxy');

// 全局资源管理器
const globalResourceManager = {
    activeStreams: new Set(),
    activeRequests: new Set(),
    
    addStream: function(stream) {
        this.activeStreams.add(stream);
        stream.on('close', () => this.activeStreams.delete(stream));
        stream.on('end', () => this.activeStreams.delete(stream));
        stream.on('error', () => this.activeStreams.delete(stream));
    },
    
    addRequest: function(requestId) {
        this.activeRequests.add(requestId);
    },
    
    removeRequest: function(requestId) {
        this.activeRequests.delete(requestId);
    },
    
    cleanup: function() {
        // 清理所有活跃的流
        this.activeStreams.forEach(stream => {
            if (stream && !stream.destroyed) {
                stream.destroy();
            }
        });
        this.activeStreams.clear();
        this.activeRequests.clear();
    },
    
    getStats: function() {
        return {
            activeStreams: this.activeStreams.size,
            activeRequests: this.activeRequests.size,
            memoryUsage: process.memoryUsage()
        };
    }
};

// 定期清理和内存监控
setInterval(() => {
    const stats = globalResourceManager.getStats();
    if (stats.activeStreams > 50 || stats.activeRequests > 100) {
        _log.warn('[MediaProxy] High resource usage detected:', stats);
    }
    
    // 强制垃圾回收（如果可用）
    if (global.gc && stats.memoryUsage.heapUsed > 500 * 1024 * 1024) { // 500MB
        global.gc();
        _log.info('[MediaProxy] Forced garbage collection due to high memory usage');
    }
}, 30000); // 每30秒检查一次

const maxSockets = 32; // 减少最大连接数以防止连接池过大
const MEDIA_EGRESS_MODE = process.env.MEDIA_PROXY_EGRESS_MODE || process.env.PROXY_EGRESS_MODE || 'lan';

const _axios = createAxiosInstance({
        lookup: guardedLookup({mode: MEDIA_EGRESS_MODE}),
        maxSockets: maxSockets,
        rejectUnauthorized: true, // 不忽略证书错误
        keepAlive: true,
        keepAliveMsecs: 30000, // 30秒保持连接
        maxFreeSockets: 10, // 最大空闲连接数
        timeout: 30000, // 30秒超时
        freeSocketTimeout: 15000, // 空闲连接超时时间
    },
);

/** 探测结果短期缓存：同一 URL 在 TTL 内不重复打上游（P1-03） */
const PROBE_CACHE_TTL = parseInt(process.env.MEDIA_PROBE_TTL_MS || '30000', 10);
const probeCache = new Map();

/**
 * 从响应头解析总长度（Content-Range 优先，其次 Content-Length）。
 * @param {Object} headers
 * @returns {number}
 */
function parseTotalLength(headers) {
    const contentRange = headers['content-range'];
    if (contentRange) {
        const match = /\/(\d+)$/.exec(String(contentRange));
        if (match) {
            const total = parseInt(match[1], 10);
            if (Number.isFinite(total) && total > 0) return total;
        }
    }

    const contentLength = parseInt(headers['content-length'], 10);
    return Number.isFinite(contentLength) && contentLength > 0 ? contentLength : 0;
}

/**
 * 销毁探测用的临时流。
 * @param {Stream} stream
 * @returns {void}
 */
function destroyProbeStream(stream) {
    if (stream && !stream.destroyed) {
        stream.destroy();
    }
}

/**
 * 读取探测缓存。
 * @param {string} url
 * @returns {Object|null}
 */
function readProbeCache(url) {
    const hit = probeCache.get(url);
    if (!hit) return null;
    if (Date.now() - hit.probedAt > PROBE_CACHE_TTL) {
        probeCache.delete(url);
        return null;
    }
    return hit;
}

/**
 * 写入探测缓存（限制条目数，避免无界增长）。
 * @param {string} url
 * @param {Object} probe
 * @returns {void}
 */
function writeProbeCache(url, probe) {
    if (probeCache.size > 512) {
        const oldest = probeCache.keys().next().value;
        probeCache.delete(oldest);
    }
    probeCache.set(url, probe);
}

/**
 * 探测媒体元信息（P1-03）：优先一次 Range: bytes=0-0 拿到总长度，
 * 不再 HEAD → Range → 完整 GET 三层回退地重复请求上游。
 *
 * @param {string} url
 * @param {Object} headers
 * @param {boolean} hasCookie 带 Cookie 时跳过 HEAD
 * @returns {Promise<{headers: Object, contentLength: number, probedAt: number}>}
 */
async function probeMedia(url, headers, hasCookie) {
    // 1) Range 0-0：一次请求同时得到总长度与 Range 支持情况
    try {
        const response = await _axios.get(url, {
            headers: {...headers, Range: 'bytes=0-0'},
            responseType: 'stream',
            validateStatus: (status) => status === 206 || status === 200,
        });
        const responseHeaders = response.headers;
        destroyProbeStream(response.data);

        const total = parseTotalLength(responseHeaders);
        if (total > 0) {
            return {headers: responseHeaders, contentLength: total, probedAt: Date.now()};
        }
    } catch (rangeError) {
        _log.warn('[MediaProxy] Range probe failed: ' + rangeError.message);
    }

    // 2) HEAD 兜底（带 Cookie 的站点通常不支持 HEAD）
    if (!hasCookie) {
        try {
            const headResponse = await _axios.head(url, {headers});
            const total = parseTotalLength(headResponse.headers);
            if (total > 0) {
                return {headers: headResponse.headers, contentLength: total, probedAt: Date.now()};
            }
        } catch (headError) {
            _log.warn('[MediaProxy] HEAD probe failed: ' + headError.message);
        }
    }

    // 3) 最后兜底：完整 GET 只读响应头，立即销毁流
    const response = await _axios.get(url, {headers, responseType: 'stream'});
    const total = parseTotalLength(response.headers);
    destroyProbeStream(response.data);

    if (!total) {
        throw new Error('Failed to get the total content length.');
    }

    return {headers: response.headers, contentLength: total, probedAt: Date.now()};
}

export default (fastify, options, done) => {
    // 用法同 https://github.com/Zhu-zi-a/mediaProxy
    fastify.all('/mediaProxy', async (request, reply) => {
        const requestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        globalResourceManager.addRequest(requestId);
        
        // 请求完成时清理
        const cleanup = () => {
            globalResourceManager.removeRequest(requestId);
        };
        
        // 监听请求结束事件
        request.raw.on('close', cleanup);
        request.raw.on('aborted', cleanup);
        reply.raw.on('finish', cleanup);
        reply.raw.on('close', cleanup);

        const {thread = 1, form = 'urlcode', url, header, size = '128K', randUa = 0} = request.query;

        // _log.info('url:', url)
        // _log.info('header:', header)

        // Check if the URL parameter is missing
        if (!url) {
            cleanup();
            return reply.code(400).send({error: 'Missing required parameter: url'});
        }

        try {
            // Decode URL and headers based on the form type
            const decodedUrl = form === 'base64' ? base64Decode(url) : url;
            const decodedHeader = header
                ? JSON.parse(form === 'base64' ? base64Decode(header) : header)
                : {};

            // Call the proxy function, passing the decoded URL and headers
            // return await proxyStreamMediaMulti(decodedUrl, decodedHeader, request, reply, thread, size, randUa);
            // return await chunkStream(request, reply, decodedUrl, ids[1], Object.assign({Cookie: cookie}, baseHeader));
            if (ENV.get('play_proxy_mode', '1') !== '2') { // 2磁盘加速 其他都是内存加速
                _log.info('[mediaProxy] proxyStreamMediaMulti 内存加速:chunkSize:', sizeToBytes(size));
                return await proxyStreamMediaMulti(decodedUrl, decodedHeader, request, reply, thread, size, randUa);
            } else {
                _log.info('[mediaProxy] chunkStream 磁盘加速 chunkSize:', sizeToBytes('256K'));
                return await chunkStream(request, reply, decodedUrl, md5(decodedUrl), decodedHeader,
                    Object.assign({chunkSize: 1024 * 256, poolSize: 5, timeout: 1000 * 10}, {
                        // chunkSize: sizeToBytes(size),
                        poolSize: thread
                    })
                );
            }
        } catch (error) {
            // fastify.log.error(error);
            fastify.log.error(error.message);
            cleanup();
            if (!reply.sent && !reply.raw.destroyed) {
                reply.code(500).send({error: error.message});
            }
        }
    });

    done();
};

// Helper function for range-based chunk downloading
async function fetchStream(url, userHeaders, start, end, randUa) {
    let stream = null;
    const headers = keysToLowerCase({
        ...userHeaders,
    });
    // 添加accept属性防止获取网页源码编码不正确问题
    if (!Object.keys(headers).includes('accept')) {
        headers['accept'] = '*/*';
    }
    try {
        const response = await _axios.get(url, {
            headers: {
                ...headers,
                ...randUa ? {
                    'User-Agent': randomUa.generateUa(1, {
                        // device: ['mobile', 'pc'],
                        device: ['pc'],
                        mobileOs: ['android']
                    })
                } : {},
                Range: `bytes=${start}-${end}`,
            },
            responseType: 'stream',
            timeout: 30000, // 30秒超时
        });

        stream = response.data;
        
        // 添加错误处理监听器
        stream.on('error', (error) => {
            _log.error(`[fetchStream] Stream error for range ${start}-${end}:`, error.message);
            if (!stream.destroyed) {
                stream.destroy();
            }
        });

        // 添加超时处理
        const timeoutId = setTimeout(() => {
            if (!stream.destroyed) {
                _log.warn(`[fetchStream] Stream timeout for range ${start}-${end}`);
                stream.destroy();
            }
        }, 60000); // 60秒超时

        // 清理超时定时器
        stream.on('end', () => clearTimeout(timeoutId));
        stream.on('close', () => clearTimeout(timeoutId));
        stream.on('error', () => clearTimeout(timeoutId));

        return {stream: stream, headers: response.headers};
    } catch (error) {
        _log.error(`[fetchStream] Error fetching range ${start}-${end}:`, error.message);
        
        // 确保流被正确销毁
        if (stream && !stream.destroyed) {
            stream.destroy();
        }
        
        throw error;
    }
}

async function proxyStreamMedia(mediaUrl, reqHeaders, request, reply, randUa = 0) {
    let responseStream = null;
    const eventListeners = [];
    
    // 添加事件监听器的辅助函数
    const addListener = (target, event, listener) => {
        eventListeners.push({target, event, listener});
        target.on(event, listener);
    };
    
    // 清理所有事件监听器的函数
    const cleanupListeners = () => {
        eventListeners.forEach(({target, event, listener}) => {
            if (target && typeof target.removeListener === 'function') {
                target.removeListener(event, listener);
            }
        });
        eventListeners.length = 0;
    };
    
    try {
        // 随机生成 UA（如果启用 randUa 参数）
        const randHeaders = randUa
            ? Object.assign({}, reqHeaders, {
                'User-Agent': randomUa.generateUa(1, {
                    // device: ['mobile', 'pc'],
                    device: ['pc'],
                    mobileOs: ['android']
                })
            })
            : reqHeaders;

        const headers = keysToLowerCase({
            ...randHeaders,
        });
        // 添加accept属性防止获取网页源码编码不正确问题
        if (!Object.keys(headers).includes('accept')) {
            headers['accept'] = '*/*';
        }

        const response = await _axios.get(mediaUrl, {
            headers: headers,
            responseType: 'stream',
            timeout: 30000, // 30秒超时
        });

        responseStream = response.data;
        
        // 将流添加到全局资源管理器
        globalResourceManager.addStream(responseStream);

        // 设置响应头
        Object.entries(response.headers).forEach(([key, value]) => {
            if (!['transfer-encoding', 'content-length'].includes(key.toLowerCase())) {
                reply.raw.setHeader(key, value);
            }
        });

        // 处理 range 请求
        const range = request.headers.range;
        if (range) {
            const contentLength = parseInt(response.headers['content-length'], 10);
            // 统一使用 utils/proxy/rangeStreamer.js（P2-01）：支持 suffix-range，越界返回 416
            const parsed = parseRange(range, contentLength);
            if (!parsed) {
                reply.raw.setHeader('Content-Range', `bytes */${contentLength}`);
                reply.raw.writeHead(416);
                reply.raw.end();
                return;
            }
            const {start, end} = parsed;

            reply.raw.setHeader('Content-Range', contentRange(start, end, contentLength));
            reply.raw.setHeader('Content-Length', end - start + 1);
            reply.raw.writeHead(206); // 206 Partial Content
        } else {
            reply.raw.writeHead(200);
        }

        // 监听客户端断开连接
        const onAbort = () => {
            _log.info('[proxyStreamMedia] Client aborted the connection');
            if (responseStream && !responseStream.destroyed) {
                responseStream.destroy();
            }
            cleanupListeners();
        };

        addListener(request.raw, 'aborted', onAbort);
        addListener(request.raw, 'close', onAbort);

        // 流错误处理
        const onStreamError = (error) => {
            _log.error('[proxyStreamMedia] Stream error:', error.message);
            cleanupListeners();
            if (!reply.sent && !reply.raw.destroyed) {
                reply.code(500).send({error: error.message});
            }
        };

        addListener(responseStream, 'error', onStreamError);

        // 流结束处理
        const onStreamEnd = () => {
            _log.info('[proxyStreamMedia] Stream ended successfully');
            cleanupListeners();
        };

        addListener(responseStream, 'end', onStreamEnd);
        addListener(responseStream, 'close', onStreamEnd);

        // 检查连接状态
        if (request.raw.aborted || request.raw.destroyed) {
            _log.info('[proxyStreamMedia] Connection already aborted');
            if (responseStream && !responseStream.destroyed) {
                responseStream.destroy();
            }
            return;
        }

        // 流式传输数据
        responseStream.pipe(reply.raw);

    } catch (error) {
        _log.error('[proxyStreamMedia] Error:', error.message);
        
        // 清理资源
        if (responseStream && !responseStream.destroyed) {
            responseStream.destroy();
        }
        cleanupListeners();
        
        if (!reply.sent && !reply.raw.destroyed) {
            reply.code(500).send({error: error.message});
        }
    }
}

async function proxyStreamMediaMulti(mediaUrl, reqHeaders, request, reply, thread, size, randUa = 0) {
    // 资源清理管理器
    const resourceManager = {
        streams: [],
        eventListeners: [],
        cleanup: function() {
            // 清理所有流
            this.streams.forEach(stream => {
                if (stream && !stream.destroyed) {
                    stream.destroy();
                }
            });
            this.streams = [];
            
            // 清理所有事件监听器
            this.eventListeners.forEach(({target, event, listener}) => {
                if (target && typeof target.removeListener === 'function') {
                    target.removeListener(event, listener);
                }
            });
            this.eventListeners = [];
        },
        addStream: function(stream) {
            this.streams.push(stream);
        },
        addEventListener: function(target, event, listener) {
            this.eventListeners.push({target, event, listener});
            target.on(event, listener);
        }
    };

    try {
        let initialHeaders;
        let contentLength;

        // 随机生成 UA（如果启用 randUa 参数）
        const randHeaders = randUa
            ? Object.assign({}, reqHeaders, {
                'User-Agent': randomUa.generateUa(1, {
                    // device: ['mobile', 'pc'],
                    device: ['pc'],
                    mobileOs: ['android']
                })
            })
            : reqHeaders;

        const headers = keysToLowerCase({
            ...randHeaders,
        });
        // 添加accept属性防止获取网页源码编码不正确问题
        if (!Object.keys(headers).includes('accept')) {
            headers['accept'] = '*/*';
        }
        // 检查请求头中是否包含 Cookie
        const hasCookie = Object.keys(randHeaders).some(key => key.toLowerCase() === 'cookie');
        // _log.info(`[proxyStreamMediaMulti] Checking for Cookie in headers: ${hasCookie}`);

        // 探测元信息（P1-03）：缓存 + single-flight，避免一次播放反复打上游
        let probe = readProbeCache(mediaUrl);
        if (!probe) {
            probe = await singleFlight('media-probe::' + mediaUrl, () => probeMedia(mediaUrl, headers, hasCookie));
            writeProbeCache(mediaUrl, probe);
        }

        initialHeaders = probe.headers;
        contentLength = probe.contentLength;
        // 确保 content-length 有效
        if (!contentLength) {
            throw new Error('Failed to get the total content length.');
        }

        // 设置响应头，排除不必要的头部
        Object.entries(initialHeaders).forEach(([key, value]) => {
            if (!['transfer-encoding', 'content-length'].includes(key.toLowerCase())) {
                reply.raw.setHeader(key, value);
            }
        });

        reply.raw.setHeader('Accept-Ranges', 'bytes');

        // 解析 range 请求头
        const parsed = parseRange(request.headers.range || 'bytes=0-', contentLength);
        if (!parsed) {
            reply.code(416).header('Content-Range', `bytes */${contentLength}`).send();
            _log.info('[proxyStreamMediaMulti] Invalid range, sending 416 response.');
            return;
        }
        const {start, end} = parsed;

        // 设置 Content-Range 和 Content-Length 响应头
        reply.raw.setHeader('Content-Range', contentRange(start, end, contentLength));
        reply.raw.setHeader('Content-Length', end - start + 1);
        reply.raw.writeHead(206); // 206 Partial Content
        // _log.info(`[proxyStreamMediaMulti] Serving range: ${start}-${end}`);

        // 计算每块的大小并划分子范围
        const chunkSize = sizeToBytes(size);
        const totalChunks = Math.ceil((end - start + 1) / chunkSize);
        const threadCount = Math.min(thread, totalChunks);
        const ranges = Array.from({length: threadCount}, (_, i) => {
            const subStart = start + (i * (end - start + 1)) / threadCount;
            const subEnd = Math.min(subStart + (end - start + 1) / threadCount - 1, end);
            return {start: Math.floor(subStart), end: Math.floor(subEnd)};
        });

        // _log.info(`[proxyStreamMediaMulti] Splitting range into ${ranges.length} threads...`);

        // 并发获取数据块
        const fetchChunks = ranges.map(range =>
            fetchStream(mediaUrl, randHeaders, range.start, range.end, randUa)
        );
        
        let streams;
        try {
            streams = await Promise.all(fetchChunks);
        } catch (fetchError) {
            _log.error('[proxyStreamMediaMulti] Error fetching streams:', fetchError.message);
            throw fetchError;
        }

        // 将所有流添加到资源管理器
        streams.forEach(({stream}) => {
            resourceManager.addStream(stream);
            globalResourceManager.addStream(stream);
        });

        // 设置全局中断处理
        const globalAbortHandler = () => {
            _log.info('[proxyStreamMediaMulti] Client connection aborted, cleaning up resources');
            resourceManager.cleanup();
        };

        // 添加中断监听器到资源管理器
        resourceManager.addEventListener(request.raw, 'aborted', globalAbortHandler);
        resourceManager.addEventListener(request.raw, 'close', globalAbortHandler);

        // 按顺序发送数据块
        let cnt = 0;
        for (const {stream} of streams) {
            cnt += 1;
            // _log.info(`[proxyStreamMediaMulti] Streaming chunk ${cnt}...`);

            try {
                // 检查连接状态
                if (request.raw.aborted || request.raw.destroyed) {
                    _log.info(`[proxyStreamMediaMulti] Connection aborted before chunk ${cnt}`);
                    break;
                }

                for await (const chunk of stream) {
                    if (request.raw.aborted || request.raw.destroyed) {
                        // _log.info(`[proxyStreamMediaMulti] Chunk ${cnt} aborted.`);
                        break;
                    }
                    
                    // 安全写入数据
                    if (!reply.raw.destroyed && !reply.raw.writableEnded) {
                        // 客户端读得慢时等待 drain，避免内存里堆积整个切片
                        if (!reply.raw.write(chunk)) {
                            await once(reply.raw, 'drain');
                        }
                    } else {
                        _log.info(`[proxyStreamMediaMulti] Response stream closed during chunk ${cnt}`);
                        break;
                    }
                }
            } catch (error) {
                _log.error(`[proxyStreamMediaMulti] Error during streaming chunk ${cnt}:`, error.message);
                // 不要抛出错误，继续处理下一个chunk
            }
        }

        _log.info('[proxyStreamMediaMulti] All chunks streamed successfully.');
        
        // 安全结束响应
        if (!reply.raw.destroyed && !reply.raw.writableEnded) {
            reply.raw.end();
        }

    } catch (error) {
        _log.error('[proxyStreamMediaMulti] Error:', error.message);
        
        // 确保资源清理
        resourceManager.cleanup();
        
        if (!reply.sent && !reply.raw.destroyed) {
            reply.code(500).send({error: error.message});
        }
    } finally {
        // 最终清理
        resourceManager.cleanup();
    }
}

// Helper function to convert size string (e.g., '128K', '1M') to bytes
function sizeToBytes(size) {
    const sizeMap = {
        K: 1024,
        M: 1024 * 1024,
        G: 1024 * 1024 * 1024
    };
    const unit = size[size.length - 1].toUpperCase();
    const number = parseInt(size, 10);
    return number * (sizeMap[unit] || 1);
}
