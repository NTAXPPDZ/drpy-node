/*
@header({
  searchable: 2,
  filterable: 1,
  quickSearch: 1,
  title: '黑料不打烊[密]',
  '类型': '影视',
  lang: 'ds'
})
*/

// ===== 2026-11-22 解密修复说明 =====
// 本文件原为单行 base64 密文（框架 jsEncoder 的 RSA 分块加密，私钥在 libs_drpy/drpyCustom.js:702）。
// 解密：RSA.decode(base64Body, rsa_private_key) → JSEncrypt.decryptUnicodeLong，原明文 182 行。
// 解密后发现两处已失效，故按现站重写解析层：
//   1) 原 host 'https://laowd.pgvuuxn.cc' 已死，CMS 路径（fyclass/page/fypage、/index/search_article、
//      .slider-content、.video-item、POST 表单搜索）在现站全部 404 —— 站点已换模板，改为
//      /archives/{id}.html + /category/{slug}/ + /search/{kw}/ + /tag/{kw}/。
//   2) 原域名写死，现改为从发布页 https://www.ilnizqaw.cc/ 解析基域 + 造子域 + 并发探活 + 6h 缓存。
// 保留的部分：图片 AES 解密代理（key/iv 与 51吃瓜 同源）、dplayer data-config 取 m3u8 的思路。

// 正文广告/推广词黑名单：站点换文案时只改这里
var AD_WORDS = [
    '黑料不打烊最新地址', '永久：', '国内：', '海外：', '邮箱', '播放异常', '播放器加载',
    '加入交流群', '官方微信', 'APP下载', '免费黄', '免费Ai', '免费AI', 'VPN',
    '该文章由黑料不打烊发布', '转载请注明来源', 'dbdy', 'hl365.com'
];

// 站点没有服务端排序参数（试过 ?sort/?order 全部无效），所以筛选在「一级」里本地做
var FILTER_DEF = [
    {key: 'by', name: '排序', value: [{n: '最新在前', v: ''}, {n: '最早在前', v: 'old'}]},
    {key: 'days', name: '时间', value: [{n: '全部', v: ''}, {n: '今天', v: '1'}, {n: '三天内', v: '3'}, {n: '七天内', v: '7'}, {n: '一个月内', v: '30'}]}
];

// 封面 CDN（pic.biacea.cn）返回的是 AES-128-CBC 密文，不是图片。
// 解密参数藏在 /usr/plugins/ai/common/image.0821.js 的 Worker 里：
//   把 "102_53_100_57_..." 按下划线拆开转字符 = key/iv，CBC + Pkcs7。
// 与 51吃瓜 同一套模板，key/iv 完全一致。客户端不会跑那段 Worker，所以用 proxy_rule 代理解密。
var IMG_KEY = 'f5d965df75336270';
var IMG_IV = '97b60394abc2fbe1';
var IMG_HOST = /^https?:\/\/pic\.biacea\.cn\//i;

function mkPic(u, self) {
    if (!u) return '';
    if (!IMG_HOST.test(u)) return u;
    let pu = '';
    try {
        let g = self && self.getProxyUrl;
        pu = typeof g === 'function' ? g() : ((self && self.proxyUrl) || '');
    } catch (e) { }
    if (!pu) return u;
    let q = pu.split('?');
    return q[0] + '?' + (q[1] ? q[1] + '&' : '') + 'url=' + encodeURIComponent(u);
}

// 域名池：发布页给的是一次性随机子域，但站点是泛解析（任意子域都能进），
// 所以「基域」才是稳定资产，子域随便造。取页失败时换池里其它域名重试。
var HOST_POOL = [];

// 小词表：仅用于造随机子域，不需要和发布页词表一致（泛解析）
var WORDS = ['abandon', 'cabinet', 'ability', 'account', 'advance', 'airport', 'balance',
    'captain', 'central', 'chapter', 'crystal', 'diamond', 'element', 'fortune',
    'gallery', 'harvest', 'journey', 'kingdom', 'liberty', 'machine', 'network'];

