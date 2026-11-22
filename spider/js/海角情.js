/*
@header({
  searchable: 2,
  filterable: 0,
  quickSearch: 1,
  title: '海角情',
  '类型': '影视',
  lang: 'ds'
})
*/

// 海角情（WordPress + Astra + Elementor 的采集站）
//   分类：/zjgx /hjmz /hjjd /hjfn /hjsz /hjwf /origin /hjsets
//   列表：/{tid}                  第 1 页（带尾斜杠会 301，必须不带）
//         /{tid}/page/{n}         第 n 页（不是 /{tid}/{n}，那是同第一页）
//   搜索：/search/{kw}/           翻页 /search/{kw}/page/{n}/
//   详情：/hjmz/131642.html
//   播放：详情页里一段一个 <iframe src="https://player.abyssplayer.com/{code}">，
//         该播放器是自研加密流（core.bundle.js 解密 media 后拼分片），
//         且脚本里有硬校验：只要不是 iframe 内嵌（top!=self）且域名不是
//         localhost / *.abyss.to / *.trycloudflare.com，就报「What are you doing here?」。
//         所以本源不去逆它的解密链，直接把播放页交给客户端嗅探 —— 客户端 WebView
//         加载详情页时播放器处在 iframe 里，校验通过；同时给一条「播放器直链」线路备用。

var HOST = 'https://www.haijiaolove.xyz';
var PLAYER = 'https://player.abyssplayer.com/';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// 正文/简介里的推广词，站点换文案只改这里
var AD_WORDS = [
    '海角社区最新地址', '永久地址', '发布页', '加入我们', '商务合作',
    'Telegram', 'telegram', 'tg群', 'QQ群', '微信', 'APP下载', 'APP 下载',
    '本站不存储', '免责声明', '广告', '点击下载', '充值', '会员'
];

