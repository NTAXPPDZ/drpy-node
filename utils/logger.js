/**
 * 统一日志入口（P2-04）。
 *
 * 之前 controllers/utils/libs 中约 530 处直接调用 console.*，格式各异、无法脱敏、无法按模块过滤。
 * 现在统一为：
 *   const _log = createLogger('controllers/mediaProxy');
 *   _log.info('x', y);   // 与 console.log 相同的入参语义（util.format）
 * 输出为 Pino JSON 行，附带 module 字段，并经过与 Fastify 相同的 redact 规则。
 *
 * WebSocket 控制台广播（CONSOLE_WS_LOG=1）不再 monkey patch console，而是通过 setLogTap 订阅。
 */
import util from 'node:util';
import pino from 'pino';

const REDACT_PATHS = [
    'authorization',
    'cookie',
    'set-cookie',
    'headers.authorization',
    'headers.cookie',
    'headers["set-cookie"]',
    'password',
    'token',
    'secret',
    'pwd',
    'apiKey',
    'api_key',
    'x-api-key',
];

const root = pino({
    level: process.env.LOG_LEVEL || 'info',
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
});

let logTap = null;

// 文本日志脱敏：结构化字段由 pino redact 处理；这里处理拼接在文本里的 key=value 与 Basic 凭据
const TEXT_SECRET_PATTERNS = [
    [/(Basic\s+)[A-Za-z0-9+/=._-]+/gi, '$1[REDACTED]'],
    [/((?:token|pass(?:word)?|pwd|secret|cookie|api[_-]?key|authorization|auth)\s*[=:]\s*)[^&\s,;'"]+/gi, '$1[REDACTED]'],
];

export function redactText(text) {
    let result = String(text);
    for (const [pattern, replacement] of TEXT_SECRET_PATTERNS) {
        result = result.replace(pattern, replacement);
    }
    return result;
}

/** 订阅所有统一日志（用于 WebSocket 广播）。传 null 取消订阅。 */
export function setLogTap(fn) {
    logTap = typeof fn === 'function' ? fn : null;
}

/**
 * 创建模块日志器，接口与 console 对齐。
 * @param {string} moduleName 模块名（建议为相对仓库根的路径，如 controllers/mediaProxy）
 */
export function createLogger(moduleName) {
    const child = root.child({ module: moduleName });
    const emit = (level) => (...args) => {
        const text = redactText(util.format(...args));
        child[level](text);
        if (logTap) {
            try {
                logTap(level, text, moduleName);
            } catch {
                // 广播失败不能影响业务日志
            }
        }
    };
    return {
        debug: emit('debug'),
        info: emit('info'),
        warn: emit('warn'),
        error: emit('error'),
    };
}

export default { createLogger, setLogTap, redactText };
