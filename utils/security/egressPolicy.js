/**
 * 出站访问策略（EgressPolicy）
 *
 * 目标：
 * 1. 只允许 http/https；
 * 2. DNS 解析后逐个校验 A/AAAA，拒绝回环、私网、链路本地、保留地址与云元数据地址；
 * 3. 连接时通过自定义 lookup 再做一次校验，抵御 DNS 重绑定；
 * 4. 拒绝 file/ftp/gopher/data 等协议。
 *
 * 两种模式：
 * - strict（默认）：拒绝私网/回环/链路本地/保留/元数据，用于 /http、/req/*、unified-proxy 等外部代理；
 * - metadata：只拒绝云元数据与回环，用于 webdav/ftp/file-proxy 这类需要访问内网的播放链路。
 */

import net from 'node:net';
import dns from 'node:dns';
import { URL } from 'node:url';

export class EgressPolicyError extends Error {
    constructor(code, message, statusCode = 403) {
        super(message);
        this.name = 'EgressPolicyError';
        this.code = code;
        this.statusCode = statusCode;
    }
}

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

// 云元数据地址（任何模式都拒绝）
const METADATA_V4 = new Set([
    '169.254.169.254', // AWS / GCP / Azure / 阿里云（部分）
    '169.254.170.2', // ECS task metadata
    '100.100.100.200', // 阿里云
    '169.254.169.123', // AWS time sync（顺带）
]);
const METADATA_V6 = new Set([
    'fd00:ec2::254',
    'fe80::a9fe:a9fe',
]);
const METADATA_HOSTNAMES = new Set([
    'metadata',
    'metadata.google.internal',
    'instance-data',
    'metadata.azure.internal',
]);

/**
 * IPv4 点分字符串转整数
 */
function ipv4ToInt(ip) {
    const parts = ip.split('.');
    if (parts.length !== 4) return null;
    let value = 0;
    for (const part of parts) {
        if (!/^\d{1,3}$/.test(part)) return null;
        const n = Number(part);
        if (n > 255) return null;
        value = (value * 256) + n;
    }
    return value >>> 0;
}

function inV4Range(ipInt, cidr, bits) {
    const mask = bits === 0 ? 0 : (0xFFFFFFFF << (32 - bits)) >>> 0;
    return (ipInt & mask) === (cidr & mask);
}

const PRIVATE_V4 = [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10], // CGNAT
    ['127.0.0.0', 8],
    ['169.254.0.0', 16], // 链路本地
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.0.2.0', 24],
    ['192.88.99.0', 24],
    ['192.168.0.0', 16],
    ['198.51.100.0', 24],
    ['203.0.113.0', 24],
    ['224.0.0.0', 4], // 组播
    ['240.0.0.0', 4], // 保留
].map(([base, bits]) => [ipv4ToInt(base), bits]);

/**
 * 是否为需要拦截的 IPv4（strict 模式）
 */
function isBlockedV4Strict(ip) {
    const value = ipv4ToInt(ip);
    if (value === null) return true;
    return PRIVATE_V4.some(([base, bits]) => inV4Range(value, base, bits));
}

/**
 * 从 IPv6 文本中提取内嵌的 IPv4（IPv4-mapped / NAT64 / 6to4）
 */
function extractEmbeddedV4(ip) {
    const lower = ip.toLowerCase();
    if (lower.startsWith('::ffff:') && lower.includes('.')) {
        return lower.slice('::ffff:'.length);
    }
    if (lower.startsWith('64:ff9b::') && lower.endsWith('.')) {
        return lower.slice('64:ff9b::'.length);
    }
    return null;
}

/**
 * 是否为需要拦截的 IPv6（strict 模式）
 */
function isBlockedV6Strict(ip) {
    const lower = ip.toLowerCase().split('%')[0];
    const embedded = extractEmbeddedV4(lower);
    if (embedded) return isBlockedV4Strict(embedded);
    if (lower === '::' || lower === '::1') return true;
    // ULA fc00::/7
    if (/^f[cd][0-9a-f]{2}:/.test(lower)) return true;
    // 链路本地 fe80::/10
    if (/^fe[89ab][0-9a-f]:/.test(lower)) return true;
    // 组播 ff00::/8
    if (/^ff[0-9a-f]{2}:/.test(lower)) return true;
    // 站点本地 fec0::/10
    if (/^fe[cd]/.test(lower)) return true;
    return false;
}

/**
 * 是否为元数据地址
 */
function isMetadataAddress(address) {
    const lower = String(address).toLowerCase().split('%')[0];
    if (METADATA_V4.has(lower) || METADATA_V6.has(lower)) return true;
    const embedded = extractEmbeddedV4(lower);
    if (embedded && METADATA_V4.has(embedded)) return true;
    return false;
}

/**
 * 单地址校验
 * @param {string} address IP 字面量
 * @param {{mode?: 'strict'|'metadata'}} options
 * @throws {EgressPolicyError}
 */
