/**
 * Fail-closed authentication helpers for the management plane.
 *
 * Management routes use API_AUTH_NAME / API_AUTH_CODE. If either value is
 * missing, management access is rejected instead of silently becoming public.
 */
import {createHash, createHmac, randomBytes, timingSafeEqual} from 'node:crypto';

const ADMIN_NAME_ENV = 'API_AUTH_NAME';
const ADMIN_CODE_ENV = 'API_AUTH_CODE';
const PROTECTED_CONFIG_FILES = new Set([
    'index.js',
    'index.js.md5',
    'index.config.js',
    'index.config.js.md5',
]);

/**
 * 历史默认口令与占位符不算“已配置”，否则等于把管理面暴露给公开默认值。
 */
/**
 * 管理会话 cookie：浏览器 WebSocket 握手无法附加 Authorization 头，
 * 因此 Basic 认证成功后下发 HttpOnly 会话 cookie，后续 HTTP 与 WS 均可复用。
 */
export const ADMIN_SESSION_COOKIE = 'drpy_admin_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
let sessionSecret = null;

function getSessionSecret() {
    if (!sessionSecret) sessionSecret = process.env.ADMIN_SESSION_SECRET || randomBytes(32).toString('hex');
    return sessionSecret;
}

function signSession(payload) {
    return createHmac('sha256', getSessionSecret()).update(payload).digest('base64url');
}

/**
 * 生成管理会话 token
 * @param {string} username
 * @returns {string}
 */
export function createSessionToken(username) {
    const expiresAt = Date.now() + SESSION_TTL_MS;
    const payload = Buffer.from(username + ":" + expiresAt).toString("base64url");
    return payload + "." + signSession(payload);
}

/**
 * 校验管理会话 token
 * @param {string} token
 * @param {string} expectedUsername
 * @returns {boolean}
 */
export function verifySessionToken(token, expectedUsername) {
    if (typeof token !== 'string') return false;
    const separatorIndex = token.indexOf('.');
    if (separatorIndex <= 0) return false;
    const payload = token.slice(0, separatorIndex);
    const signature = token.slice(separatorIndex + 1);
    if (!secureCompare(signature, signSession(payload))) return false;
    let decoded;
    try {
        decoded = Buffer.from(payload, 'base64url').toString('utf8');
    } catch {
        return false;
    }
    const splitAt = decoded.lastIndexOf(':');
    if (splitAt < 0) return false;
    const expiresAt = Number(decoded.slice(splitAt + 1));
    if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return false;
    return secureCompare(decoded.slice(0, splitAt), expectedUsername);
}

/**
 * 读取请求 cookie
 * @param {object} request
 * @param {string} name
 * @returns {string|null}
 */
export function readCookie(request, name) {
    const header = request?.headers?.cookie;
    if (typeof header !== 'string' || !header) return null;
    for (const part of header.split(';')) {
        const index = part.indexOf('=');
        if (index < 0) continue;
        if (part.slice(0, index).trim() !== name) continue;
        return decodeURIComponent(part.slice(index + 1).trim());
    }
    return null;
}

/**
 * 构造会话 cookie 的 Set-Cookie 值
 * @param {string} token
 * @returns {string}
 */