function strip(s) {
    return String(s == null ? '' : s)
        .replace(/<[^>]+>/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&#8211;/g, '-')
        .replace(/&#8212;/g, '-')
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
    if (u.charAt(0) === '/') return HOST + u;
    return u;
}

// 列表卡片：<div class="pt-cv-content-item pt-cv-1-col" data-pid="131642">…
// 封面是 lazy 的 data-cvpsrc（真实图），src 只是占位图，别取错
function parseList(html) {
    var out = [];
    var blocks = String(html || '').split(/pt-cv-content-item/).slice(1);
    blocks.forEach(function (b) {
        b = b.slice(0, 5000);
        var am = b.match(/<a[^>]+href="(https?:\/\/[^"]+?\.html)"[^>]*>([\s\S]{0,300}?)<\/a>/);
        if (!am) return;
        var url = am[1];
        if (!/\.html$/.test(url)) return;
        var title = strip(am[2]);
        if (!title) title = strip((b.match(/<h4[^>]*pt-cv-title[^>]*>([\s\S]*?)<\/h4>/) || [])[1]);
        if (!title) return;
        var pic = (b.match(/data-cvpsrc="([^"]+)"/) || [])[1] ||
            (b.match(/<img[^>]+src="([^"]+)"/) || [])[1] || '';
        // 分类 slug：pt-cv-tax-hjmz / pt-cv-tax-hjjd …
        var cat = (b.match(/pt-cv-tax-([a-z0-9]+)/) || [])[1] || '';
        // 自定义字段里是「作者/日期/时长」之类的附加信息
        var extra = strip((b.match(/pt-cv-ctf-value[^>]*>([\s\S]*?)<\//) || [])[1]);
        out.push({
            title: title,
            url: url,
            pic_url: absUrl(pic),
            desc: [cat, extra].filter(Boolean).join(' ').slice(0, 80)
        });
    });
    return out;
}

var rule = {
    title: '海角情',
    host: HOST,
    headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'zh-CN,zh;q=0.9'
    },
    timeout: 30000,
    searchUrl: '/search/**/',
    play_parse: true,
    searchable: 2,
    quickSearch: 1,
    filterable: 0,
    class_name: '最近更新&海角母子&海角姐弟&海角父女&海角嫂子&海角人妻&海角原创&海角合集',
    class_url: 'zjgx&hjmz&hjjd&hjfn&hjsz&hjwf&origin&hjsets',

    一级: async function (tid, pg, extend) {
        var page = parseInt(pg) || 1;
        var url = page > 1 ? HOST + '/' + tid + '/page/' + page : HOST + '/' + tid;
        var html = await request(url, {headers: rule.headers, timeout: rule.timeout});
        return parseList(html);
    },

    二级: async function (ids) {
        var input = ids[0];
        var html = await request(input, {headers: rule.headers, timeout: rule.timeout});

        var VOD = {vod_id: input, vod_name: input, vod_pic: '', vod_content: '', vod_remarks: ''};

        var t = html.match(/<h1[^>]*entry-title[^>]*>([\s\S]*?)<\/h1>/);
        if (t) VOD.vod_name = strip(t[1]);
        if (!VOD.vod_name) {
            var og = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]*)"/);
            if (og) VOD.vod_name = strip(og[1]).replace(/\s*[-|–].*$/, '');
        }

        // 封面：wp-post-image 的 img 标签里属性顺序不固定，先整标签再取 src
        var imgTag = html.match(/<img[^>]+wp-post-image[^>]*>/);
        var pic = '';
        if (imgTag) {
            var ps = imgTag[0].match(/src="([^"]+)"/);
            if (ps) pic = ps[1];
        }
        if (!pic) {
            var big = html.match(/<img[^>]+attachment-large[^>]*>/);
            if (big) { var b2 = big[0].match(/src="([^"]+)"/); if (b2) pic = b2[1]; }
        }
        if (!pic) pic = (html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]*)"/) || [])[1] || '';
        VOD.vod_pic = absUrl(pic);

        // 分类（article class 里带 category-hjmz）
        var catM = html.match(/<article[^>]*class="[^"]*category-([a-z0-9]+)/);
        var cat = catM ? catM[1] : (html.match(/rel="category tag"[^>]*>([\s\S]*?)<\/a>/) || [])[1];

        // 播放器：一段一个 iframe，code 在路径里
        var ifrTags = html.match(/<iframe[^>]+src="[^"]*player\.abyssplayer\.com\/[^"]+"/g) || [];
        var codes = [];
        ifrTags.forEach(function (tag) {
            var m = tag.match(/player\.abyssplayer\.com\/([A-Za-z0-9_\-]+)/);
            if (m && codes.indexOf(m[1]) === -1) codes.push(m[1]);
        });

        if (codes.length) {
            var epsPlayer = [];
            var epsPage = [];
            codes.forEach(function (code, i) {
                var name = '第' + (i + 1) + '段';
                epsPlayer.push(name + '$' + PLAYER + code);
                // 嗅探线路：同一个播放页，但以详情页为入口（播放器在 iframe 里才通过校验）
                epsPage.push(name + '$' + input);
            });
            VOD.vod_play_from = '海角播放器$$$海角嗅探';
            VOD.vod_play_url = epsPlayer.join('#') + '$$$' + epsPage.join('#');
            VOD.vod_remarks = '共' + codes.length + '段';
        } else {
            VOD.vod_play_from = '页面';
            VOD.vod_play_url = '';
            VOD.vod_remarks = '无播放器';
        }

        // 正文：详情页是 Elementor 拼的，正文段落没有 <p> 包裹（整段是 div/span 直排文字），
        // 所以从 itemprop="text" 处截一段，剥标签成纯文本，再按词过滤广告/目录噪声
        var content = '';
        var ti = html.indexOf('itemprop="text"');
        if (ti > -1) {
            var seg = html.slice(ti, ti + 20000)
                .replace(/<script[\s\S]*?<\/script>/g, ' ')
                .replace(/<style[\s\S]*?<\/style>/g, ' ');
            content = strip(seg);
            // 砍掉 Elementor 目录块的开场白
            content = content
                .replace(/^itemprop="text"\s*>?\s*/, '')
                .replace(/Add a header to begin generating the table of contents/gi, ' ')
                .replace(/Scroll to Top/gi, ' ')
                .replace(/\s+/g, ' ')
                .trim();
            for (var ai = 0; ai < AD_WORDS.length; ai++) {
                content = content.split(AD_WORDS[ai]).join(' ');
            }
        }
        if (!content || content.length < 10) {
            content = strip((html.match(/<meta[^>]+name="description"[^>]+content="([^"]*)"/) || [])[1]);
        }
        VOD.vod_content = content.slice(0, 800) + (codes.length ? '\n\n播放器: ' + PLAYER + codes[0] : '');
        if (cat) VOD.vod_remarks = (VOD.vod_remarks ? VOD.vod_remarks + ' ' : '') + cat;
        return VOD;
    },

    搜索: async function (wd, quick, pg) {
        var page = parseInt(pg) || 1;
        var url = HOST + '/search/' + encodeURIComponent(wd) + '/' + (page > 1 ? 'page/' + page + '/' : '');
        var html = await request(url, {headers: rule.headers, timeout: rule.timeout});
        var list = parseList(html);
        if (list.length) return list;

        // 搜索结果是 astra 归档卡片（不是 pt-cv 卡片），结构完全不同，单独解析
        var out = [];
        var blocks = String(html || '').split(/<article[^>]+class="[^"]*post-\d+/).slice(1);
        blocks.forEach(function (b) {
            b = b.slice(0, 4000);
            var am = b.match(/<h2[^>]*entry-title[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
            if (!am) return;
            var img = b.match(/<img[^>]+src="([^"]+)"/);
            out.push({
                title: strip(am[2]),
                url: absUrl(am[1]),
                pic_url: absUrl(img && img[1]),
                desc: strip((b.match(/rel="category tag"[^>]*>([\s\S]*?)<\/a>/) || [])[1])
            });
        });
        return out;
    },

    lazy: async function (flag, id, flags) {
        // 两条线路都交给客户端 WebView 嗅探：
        //   「海角播放器」= 直接开播放页（客户端若用 iframe 包裹就能通过 hostname 校验）
        //   「海角嗅探」  = 开详情页（页面里 10 个 iframe，播放器必然处在 top!=self 状态）
        var url = String(id || '').trim();
        if (!/^https?:\/\//i.test(url)) url = absUrl(url);
        return {
            parse: 1,
            url: url,
            header: {'User-Agent': UA, 'Referer': HOST + '/'}
        };
    }
};
