/**
 * HTTP Range 解析（P2-01）。
 *
 * 之前 controllers/mediaProxy.js 的单线程与多线程两条链路各自用 split('-') + parseInt 解析，
 * 且单线程路径没有越界校正，suffix 范围（bytes=-N）会得到 NaN。这里统一为一个纯函数。
 */

/**
 * 解析单段 Range 头。
 * @param {string|undefined} rangeHeader 例如 "bytes=0-", "bytes=0-0", "bytes=-500"
 * @param {number} total 资源总长度（字节）
 * @returns {{start: number, end: number} | null} 可满足的闭区间；不可满足或格式错误返回 null（应答 416）
 */
export function parseRange(rangeHeader, total) {
    if (!Number.isFinite(total) || total <= 0) return null;
    const match = /^bytes=(\d*)-(\d*)$/i.exec(String(rangeHeader || '').trim());
    if (!match) return null;
    const [, startText, endText] = match;

    let start;
    let end;
    if (startText === '') {
        // suffix-range：最后 N 个字节
        const suffix = Number(endText);
        if (!suffix) return null;
        start = Math.max(0, total - suffix);
        end = total - 1;
    } else {
        start = Number(startText);
        end = endText === '' ? total - 1 : Math.min(Number(endText), total - 1);
    }

    // start === end 是合法的单字节 Range（bytes=0-0）；只有越界才不可满足
    if (start > end || start >= total) return null;
    return { start, end };
}

/** 构造 Content-Range 头值。 */
export function contentRange(start, end, total) {
    return `bytes ${start}-${end}/${total}`;
}

export default { parseRange, contentRange };