export function buildSessionCookie(token) {
    const maxAge = Math.floor(SESSION_TTL_MS / 1000);
    const secure = process.env.COOKIE_SECURE === '1' ? '; Secure' : '';
    return `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

/**
 * 是否为回环地址请求
 * @param {object} request
 * @returns {boolean}
 */
export function isLoopbackRequest(request) {
    const raw = request?.raw || request;
    const address = raw?.socket?.remoteAddress || raw?.ip || request?.ip || '';
    const normalized = String(address).replace(/^::ffff:/i, '');
    if (normalized === '::1' || normalized === '127.0.0.1') return true;
    return /^127\./.test(normalized);
}

/**
 * 是否显式信任回环免认证（默认关闭，仅本机自托管调试）
 * @param {object} [env]
 * @returns {boolean}
 */
export function isLoopbackTrustEnabled(env = process.env) {
    return String(env.ADMIN_AUTH_TRUST_LOOPBACK || '') === '1';
}

// 前缀匹配：CHANGE_ME_PROXY_AUTH / your_password_here 这类占位值同样视为未配置
const PLACEHOLDER_PATTERN = /^(drpys_download_secret|drpys|change[_-]?me|your[_-]?(name|code|password|secret)|admin:admin)/i;

export function isPlaceholderCredential(value) {
    const text = String(value || '').trim();
    if (!text) return true;
    return PLACEHOLDER_PATTERN.test(text);
}

function readEnv(env, key) {
    const value = env ? env[key] : undefined;
    return typeof value === 'string' ? value : '';
}

/**
 * Read and validate management credentials. The password is returned only for
 * server-side use (Basic auth comparison and generated cat links).
 */
export function getAdminCredentials(env = process.env) {
    const username = readEnv(env, ADMIN_NAME_ENV);
    const password = readEnv(env, ADMIN_CODE_ENV);
    const usernameConfigured = !isPlaceholderCredential(username);
    const passwordConfigured = !isPlaceholderCredential(password);

    if (!usernameConfigured && !passwordConfigured) {
        return {
            ok: false,
            configured: false,
            reason: 'missing',
            username: '',
            password: '',
            statusCode: 503,
            code: 'ADMIN_AUTH_NOT_CONFIGURED',
            message: 'Admin authentication is not configured',
        };
    }

    if (!usernameConfigured || !passwordConfigured) {
        return {
            ok: false,
            configured: false,
            reason: 'incomplete',
            username,
            password: '',
            statusCode: 503,
            code: 'ADMIN_AUTH_PARTIAL_CONFIG',
            message: 'Admin authentication configuration is incomplete',
        };
    }

    return {
        ok: true,
        configured: true,
        reason: 'configured',
        username,
        password,
        statusCode: 200,
        code: 'ADMIN_AUTH_OK',
        message: 'OK',
    };
}

/**
 * Constant-time string comparison. Both inputs are hashed first so different
 * input lengths do not short-circuit the comparison.
 */
export function secureCompare(left, right) {
    const leftValue = typeof left === 'string' ? left : String(left ?? '');
    const rightValue = typeof right === 'string' ? right : String(right ?? '');
    const leftHash = createHash('sha256').update(leftValue, 'utf8').digest();
    const rightHash = createHash('sha256').update(rightValue, 'utf8').digest();
    return timingSafeEqual(leftHash, rightHash);
}

/**
 * Decode a Basic authorization header. Splits on the first colon so passwords
 * containing ':' continue to work.
 */
export function decodeBasicAuthorization(header) {
    if (typeof header !== 'string') return null;
    const match = /^Basic\s+(\S+)\s*$/i.exec(header.trim());
    if (!match) return null;

    const token = match[1];
    if (!/^[A-Za-z0-9+/=]+$/.test(token)) return null;

    let decoded;
    try {
        decoded = Buffer.from(token, 'base64').toString('utf8');
    } catch {
        return null;
    }
    const separator = decoded.indexOf(':');
    if (separator < 0) return null;

    return {
        username: decoded.slice(0, separator),
        password: decoded.slice(separator + 1),
    };
}

function firstHeaderValue(value) {
    if (Array.isArray(value)) return value[0];
    return value;
}

/**
 * Extract a Basic header from the Authorization header, an `auth` query
 * parameter (WebSocket/browser compatibility), or the WebSocket subprotocol
 * convention `base64.<base64 credentials>`.
 */
export function extractBasicAuthHeader(request) {
    let authHeader = firstHeaderValue(request?.headers?.authorization);
    if (!authHeader && typeof request?.query?.auth === 'string' && request.query.auth.length > 0) {
        authHeader = `Basic ${request.query.auth}`;
    }
    if (!authHeader) {
        const protocolHeader = firstHeaderValue(request?.headers?.['sec-websocket-protocol']);
        if (typeof protocolHeader === 'string') {
            const protocols = protocolHeader.split(',').map(value => value.trim());
            const authProtocol = protocols.find(value => value.startsWith('base64.'));
            if (authProtocol) authHeader = `Basic ${authProtocol.slice('base64.'.length)}`;
        }
    }
    return authHeader;
}

/**
 * Authorize a management request without touching the reply. This is the
 * shared decision function used by all management route hooks.
 *
 * @param {object} request Fastify request-like object
 * @param {object} [env] environment object (process.env by default)
 * @returns {{ok: boolean, statusCode: number, code: string, message: string}}
 */
export function authorizeAdminRequest(request, env = process.env) {
    if (isLoopbackTrustEnabled(env) && isLoopbackRequest(request)) {
        return {
            ok: true,
            statusCode: 200,
            code: 'ADMIN_AUTH_LOOPBACK',
            message: 'OK (loopback trust)',
        };
    }

    const credentials = getAdminCredentials(env);
    if (!credentials.ok) {
        return {
            ok: false,
            statusCode: credentials.statusCode,
            code: credentials.code,
            message: credentials.message,
        };
    }

    const authHeader = extractBasicAuthHeader(request);
    if (!authHeader) {
        const sessionToken = readCookie(request, ADMIN_SESSION_COOKIE);
        if (sessionToken && verifySessionToken(sessionToken, credentials.username)) {
            return {
                ok: true,
                statusCode: 200,
                code: 'ADMIN_AUTH_SESSION',
                message: 'OK',
            };
        }
        return {
            ok: false,
            statusCode: 401,
            code: 'ADMIN_AUTH_REQUIRED',
            message: 'Authentication required',
        };
    }

    const provided = decodeBasicAuthorization(authHeader);
    if (!provided) {
        return {
            ok: false,
            statusCode: 401,
            code: 'ADMIN_AUTH_INVALID',
            message: 'Invalid credentials',
        };
    }

    const usernameMatches = secureCompare(provided.username, credentials.username);
    const passwordMatches = secureCompare(provided.password, credentials.password);
    if (!usernameMatches || !passwordMatches) {
        return {
            ok: false,
            statusCode: 401,
            code: 'ADMIN_AUTH_INVALID',
            message: 'Invalid credentials',
        };
    }

    return {
        ok: true,
        statusCode: 200,
        code: 'ADMIN_AUTH_OK',
        message: 'OK',
    };
}

/**
 * Send a management auth failure using the existing plain-text 401 shape and a
 * JSON 503 shape for configuration failures.
 */
export function sendAdminAuthFailure(reply, result) {
    if (!reply || reply.sent) return reply;
    reply.header('Cache-Control', 'no-store');
    if (result.statusCode === 401) {
        reply.header('WWW-Authenticate', 'Basic realm="drpy-node admin"');
        return reply.code(401).send(result.message);
    }
    return reply.code(result.statusCode || 503).send({
        error: result.message,
        code: result.code,
    });
}

/**
 * Fastify preHandler-compatible management auth hook.
 */
export function validateAdminAuth(request, reply, done) {
    const result = authorizeAdminRequest(request);
    if (result.ok) {
        if (result.code === 'ADMIN_AUTH_OK' && reply) {
            const credentials = getAdminCredentials();
            if (credentials.ok) {
                reply.header('Set-Cookie', buildSessionCookie(createSessionToken(credentials.username)));
            }
        }
        done();
        return;
    }
    sendAdminAuthFailure(reply, result);
}

/**
 * Paths under /admin and /api/admin are considered the management plane.
 */
export function isAdminPath(url) {
    if (typeof url !== 'string') return false;
    const pathname = url.split('?')[0];
    return pathname === '/admin'
        || pathname.startsWith('/admin/')
        || pathname === '/api/admin'
        || pathname.startsWith('/api/admin/');
}

/**
 * Existing behavior: most /config/* files are public, while the generated cat
 * config files use Basic auth. Keeping this check separate preserves the
 * public config contract while management routes always fail closed.
 */
export function isPublicConfigRequest(url) {
    if (typeof url !== 'string' || !url.startsWith('/config/')) return false;
    const configPath = url.slice('/config/'.length).split('?')[0];
    return !PROTECTED_CONFIG_FILES.has(configPath);
}

export const ADMIN_AUTH_ENV_KEYS = Object.freeze({
    name: ADMIN_NAME_ENV,
    code: ADMIN_CODE_ENV,
});
