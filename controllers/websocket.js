/**
 * WebSocket控制器模块
 * 提供WebSocket连接管理、实时日志广播和客户端通信功能
 * @module websocket-controller
 */

import {validateBasicAuth} from "../utils/api_validate.js";
import {authorizeAdminRequest, extractBasicAuthHeader, secureCompare} from "../utils/security/auth.js";
import {redactObject} from "../utils/security/redact.js";
import {ENV} from "../utils/env.js";
import {toBeijingTime} from "../utils/datetime-format.js";
import util from 'util';
import {setLogTap} from '../utils/logger.js';

// WebSocket 客户端管理
const wsClients = new Set();

// 导出客户端管理函数
export function addClient(client) {
    wsClients.add(client);
}

export function removeClient(client) {
    wsClients.delete(client);
}

// 需要拦截的console方法列表
const CONSOLE_METHODS = [
    'log', 'error', 'warn', 'info', 'debug',
    'time', 'timeEnd', 'timeLog',
    'assert', 'clear', 'count', 'countReset',
    'dir', 'dirxml', 'group', 'groupCollapsed', 'groupEnd',
    'table', 'trace', 'profile', 'profileEnd'
];

// 原始 console 方法备份
const originalConsole = {};

// 动态备份所有console方法
CONSOLE_METHODS.forEach(method => {
    if (typeof console[method] === 'function') {
        originalConsole[method] = console[method];
    }
});

// 广播消息到所有 WebSocket 客户端
function broadcastToClients(message) {
    const deadClients = [];

    wsClients.forEach(client => {
        try {
            // 使用WebSocket的OPEN常量进行状态检查
            if (client.readyState === client.OPEN) {
                client.send(message);
            } else {
                deadClients.push(client);
            }
        } catch (error) {
            originalConsole.error('Error broadcasting to client:', error);
            deadClients.push(client);
        }
    });

    // 清理断开的连接
    deadClients.forEach(client => wsClients.delete(client));
}

// Console 拦截器
function interceptConsole() {
    const createInterceptor = (level, originalMethod) => {
        return function (...args) {
            // 1. 调用原始方法，保证终端输出不受影响
            originalMethod.apply(console, args);

            // 2. 如果有 WebSocket 客户端连接，才处理广播
            if (wsClients.size > 0) {
                // 3. 将极其耗时的序列化和网络 IO 丢给 setImmediate
                // 这样当前 API 请求的执行（比如循环 200 次 console.log）不会被阻塞
                setImmediate(() => {
                    try {
                        const content = args.map(arg => {
                            if (typeof arg === 'string') return arg;
                            try {
                                return typeof arg === 'object' ? util.inspect(arg, { depth: 1 }) : String(arg);
                            } catch (e) {
                                return String(arg);
                            }
                        }).join(' ');

                        const msg = JSON.stringify({
                            type: 'console',
                            level,
                            timestamp: toBeijingTime(new Date()),
                            content: redactObject(content)
                        });

                        broadcastToClients(msg);
                    } catch (error) {
                        originalConsole.error('Log formatting error:', error);
                    }
                });
            }
        };
    };

    // 动态拦截所有console方法
    CONSOLE_METHODS.forEach(method => {
        if (originalConsole[method]) {
            console[method] = createInterceptor(method, originalConsole[method]);
        }
    });

    // 统一 logger（utils/logger.js）输出同样广播到 WebSocket 客户端
    setLogTap((level, text) => {
        if (wsClients.size === 0) return;
        setImmediate(() => {
            try {
                const msg = JSON.stringify({
                    type: 'console',
                    level,
                    timestamp: toBeijingTime(new Date()),
                    content: redactObject(text)
                });
                broadcastToClients(msg);
            } catch (error) {
                originalConsole.error('Log tap formatting error:', error);
            }
        });
    });
}

// 恢复原始 console
function restoreConsole() {
    setLogTap(null);
    // 动态恢复所有console方法
    CONSOLE_METHODS.forEach(method => {
        if (originalConsole[method]) {
            console[method] = originalConsole[method];
        }
    });
}

// console 拦截只在显式开启时生效：生产默认关闭，避免把全部日志广播给未认证客户端
export const CONSOLE_BROADCAST_ENABLED = process.env.CONSOLE_WS_LOG === '1';
if (CONSOLE_BROADCAST_ENABLED) {
    interceptConsole();
}

/**
 * WebSocket 连接认证：管理员凭据或 PROXY_AUTH
 */
function authorizeWsRequest(req) {
    const admin = authorizeAdminRequest(req);
    if (admin.ok) return admin;
    const provided = extractBasicAuthHeader(req);
    const expected = process.env.PROXY_AUTH || ENV.get('PROXY_AUTH', '');
    if (provided && expected && secureCompare(provided, expected)) {
        return {ok: true, statusCode: 200, code: 'OK', message: 'authorized'};
    }
    if (admin.code === 'ADMIN_AUTH_NOT_CONFIGURED' || admin.code === 'ADMIN_AUTH_PARTIAL_CONFIG') {
        return admin;
    }
    return {ok: false, statusCode: 401, code: 'UNAUTHORIZED', message: 'WebSocket 需要认证'};
}

