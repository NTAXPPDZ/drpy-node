/**
 * M3U8 播放列表改写（P2-01）。
 *
 * 之前 controllers/m3u8-proxy.js 与 controllers/unified-proxy.js 各自实现了一份逐行改写，
 * 只有代理前缀不同。这里统一为一个纯函数：调用方只提供 buildProxyUrl(absoluteUrl)。
 *
 * 行为：
 *   - 空行与普通注释原样保留（去首尾空白）；
 *   - 媒体行（分片/子播放列表）：相对地址按 baseUrl 解析为绝对地址后经 buildProxyUrl 包装；
 *   - 标签属性 URI="..."（如 #EXT-X-KEY、#EXT-X-MAP、#EXT-X-MEDIA）同样改写。
 *     旧实现不改写这些属性，加密 HLS 的密钥地址会直接暴露原始地址且相对路径失效，属于缺陷修复；
 *   - 解析失败时保持原行，不抛错。
 */

const URI_ATTRIBUTE = /URI="([^"]+)"/g;

function toAbsolute(reference, baseUrl) {
    if (/^https?:\/\//i.test(reference)) return reference;
    try {
        return new URL(reference, baseUrl).href;
    } catch {
        return null;
    }
}

/**
 * @param {string} content 原始 m3u8 文本
 * @param {{baseUrl: string, buildProxyUrl: (absoluteUrl: string) => string}} options
 * @returns {string}
 */
export function rewriteM3u8Content(content, { baseUrl, buildProxyUrl }) {
    const lines = String(content ?? '').split('\n');
    return lines.map((raw) => {
        const line = raw.trim();
        if (!line) return line;

        if (line.startsWith('#')) {
            if (!line.includes('URI="')) return line;
            return line.replace(URI_ATTRIBUTE, (match, uri) => {
                const absolute = toAbsolute(uri, baseUrl);
                return absolute ? `URI="${buildProxyUrl(absolute)}"` : match;
            });
        }

        const absolute = toAbsolute(line, baseUrl);
        return absolute ? buildProxyUrl(absolute) : line;
    }).join('\n');
}

/** 常用的代理 URL 构造器：`${proxyBase}${path}?url=<encoded>&auth=<auth>[&headers=<encoded>]` */
export function createProxyUrlBuilder({ proxyBaseUrl, path, authCode, headersParam }) {
    return (absoluteUrl) => {
        let url = `${proxyBaseUrl}${path}?url=${encodeURIComponent(absoluteUrl)}&auth=${authCode}`;
        if (headersParam) {
            url += `&headers=${encodeURIComponent(headersParam)}`;
        }
        return url;
    };
}

export default { rewriteM3u8Content, createProxyUrlBuilder };