function randSub() {
    return WORDS[Math.floor(Math.random() * WORDS.length)] + Math.floor(Math.random() * 900 + 100);
}

async function fetchPage(u, host) {
    let ok = (t) => t && t.length > 2000 && /post-card|post-title|Mirages/.test(t)
        && !/<title>[^<]*(40[0-9]|50[0-9]|Bad Gateway|Not Found|不存在)/i.test(t.slice(0, 3000));
    let html = await request(u, {headers: rule.headers});
    if (ok(html)) return html;

    // 摘出路径，换域名重试（这些域互为镜像）
    let rel = (u.match(/^https?:\/\/[^/]+(\/[\s\S]*)$/) || [])[1];
    if (!rel) return html || '';
    let tries = [host].concat(HOST_POOL);
    let seen = {};
    for (let h of tries) {
        if (!h || seen[h]) continue;
        seen[h] = 1;
        let alt = h.replace(/\/+$/, '') + rel;
        if (alt === u) continue;
        try {
            let h2 = await request(alt, {headers: rule.headers});
            if (ok(h2)) {
                // 命中说明这个域当前更好用，提到池首
                HOST_POOL = [h].concat(HOST_POOL.filter(x => x !== h));
                return h2;
            }
        } catch (e) { }
    }
    return html || '';
}