/**
 * WebSocket控制器插件
 * @param {Object} fastify - Fastify实例
 * @param {Object} options - 插件选项
 * @param {Function} done - 完成回调
 */
export default (fastify, options, done) => {
    /**
     * WebSocket连接路由
     * GET /ws - 建立WebSocket连接
     */
    fastify.get('/ws', {websocket: true}, (socket, req) => {
        // 认证：管理员 Basic（header 或 sec-websocket-protocol）或 PROXY_AUTH
        const auth = authorizeWsRequest(req);
        if (!auth.ok) {
            originalConsole.warn(`WebSocket 拒绝未认证连接: ${auth.code}`);
            try {
                socket.send(JSON.stringify({type: 'error', code: auth.code, message: auth.message}));
            } catch {
                // 忽略发送失败
            }
            socket.close(1008, auth.message);
            return;
        }

        const clientId = Date.now() + Math.random();
        originalConsole.log(`WebSocket client connected: ${clientId}`);

        // 添加到客户端集合
        wsClients.add(socket);

        // 设置连接属性
        socket.clientId = clientId;
        socket.isAlive = true;
        socket.lastPing = Date.now();

        // 发送欢迎消息 - 先检查send方法是否存在
        if (typeof socket.send === 'function') {
            socket.send(JSON.stringify({
                type: 'welcome',
                message: 'WebSocket connection established',
                clientId: clientId,
                timestamp: Date.now()
            }));
        } else {
            originalConsole.error('Socket does not have send method');
        }

        // 设置心跳检测
        const heartbeatInterval = setInterval(() => {
            if (!socket.isAlive) {
                originalConsole.log(`Client ${clientId} failed heartbeat, terminating`);
                clearInterval(heartbeatInterval);
                wsClients.delete(socket); // 修复内存泄露：从客户端集合中移除
                socket.terminate();
                return;
            }

            socket.isAlive = false;
            socket.ping();
        }, 30000); // 30秒心跳检测

        // 处理pong响应
        socket.on('pong', () => {
            socket.isAlive = true;
        });

        // 处理消息
        socket.on('message', (message) => {
            try {
                const data = JSON.parse(message.toString());
                if (data && data.type === 'heartbeat') {
                    originalConsole.debug(`Received from ${clientId}:`, data);
                } else {
                    originalConsole.log(`Received from ${clientId}:`, data);
                }

                // 回显消息
                if (socket.readyState === socket.OPEN) {
                    socket.send(JSON.stringify({
                        type: 'echo',
                        originalMessage: data,
                        timestamp: Date.now(),
                        clientId: clientId
                    }));
                }
            } catch (error) {
                originalConsole.error('Error processing message:', error);
                if (socket.readyState === socket.OPEN) {
                    socket.send(JSON.stringify({
                        type: 'error',
                        message: 'Invalid JSON format',
                        timestamp: Date.now()
                    }));
                }
            }
        });

        // 处理连接关闭
        socket.on('close', (code, reason) => {
            originalConsole.log(`Client ${clientId} disconnected: ${code} ${reason}`);
            wsClients.delete(socket);
            clearInterval(heartbeatInterval);
        });

        // 处理错误
        socket.on('error', (error) => {
            originalConsole.error(`WebSocket error for client ${clientId}:`, error);
            wsClients.delete(socket);
            clearInterval(heartbeatInterval);
        });
    });

    /**
     * WebSocket状态查询接口
     * GET /ws/status - 获取WebSocket服务状态
     */
    fastify.get('/ws/status', {preHandler: validateBasicAuth}, async (request, reply) => {
        return {
            status: 'ok',
            timestamp: toBeijingTime(new Date()),
            clients: wsClients.size,
            console_intercepted: CONSOLE_BROADCAST_ENABLED
        };
    });

    /**
     * 手动广播接口
     * POST /ws/broadcast - 向所有WebSocket客户端广播消息
     */
    fastify.post('/ws/broadcast', {preHandler: validateBasicAuth}, async (request, reply) => {
        const {message} = request.body;
        if (!message) {
            return reply.code(400).send({error: 'Message is required'});
        }

        const broadcastMessage = {
            type: 'broadcast',
            timestamp: toBeijingTime(new Date()),
            content: message
        };

        broadcastToClients(JSON.stringify(broadcastMessage));

        return {
            status: 'ok',
            timestamp: toBeijingTime(new Date()),
            message: 'Message broadcasted',
            clients: wsClients.size
        };
    });

    done();
};

// 导出工具函数供其他模块使用
export {wsClients, broadcastToClients, originalConsole, interceptConsole, restoreConsole};