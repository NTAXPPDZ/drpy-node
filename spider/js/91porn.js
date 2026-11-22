/*
@header({
  searchable: 2,
  filterable: 0,
  quickSearch: 1,
  title: '91PORNY',
  '类型': '影视',
  lang: 'ds'
})
*/

// 91porny 站内三个视频板块结构一致，只是详情路径不同：
//   /video  → /video/view/<hex>  与 /video/viewhd/<hex>   封面在 div.img 的 background-image
//   /videos → /videos/view/<id>/<slug>                    视频多为 mp4 直链
//   /vod    → /vod/view/<短码>                             精品区，m3u8 带 t/m 查询
// 三级页面统一从 <video id="video-play" data-src="..."> 取播放地址，data-src 可能是
// 协议相对地址（//cdn2.jiuse2.cloud/...），需要补 https:。

var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// HTML 里常混着广告卡：href 指向站外（http 开头且非本域名）或 /vod/view/<短码> 的推广位，
// 这里只认站内三种详情路径
var CARD_RE = /^\/(?:video\/(?:view|viewhd)|videos\/view|vod\/view)\//;

function strip(s) {
    return String(s == null ? '' : s)
        .replace(/<[^>]+>/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function absUrl(u) {
    if (!u) return '';
    u = String(u).trim().replace(/&amp;/g, '&');
    if (u.indexOf('//') === 0) return 'https:' + u;
    if (/^https?:\/\//i.test(u)) return u;
    if (u.charAt(0) === '/') return 'https://91porny.com' + u;
    return u;
}

// 列表页统一解析：所有板块的卡片都是 <div class="colVideoList"> 里套一个 .video-elem
function parseList(html) {
    var out = [];
    var blocks = String(html || '').split(/<div class="colVideoList"/).slice(1);
    blocks.forEach(function (b) {
        b = b.slice(0, 3000); // 限长，避免跨卡片匹配到别人的标题
        var am = b.match(/<a[^>]+class="display[^"]*"[^>]+href="([^"]+)"[^>]*>/) ||
            b.match(/<a[^>]+href="([^"]+)"[^>]*class="display/);
        if (!am) return;
        var href = am[1];
        if (!CARD_RE.test(href)) return; // 站外广告卡直接丢
        var tm = b.match(/<a[^>]+class="title[^"]*"[^>]*>([\s\S]*?)<\/a>/) ||
            b.match(/<a[^>]+title="([^"]*)"[^>]*>/);
        var title = strip(tm && tm[1]);
        if (!title) return;
        var pic = (b.match(/background-image:\s*url\(['"]?([^'")]+)/) || [])[1] ||
            (b.match(/<img[^>]+class="img[^"]*"[^>]+src="([^"]+)"/) || [])[1] ||
            (b.match(/<img[^>]+src="([^"]+)"/) || [])[1] || '';
        var dur = strip((b.match(/<small[^>]*class="layer"[^>]*>([\s\S]*?)<\/small>/) || [])[1]);
        // 作者/日期/播放量都在 text-muted 里，可能被拆成多个内联标签，取整段再压空格
        var meta = strip((b.match(/<div[^>]+class="text-muted[^"]*"[^>]*>([\s\S]*?)<\/div>/) || [])[1]);
        out.push({
            title: title,
            url: absUrl(href),
            pic_url: absUrl(pic),
            desc: [meta, dur].filter(Boolean).join(' ').slice(0, 80)
        });
    });
    return out;
}

var rule = {
    title: '91PORNY',
    host: 'https://91porny.com',
    headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'zh-CN,zh;q=0.9'
    },
    timeout: 25000,
    // 框架要求 searchUrl 非空才会进入「搜索」函数，真实 URL 在函数里自拼
    searchUrl: '/search?keywords=**&page=fypage',
    play_parse: true,
    searchable: 2,
    quickSearch: 1,
    filterable: 0,
    // 站方没有排序/筛选参数（?sort / ?orderby 实测无效），所以不做筛选
    class_name: '视频&蝌蚪&精品',
    class_url: 'video&videos&vod',

    一级: async function (tid, pg, extend) {
        var page = parseInt(pg) || 1;
        var base = rule.host + '/' + tid;
        // 首页第 1 页就是 /video，第 2 页起 /video?page=N（实测分页有效，内容不同）
        var url = page > 1 ? base + '?page=' + page : base;
        var html = await request(url, {headers: rule.headers, timeout: rule.timeout});
        var list = parseList(html);
        if (page > 1 && !list.length) {
            // 少数板块用 /video/page/2 这种路径式分页，兜底再试一次
            html = await request(base + '/page/' + page, {headers: rule.headers, timeout: rule.timeout});
            list = parseList(html);
        }
        return list;
    },

    二级: async function (ids) {
        var input = ids[0];
        var html = await request(input, {headers: rule.headers, timeout: rule.timeout});

        var VOD = {vod_id: input, vod_name: input, vod_pic: '', vod_content: '', vod_remarks: ''};

        var t = html.match(/<h4[^>]*container-title[^>]*>([\s\S]*?)<\/h4>/);
        if (t) VOD.vod_name = strip(t[1]);
        if (!VOD.vod_name) {
            var og = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]*)"/);
            if (og) VOD.vod_name = strip(og[1]);
        }
        if (!VOD.vod_name) {
            var tt = html.match(/<title>([\s\S]*?)<\/title>/);
            if (tt) VOD.vod_name = strip(tt[1]).split('|')[0].split('-')[0].trim();
        }

        // 播放源：<video id="video-play" data-src="...">，m3u8 或 mp4
        var src = '';
        var vt = html.match(/<video[^>]*id="video-play"[^>]*>/);
        if (vt) {
            var s = vt[0].match(/data-src="([^"]+)"/);
            if (s) src = s[1].replace(/&amp;/g, '&');
        }
        if (!src) {
            var s2 = html.match(/<source[^>]+src="([^"]+)"/);
            if (s2) src = s2[1].replace(/&amp;/g, '&');
        }
        if (!src) {
            var s3 = html.match(/(?:var\s+)?(?:video_url|videoUrl|url)\s*[:=]\s*['"](https?:\/\/[^'"]+\.(?:m3u8|mp4)[^'"]*)['"]/);
            if (s3) src = s3[1];
        }
        src = absUrl(src);

        // 封面 + 作者 + 日期
        var poster = (html.match(/data-poster="([^"]+)"/) || [])[1] || '';
        if (!poster) poster = (html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]*)"/) || [])[1] || '';
        VOD.vod_pic = absUrl(poster);

        var author = strip((html.match(/作者[:：]\s*<a[^>]*>([\s\S]*?)<\/a>/) || [])[1]) ||
            strip((html.match(/作者[:：]([^<\n]{1,40})/) || [])[1]);
        var date = (html.match(/<a[^>]*class="text-dark"[^>]*>[^<]*<\/a>[\s\S]{0,80}?(\d{4}-\d{2}-\d{2})/) || [])[1] ||
            (html.match(/(\d{4}-\d{2}-\d{2})/) || [])[1] || '';
        var views = strip((html.match(/([\d,\.]+\s*次播放)/) || [])[1]);
        VOD.vod_remarks = [author ? '作者:' + author : '', date, views].filter(Boolean).join(' ');
        VOD.vod_year = date.slice(0, 4);

        if (src) {
            VOD.vod_play_from = '91';
            VOD.vod_play_url = '正片$' + src;
        } else {
            // 没有 video 标签（付费/失效/需要登录）时给个非空线路，避免客户端崩
            VOD.vod_play_from = '页面';
            VOD.vod_play_url = '';
        }

        var desc = strip((html.match(/<meta[^>]+name="description"[^>]+content="([^"]*)"/) || [])[1]);
        VOD.vod_content = (desc + '\n' + (src ? '播放地址: ' + src : '')).slice(0, 500);
        return VOD;
    },

    搜索: async function (wd, quick, pg) {
        var page = parseInt(pg) || 1;
        var url = rule.host + '/search?keywords=' + encodeURIComponent(wd) + (page > 1 ? '&page=' + page : '');
        var html = await request(url, {headers: rule.headers, timeout: rule.timeout});
        return parseList(html);
    },

    lazy: async function (flag, id, flags) {
        // 二级已给出直链，这里只做协议/转义兜底
        var url = String(id || '').replace(/&amp;/g, '&').trim();
        if (/^(https?:)?\/\//i.test(url)) {
            if (url.indexOf('//') === 0) url = 'https:' + url;
            return {parse: 0, url: url, header: {'User-Agent': UA, 'Referer': 'https://91porny.com/'}};
        }
        return {parse: 1, url: url};
    }
};