// 列表/搜索结果统一解析（卡片结构与 51吃瓜 同模板，但标题选择器不同：
// 本站在 <h2 class="post-card-bottom-title"><p class="post-card-bottom-text">标题</p></h2>）
function parseCards(html, host, self) {
    let d = [];
    let strip = (s) => (s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    html.split(/<div class="post-card"/).slice(1).forEach((b) => {
        b = b.slice(0, 4000);                       // 限长，防止跨卡片匹配
        let idm = b.match(/id="(ad-card|post-card)-(\d+)"/);
        if (!idm || idm[1] !== 'post-card') return;  // <article class="ad-item"> 里的卡片无 id，天然被排除
        let id = idm[2];
        let t = strip((b.match(/post-card-bottom-text">([\s\S]*?)<\/p>/) || [])[1]);
        if (!t) t = strip((b.match(/post-card-bottom-title[^>]*>([\s\S]*?)<\/h2>/) || [])[1]);
        if (!t) return;
        // 封面有两种写法：懒加载属性 [xz]-bg-loader-url，或 <meta itemprop="image">
        let pic = (b.match(/[xz]-bg-loader-url="([^"]+)"/) || [])[1]
            || (b.match(/itemprop="image" content="([^"]+)"/) || [])[1] || '';
        let info = strip((b.match(/post-card-info[^>]*>([\s\S]*?)<\/div>/) || [])[1]);
        // 去掉日期前缀，只留分类
        info = info.split('-->').join(' ').split('<!--').join(' ').split('--!>').join(' ').replace(/\s+/g, ' ').trim();
        info = info.replace(/^\d{4}\/\d{1,2}\/\d{1,2}\s*•\s*/, '').trim();
        let dm = b.match(/itemprop="datePublished" content="([^"]+)"/);
        d.push({
            title: t,
            url: host + '/archives/' + id + '.html',
            pic_url: pic ? mkPic(pic, self) : '',
            desc: info.slice(0, 40),
            _ts: dm ? (Date.parse(dm[1]) || 0) : 0
        });
    });
    return d;
}

var rule = {
    title: '黑料不打烊[密]',
    // 兜底域名：发布页全挂时用这个（泛解析，任意子域都能进）
    host: 'https://abandon.pnpdrxiy.cc',
    // 发布页（真实基域从这里取）
    landing: 'https://www.ilnizqaw.cc/',
    headers: {
        'User-Agent': 'PC_UA',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'zh-CN,zh;q=0.9'
    },
    timeout: 20000,
    // 占位：框架要求 searchUrl 非空才会进入「搜索」函数；真实 URL 在函数里自拼
    searchUrl: '/search/**',
    play_parse: true,
    searchable: 2,
    quickSearch: 1,
    filterable: 1,
    filter: {},
    filter_def: {},
    // 分类按站点导航顺序，第一个是首页聚合，最后一个是标签云
    class_name: '首页&今日看料&每日大赛&AI短剧&每日热瓜&黑料大事&热门吃瓜&反差女神&学院热瓜&网红吃瓜&撸友看片&黑料杂谈&探花大全&网黄专辑&明星吃瓜&av解说&原创投稿&性爱技巧&偷拍盗摄&官场秘闻&禁播动漫&PMV混剪&海角乱伦&优选投放&标签云',
    class_url: 'index&24hcg&mrds&swdj&mrrg&hlda&rgtj&fcns&xyrg&whhl&lydt&hlzt&thdq&whzj&mxbg&avjs&qgzq&wyxs&chjlb&gcmw&mrst&pmv&llsq&youxuan&tags',

    // ===== 动态域名：发布页 → 基域 → 造子域 → 并发探活 → 缓存 =====
    hostJs: async function () {
        const CACHE_SLOT = 'host_cache';
        const CACHE_KEY = 'hlbdy_host';
        const TTL = 6 * 3600 * 1000;
        const HIT = /post-card|Mirages|黑料不打烊/i;

        // 1) 缓存命中且仍可用 → 直接返回
        let cached = null;
        try { cached = await local.get(CACHE_SLOT, CACHE_KEY); } catch (e) { }
        if (cached && cached.host && cached.time && (Date.now() - cached.time) < TTL) {
            try {
                let t = await request(cached.host + '/', {timeout: 6000, headers: rule.headers});
                if (HIT.test(t || '')) {
                    HOST_POOL = (cached.pool && cached.pool.length ? cached.pool : [cached.host]).slice();
                    console.log('[黑料不打烊[密]] 命中域名缓存:', cached.host);
                    return cached.host;
                }
            } catch (e) { }
            try { await local.set(CACHE_SLOT, CACHE_KEY, null); } catch (e) { }
        }

        // 2) 拉发布页。入口链接是 JS 拼的（随机单词子域 + 固定基域），静态 HTML 里没有 href，
        //    所以不能像 51吃瓜 那样抓 href，必须从脚本里把「基域」抠出来自己造子域。
        let html = '';
        try {
            html = await request(rule.landing, {timeout: 12000, headers: rule.headers}) || '';
        } catch (e) {
            console.log('[黑料不打烊[密]] 发布页请求失败:', e.message);
        }

        // 2.1 基域：脚本里形如 "//" +words.random() +".pnpdrxiy.cc"
        let bases = [];
        let reBase = /"\s*\+\s*"\.([a-z0-9][a-z0-9-]{2,})\.(cc|com|net|org|top|me)"/gi, bm;
        while ((bm = reBase.exec(html))) {
            let b = (bm[1] + '.' + bm[2]).toLowerCase();
            if (!bases.includes(b)) bases.push(b);
        }
        // 2.2 固定线路四：fixedLineFour = "d27oj78oqxr8p6.cloudfront.net"
        let fixed = '';
        let fm = html.match(/fixedLineFour\s*=\s*"([^"]+)"/);
        if (fm) fixed = 'https://' + fm[1].replace(/^https?:\/\//, '').replace(/\/+$/, '');
        // 2.3 兜底：发布页里出现的本站域名（结构改版时仍能抓到）
        let own = (rule.landing.match(/https?:\/\/([^/]+)/) || [])[1] || '';
        let reAny = /https?:\/\/([a-z0-9.-]+\.(?:cc|com|net|top|me))/gi, am;
        while ((am = reAny.exec(html))) {
            let d = am[1].toLowerCase();
            if (d === own || /google|gstatic|facebook|twitter|cloudflare|cdn|jsdelivr/i.test(d)) continue;
            let base = d.replace(/^[a-z0-9-]+\.(?=[a-z0-9-]+\.[a-z]{2,}$)/i, '');
            if (!bases.includes(base)) bases.push(base);
        }

        // 3) 造候选：每个基域造 2 个子域（泛解析，任意子域都能进），再加固定线路
        let cands = [];
        bases.slice(0, 3).forEach((b) => {
            for (let i = 0; i < 2; i++) cands.push('https://' + randSub() + '.' + b);
        });
        if (fixed) cands.push(fixed);
        cands.push(rule.host);

        // 4) 探活：只探首页不够（有的镜像首页 200 但详情 404），必须连详情页一起验。
        //    必须并发，串行会撑爆框架 20s 初始化超时。
        const okPage = (t) => t && t.length > 2000
            && /post-card|post-title|Mirages/.test(t)
            && !/<title>[^<]*(40[0-9]|50[0-9]|Bad Gateway|Not Found|不存在)/i.test(t.slice(0, 3000));
        const probe = async (u) => {
            u = u.replace(/\/+$/, '');
            let home = '';
            try { home = await request(u + '/', {timeout: 5000, headers: rule.headers}); } catch (e) { return ''; }
            if (!HIT.test(home || '') || home.length < 8000) return '';
            let idm = home.match(/\/archives\/(\d+)\.html/);
            if (idm) {
                let detail = '';
                try { detail = await request(u + '/archives/' + idm[1] + '.html', {timeout: 6000, headers: rule.headers}); } catch (e) { }
                if (!okPage(detail)) return '';
            }
            return u;
        };

        let rs = await Promise.all(cands.map(u => probe(u).catch(() => '')));
        let goods = rs.filter((u, i) => u && rs.indexOf(u) === i).slice(0, 3);
        if (goods.length) {
            HOST_POOL = goods.slice();
            console.log('[黑料不打烊[密]] 动态域名解析成功:', goods[0], '备用:', goods.slice(1).join(',') || '无');
            try { await local.set(CACHE_SLOT, CACHE_KEY, {host: goods[0], pool: goods, time: Date.now()}); } catch (e) { }
            return goods[0];
        }
        console.log('[黑料不打烊[密]] 探活全部失败，退兜底:', rule.host);
        return rule.host;
    },

    // ===== 列表（首页 / 分类 / 标签云）=====
    一级: async function (tid, pg, filter, extend) {
        let {host} = this;
        let self = this;
        pg = parseInt(pg) || 1;
        extend = extend || {};
        let url;
        if (tid === 'index') {
            url = pg === 1 ? host + '/' : host + '/page/' + pg + '/';
        } else if (tid === 'tags') {
            // 标签云：/tags.html 是第 1 页，之后是 /tags/2/
            url = pg === 1 ? host + '/tags.html' : host + '/tags/' + pg + '/';
        } else {
            // 分类：/category/{slug}/ ，翻页是路径段 /category/{slug}/2/（不是 ?page=，也不是 /page/2/）
            url = pg === 1 ? host + '/category/' + tid + '/' : host + '/category/' + tid + '/' + pg + '/';
        }
        let html = await fetchPage(url, host);

        // 标签云页没有视频卡片，全是 <a class="itags" href="/tag/xxx/">名字</a>
        if (tid === 'tags') {
            if (/<title>[^<]*(40[0-9]|50[0-9]|不存在|Bad Gateway)/i.test(html.slice(0, 3000))) {
                return setResult([]);
            }
            let tags = [], seen = {};
            let reTag = /<a[^>]*class="[^"]*itags[^"]*"[^>]*href="(\/tag\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g, tm;
            while ((tm = reTag.exec(html))) {
                let name = tm[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
                if (!name || seen[tm[1]]) continue;
                seen[tm[1]] = 1;
                tags.push({title: name, url: host + tm[1]});
            }
            return setResult(tags);
        }

        let d = parseCards(html, host, self);

        // 本地筛选：站点无服务端排序参数，只能按卡片日期处理
        let days = parseInt(extend.days) || 0;
        if (days > 0) {
            let edge = Date.now() - days * 86400000;
            d = d.filter(it => !it._ts || it._ts >= edge);
        }
        if (extend.by === 'old') {
            d.sort((a, b) => (a._ts || 0) - (b._ts || 0));
        } else if (extend.by === '') {
            d.sort((a, b) => (b._ts || 0) - (a._ts || 0));
        }
        d.forEach(it => { delete it._ts; });
        return setResult(d);
    },

    // ===== 详情 =====
    二级: async function (ids) {
        let {input, host} = this;
        let self = this;
        let html = await fetchPage(input, host);
        let strip = (s) => (s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        let VOD = {};
        VOD.vod_id = input;

        // 标签页（从标签云点进来）：不是详情页，是一批视频的聚合，按「合集」处理
        if (/\/tag\//.test(input)) {
            if (/<title>[^<]*(40[0-9]|50[0-9]|不存在|Bad Gateway)/i.test(html.slice(0, 3000))) {
                VOD.vod_name = '标签不存在';
                VOD.vod_pic = '';
                VOD.vod_play_from = '图文';
                VOD.vod_play_url = '';
                VOD.vod_content = '该标签没有内容';
                return VOD;
            }
            let tn = strip((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1])
                || decodeURIComponent((input.match(/\/tag\/([^/]+)\//) || [])[1] || '');
            VOD.vod_name = '标签：' + tn.replace(/\s*-\s*相关.*$/, '');
            let list = parseCards(html, host, self);
            VOD.vod_pic = (list[0] && list[0].pic_url) || '';
            let eps = list.map(it => it.title.slice(0, 30) + '$' + it.url + '|0');
            if (eps.length) {
                VOD.vod_play_from = '黑料';
                VOD.vod_play_url = eps.join('#');
                VOD.vod_remarks = '标签' + eps.length + '条';
                VOD.vod_content = '标签「' + tn + '」下的 ' + eps.length + ' 条内容（第 1 页）';
            } else {
                VOD.vod_play_from = '图文';
                VOD.vod_play_url = '';
                VOD.vod_content = '该标签暂无内容';
            }
            return VOD;
        }

        VOD.vod_name = strip((html.match(/<h1 class="post-title[^"]*"[^>]*>([\s\S]*?)<\/h1>/) || [])[1]);
        if (!VOD.vod_name) VOD.vod_name = (html.match(/<meta itemprop="headline" content="([^"]*)"/) || [])[1] || '';
        VOD.vod_pic = (html.match(/<meta itemprop="image" content="([^"]*)"/) || [])[1]
            || (html.match(/<meta property="og:image" content="([^"]*)"/) || [])[1]
            || (html.match(/<div class="blog-background"[^>]*[xz]-bg-loader-url="([^"]+)"/) || [])[1]
            || '';
        VOD.vod_pic = mkPic(VOD.vod_pic, self);
        let meta = (html.match(/<ul class="post-meta">([\s\S]*?)<\/ul>/) || [])[1] || '';
        VOD.vod_actor = strip((meta.match(/<a href="\/author\/[^"]*">([\s\S]*?)<\/a>/) || [])[1]);
        VOD.vod_pubdate = strip((meta.match(/<time>([\s\S]*?)<\/time>/) || [])[1]);
        VOD.type_name = strip((meta.match(/<a href="\/category\/[^"]*">([\s\S]*?)<\/a>/) || [])[1]);

        // 正文：从 itemprop="articleBody" 起，切到 <div class="tags"> 或 post-near。
        // 本站没有 51吃瓜 的 post-actions 边界，必须换终止标记，否则会把相关推荐一起吞进来。
        let body = '';
        let bi = html.indexOf('itemprop="articleBody"');
        if (bi >= 0) {
            let rest = html.slice(bi);
            let cut = rest.length;
            ['<div class="tags">', 'class="post-near"', '<div class="post-actions"'].forEach((e) => {
                let j = rest.indexOf(e);
                if (j > 0 && j < cut) cut = j;
            });
            body = rest.slice(0, cut);
        }
        let paras = (body.match(/<p[^>]*>[\s\S]*?<\/p>/g) || [])
            .map(s => strip(s))
            .filter(s => s && !AD_WORDS.some(w => s.includes(w)));
        VOD.vod_content = paras.join('\n').slice(0, 800) ||
            (html.match(/<meta name="description" content="([^"]*)"/) || [])[1] || '';

        // 标签：详情页 <div class="tags"> 里
        let tagBlk = (html.match(/<div class="tags">([\s\S]*?)<\/div>/) || [])[1] || '';
        let tagNames = [];
        let reT = /<a[^>]*href="\/tag\/[^"]*"[^>]*>([\s\S]*?)<\/a>/g, tmm;
        while ((tmm = reT.exec(tagBlk))) {
            let n = strip(tmm[1]);
            if (n && !tagNames.includes(n)) tagNames.push(n);
        }
        if (tagNames.length) {
            VOD.vod_tag = tagNames.join(',');
            VOD.vod_content = (VOD.vod_content + '\n标签：' + tagNames.map(n => '#' + n).join(' ')).slice(0, 900);
        }

        // 播放列表：三种页面形态（实测本站都有）
        //   A. 单视频页：1 个 <div class="dplayer defplay">
        //   B. 多视频页：N 个 dplayer，各带 data-video_title
        //   C. 合集页  ：0 个 dplayer，正文 <p> 里列着若干 /archives/{id}.html 子帖链接
        // 集地址统一带 |索引 后缀（合集页的子帖也带 |0，lazy 只留一条取参路径）
        let dblocks = html.split(/<div class="dplayer/).slice(1);
        let eps = [];
        if (dblocks.length) {
            dblocks.forEach((b, i) => {
                b = b.slice(0, 6000);                    // 限长，防止串到下一个播放器
                let t = strip((b.match(/data-video_title="([^"]*)"/) || [])[1]);
                if (!t) t = dblocks.length > 1 ? '第' + (i + 1) + '集' : '正片';
                eps.push(t.slice(0, 30) + '$' + input + '|' + i);
            });
        } else {
            // C. 合集页：子帖标题就是 <a> 的文字
            let seen = {}, kids = [];
            (body.match(/<p[^>]*>[\s\S]*?<\/p>/g) || []).forEach((p) => {
                let lm = p.match(/href="\/archives\/(\d+)\.html"/);
                if (!lm || seen[lm[1]]) return;
                seen[lm[1]] = 1;
                let t = strip(p)
                    .replace(/[｜|]?\s*点击查看详情\s*[→»]*\s*$/, '')
                    .replace(/^[\s👉→▶]+/, '')
                    .trim();
                kids.push({id: lm[1], title: t || ('第' + (kids.length + 1) + '部')});
            });
            kids = kids.slice(0, 20);
            kids.forEach((k) => {
                eps.push(k.title.slice(0, 30) + '$' + host + '/archives/' + k.id + '.html|0');
            });
        }

        if (eps.length) {
            VOD.vod_play_from = '黑料';
            VOD.vod_play_url = eps.join('#');
            if (dblocks.length > 1) VOD.vod_remarks = '共' + dblocks.length + '段';
            else if (!dblocks.length) VOD.vod_remarks = '合集' + eps.length + '集';
        } else {
            VOD.vod_play_from = '图文';   // 纯图文页：给个非空线路名，避免客户端崩
            VOD.vod_play_url = '';
        }
        return VOD;
    },

    // ===== 搜索 =====
    搜索: async function (wd, quick, pg) {
        let {host} = this;
        let self = this;
        pg = parseInt(pg) || 1;
        // 以 # 开头 → 按标签搜（/tag/{kw}/），否则走站内搜索（/search/{kw}/）
        let byTag = /^[#＃]/.test(wd || '');
        let kw = byTag ? wd.replace(/^[#＃]\s*/, '') : wd;
        let base = byTag ? host + '/tag/' : host + '/search/';
        let url = base + encodeURIComponent(kw) + '/' + (pg > 1 ? pg + '/' : '');
        let html = await fetchPage(url, host);
        return setResult(parseCards(html, host, self));
    },

    // ===== 播放：从详情页 dplayer 的 data-config 取 m3u8 =====
    // 本站 data-config 只有 video.url（无 video_h265），所以单线路即可；
    // 若哪天出现 video_h265，自动切成双线路。
    lazy: async function (flag, id, flags) {
        let {host} = this;
        let idx = 0;
        let mi = id.match(/^(.*)\|(\d+)$/);
        if (mi) {
            id = mi[1];
            idx = parseInt(mi[2]) || 0;
        }
        let html = await fetchPage(id, host);

        let blocks = html.split(/<div class="dplayer/).slice(1);
        let target = null;
        if (blocks.length) {
            target = blocks[Math.min(idx, blocks.length - 1)];   // 越界回退最后一个，别返回空
        }
        let cfg = null;
        let parseCfg = (raw) => {
            if (!raw) return null;
            raw = raw.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
            try { return JSON.parse(raw); } catch (e) { return null; }
        };
        if (target) {
            let mc = target.match(/data-config='([\s\S]*?)'/) || target.match(/data-config="([\s\S]*?)"/);
            cfg = parseCfg(mc && mc[1]);
        }
        if (!cfg) {
            // 兜底：整页第一个 data-config
            let m = html.match(/\{\s*"live"[\s\S]*?\}\s*'/);
            if (m) cfg = parseCfg(m[0].replace(/'\s*$/, ''));
        }
        if (cfg && cfg.video && cfg.video.url) {
            let url = String(cfg.video.url).replace(/\\\//g, '/');
            let h265 = (cfg.video_h265 && cfg.video_h265.url) ? String(cfg.video_h265.url).replace(/\\\//g, '/') : '';
            if (h265) {
                let pick = /265/i.test(flag || '') ? h265 : url;
                return {parse: 0, url: pick, header: {'User-Agent': 'PC_UA'}};
            }
            return {parse: 0, url: url, header: {'User-Agent': 'PC_UA'}};
        }
        // 兜底：整页正则找 m3u8
        let mm2 = html.match(/https?:\\?\/\\?\/[^"'\s]+\.m3u8[^"'\s]*/);
        if (mm2) return {parse: 0, url: mm2[0].replace(/\\\//g, '/')};
        return {parse: 1, url: id};
    },

    // ===== 封面解密代理 =====
    // 客户端请求 /proxy/黑料不打烊/?url=<加密图URL>，这里取密文 → AES 解密 → 吐真图。
    // 返回 [状态码, MIME, base64内容, 额外响应头, toBytes=1]
    proxy_rule: async function (params) {
        let u = (params && params.url) || this.input || '';
        if (!u || !/^https?:\/\//i.test(u)) {
            return [400, 'text/plain', 'bad url'];
        }
        // 只代理解密本站图片 CDN，其它地址一律拒绝，避免变成开放代理
        if (!IMG_HOST.test(u)) {
            return [403, 'text/plain', 'host not allowed'];
        }
        let ext = (u.match(/\.(jpe?g|png|gif|webp)(?:$|\?)/i) || [])[1] || 'jpeg';
        let mime = 'image/' + (ext.toLowerCase() === 'jpg' ? 'jpeg' : ext.toLowerCase());

        try {
            let resp = await request(u, {
                headers: Object.assign({}, rule.headers, {Referer: 'https://' + ((u.match(/^https?:\/\/([^/]+)/) || [])[1] || '') + '/'}),
                buffer: 2,
                timeout: 15000
            });
            let b64 = '';
            if (typeof resp === 'string') {
                b64 = resp;
            } else if (resp && resp.content) {
                if (resp.code && resp.code !== 200) {
                    return [502, 'text/plain', 'upstream ' + resp.code];
                }
                b64 = resp.content;
            }
            if (!b64 || b64.length < 100) {
                return [502, 'text/plain', 'upstream empty'];
            }
            let plain = aesX('AES/CBC/PKCS7Padding', false, b64, true, IMG_KEY, IMG_IV, true);
            if (!plain) return [500, 'text/plain', 'decrypt failed'];
            return [200, mime, plain, {'Cache-Control': 'public, max-age=86400'}, 1];
        } catch (e) {
            return [500, 'text/plain', 'proxy error: ' + e.message];
        }
    }
};

// 所有分类共用同一套筛选（站点无服务端排序参数，全部在「一级」里本地处理）
rule.class_url.split('&').forEach(function (tid) {
    rule.filter[tid] = FILTER_DEF;
    rule.filter_def[tid] = {by: '', days: ''};
});