export function assertAllowedAddress(address, options = {}) {
    const mode = options.mode || 'strict';
    const ip = String(address || '').split('%')[0];
    const version = net.isIP(ip);
    if (version === 0) {
        throw new EgressPolicyError('EGRESS_INVALID_ADDRESS', '目标地址不合法');
    }
    if (isMetadataAddress(ip)) {
        throw new EgressPolicyError('EGRESS_BLOCKED', '禁止访问云元数据地址');
    }
    if (mode === 'lan' || mode === 'off') {
        // lan/off：仅拦元数据地址，允许内网与回环（自建 webdav/ftp 与本地播放代理链路）
        return true;
    }
    if (mode === 'metadata') {
        // metadata 模式仅额外拦截回环
        if ((version === 4 && ip.startsWith('127.')) || (version === 6 && ip === '::1')) {
            throw new EgressPolicyError('EGRESS_BLOCKED', '禁止访问回环地址');
        }
        return true;
    }
    if (version === 4 && isBlockedV4Strict(ip)) {
        throw new EgressPolicyError('EGRESS_BLOCKED', '禁止访问内网/保留地址：' + ip);
    }
    if (version === 6 && isBlockedV6Strict(ip)) {
        throw new EgressPolicyError('EGRESS_BLOCKED', '禁止访问内网/保留地址：' + ip);
    }
    return true;
}

/**
 * DNS 解析并校验全部记录
 * @param {string} hostname
 * @param {{mode?: string, resolve?: Function}} options
 * @returns {Promise<string[]>} 允许的地址列表
 */
export async function resolveAndCheck(hostname, options = {}) {
    const mode = options.mode || 'strict';
    const name = String(hostname || '').trim();
    if (!name) throw new EgressPolicyError('EGRESS_INVALID_HOST', '缺少主机名', 400);

    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(name) || net.isIPv6(name)) {
        assertAllowedAddress(name, { mode });
        return [name];
    }

    const lookupFn = options.resolve || dns.promises.lookup;
    let records = [];
    try {
        records = await lookupFn(name, { all: true, verbatim: true });
    } catch (error) {
        throw new EgressPolicyError('EGRESS_DNS_FAILED', 'DNS 解析失败：' + name, 502);
    }
    if (!Array.isArray(records)) {
        records = [{ address: records.address, family: records.family }];
    }
    if (records.length === 0) {
        throw new EgressPolicyError('EGRESS_DNS_EMPTY', 'DNS 无解析结果：' + name, 502);
    }
    for (const record of records) {
        assertAllowedAddress(record.address, { mode });
    }
    return records.map(record => record.address);
}

/**
 * 校验 URL：协议 + 主机名 + DNS 全部结果
 * @param {string|URL} rawUrl
 * @param {{mode?: 'strict'|'metadata', allowHosts?: string[]}} options
 * @returns {Promise<URL>}
 */
export async function assertPublicUrl(rawUrl, options = {}) {
    let parsed;
    try {
        parsed = rawUrl instanceof URL ? rawUrl : new URL(String(rawUrl));
    } catch {
        throw new EgressPolicyError('EGRESS_INVALID_URL', 'URL 格式不合法', 400);
    }

    if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
        throw new EgressPolicyError('EGRESS_PROTOCOL_BLOCKED', '只允许 http/https 协议：' + parsed.protocol, 403);
    }

    const hostname = parsed.hostname.replace(/^\[/, '').replace(/\]$/, '');
    if (!hostname) throw new EgressPolicyError('EGRESS_INVALID_HOST', '缺少主机名', 400);

    const lowerHost = hostname.toLowerCase();
    if (METADATA_HOSTNAMES.has(lowerHost)) {
        throw new EgressPolicyError('EGRESS_BLOCKED', '禁止访问云元数据服务');
    }
    const allowHosts = Array.isArray(options.allowHosts) ? options.allowHosts : [];
    if (allowHosts.includes(lowerHost)) {
        return parsed;
    }

    await resolveAndCheck(hostname, { mode: options.mode || 'strict', resolve: options.resolve });
    return parsed;
}

/**
 * 生成带校验的 dns.lookup，供 http.Agent / https.Agent 使用
 * 这样连接时的最终解析结果也会被校验，抵御 DNS 重绑定。
 * @param {{mode?: 'strict'|'metadata'}} options
 * @returns {Function}
 */
export function guardedLookup(options = {}) {
    const mode = options.mode || 'strict';
    return function lookupWithPolicy(hostname, lookupOptions, callback) {
        const opts = typeof lookupOptions === 'function' ? {} : (lookupOptions || {});
        const cb = typeof lookupOptions === 'function' ? lookupOptions : callback;
        dns.lookup(hostname, { ...opts, all: true, verbatim: true }, (error, addresses) => {
            if (error) return cb(error);
            try {
                if (!Array.isArray(addresses) || addresses.length === 0) {
                    throw new EgressPolicyError('EGRESS_DNS_EMPTY', 'DNS 无解析结果：' + hostname, 502);
                }
                for (const record of addresses) {
                    assertAllowedAddress(record.address, { mode });
                }
            } catch (policyError) {
                return cb(policyError);
            }
            if (opts.all) return cb(null, addresses);
            return cb(null, addresses[0].address, addresses[0].family);
        });
    };
}

/**
 * 默认导出的策略对象，便于统一引用
 */
export const EgressPolicy = {
    assertPublicUrl,
    assertAllowedAddress,
    resolveAndCheck,
    guardedLookup,
};

export default EgressPolicy;
