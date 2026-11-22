/*
@header({
  searchable: 2,
  filterable: 1,
  quickSearch: 1,
  title: '51吃瓜',
  '类型': '影视',
  lang: 'ds'
})
*/

// 正文广告/推广词黑名单：站点换文案时只改这里
var AD_WORDS = [
    '51吃瓜最新地址', '邮箱', '永久：', '播放异常', '播放器加载',
    '加入交流群', '官方微信', 'APP下载', '免费黄', '免费Ai', '免费AI',
    '破解19岁', '麻豆短剧', '黄瓜短剧', '51选妃', 'VPN'
];

// 筛选：站点没有服务端排序参数（?sort/?order 实测全部无效），
// 所以这里只做「本地筛选」——按卡片里的 datePublished 排序/过滤，不伪造不存在的接口
var FILTER_DEF = [
    {key: 'by', name: '排序', value: [{n: '最新在前', v: ''}, {n: '最早在前', v: 'old'}]},
    {key: 'days', name: '时间', value: [{n: '全部', v: ''}, {n: '今天', v: '1'}, {n: '三天内', v: '3'}, {n: '七天内', v: '7'}, {n: '一个月内', v: '30'}]}
];

// 标签云单独一套筛选：一页 300 个标签，客户端列表一次塞 300 项又长又慢，
// 而站点 /tags.html 本身就是按热度排的（前几个是 51吃瓜/吃瓜/黑料…），
// 所以默认只取前 60 个（≈ 热门标签），想翻冷门标签再切到全部。
var FILTER_TAG = [
    {key: 'limit', name: '数量', value: [{n: '60个', v: '60'}, {n: '150个', v: '150'}, {n: '300个', v: '300'}, {n: '全部', v: ''}]}
];

// 封面 CDN（pic.mmgbaa.cn）返回的不是图片，而是 AES-128-CBC 加密后的二进制：
// 站点前端 image.20261030.min.js 里有个 Worker，取到 blob 后转 dataURL，
// 再用 CryptoJS.AES.decrypt(b64, key, {iv, CBC, Pkcs7}) 解密才得到真图。
// key/iv 就是把那串 "102_53_100_..." 按下划线拆开转字符得来的。
// 客户端不会跑那段 Worker，所以这里用 proxy_rule 代理解密，直接吐真图。
var IMG_KEY = 'f5d965df75336270';
var IMG_IV = '97b60394abc2fbe1';
var IMG_HOST = /^https?:\/\/pic\.mmgbaa\.cn\//i;

// 把封面地址换成「本机代理地址」，客户端拿到的是解密后的真图。
// 拿不到代理地址时退回原图，至少不会是空字符串。
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

// 站点域名几乎每天换一批，而且不同路径可能落在不同域名上：
// 实测 hpdkrzjv.rdajyube.cc 的首页还是 200，但 /archives/xxx/ 会 301 到一个已失效的
// jegajbgg 镜像（404/502），而发布页新给的 auytnoh.jegajbgg.cc 反而是全路径可用。
// 所以 hostJs 把探活过的候选存进 HOST_POOL，取页失败时把路径换到池里其它域名再试。
var HOST_POOL = [];

async function fetchPage(u, host) {
    // itags 是 /tags.html 标签云页的特征，那页没有 post-card，单独放行
    let ok = (t) => t && t.length > 2000 && /post-card|post-content|post-title|itags/.test(t)
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
                // 命中说明这个域当前更好用，提到池首，后续请求少走弯路
                HOST_POOL = [h].concat(HOST_POOL.filter(x => x !== h));
                return h2;
            }
        } catch (e) { }
    }
    return html || '';
}

var rule = {
    title: '51吃瓜',
    // 兜底域名：发布页全挂时用这个
    host: 'https://arrive.tfodzhdjc.cc',
    // 发布页（真实域名从这里动态取）
    landing: 'https://www.nqvudlbn.cc/',
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
    // 分类：站点导航顺序，去掉「往期活动」（内容太旧，用户要求不要），
    // 末尾「标签云」是本源自己加的入口 —— 点进去是标签索引，再点进标签看该标签下的内容。
    class_name: '首页&今日吃瓜&AI短剧&每日大赛&网黄合集&吃瓜榜单&瓜友点播&热门大瓜&必看大瓜&成人视频&伦理道德&国产视频&探花精选&学生校园&网红黑料&骚男骚女&明星爆料&海外吃瓜&人人吃瓜&领导干部&软萌甜妹&竞技吃瓜&吃瓜看戏&擦边撩骚&性爱技巧&吃瓜新闻&51原创短剧&原创博主&标签云',
    class_url: 'index&wpcz&cbdj&mrds&whhj&mrdg&qghj&rdsj&bkdg&ysyl&lldd&gcjq&thjx&xsxy&whhl&snsn&whmx&hwcg&rrcg&ldcg&jpll&sjb&qubk&dcbq&zzs&cgxw&51djc&yczq&tags',

    // ===== 动态域名：发布页 → 候选 → 探活 → 缓存 =====
    hostJs: async function () {
        const CACHE_SLOT = 'host_cache';
        const CACHE_KEY = '51cg_host';
        const TTL = 6 * 3600 * 1000; // 6 小时内直接复用缓存
        const HIT = /post-card|Mirages|51cg/i;

        // 1) 缓存命中且仍可用 → 直接返回
        let cached = null;
        try { cached = await local.get(CACHE_SLOT, CACHE_KEY); } catch (e) { }
        if (cached && cached.host && cached.time && (Date.now() - cached.time) < TTL) {
            try {
                let t = await request(cached.host + '/', {timeout: 6000, headers: rule.headers});
                if (HIT.test(t || '')) {
                    HOST_POOL = (cached.pool && cached.pool.length ? cached.pool : [cached.host]).slice();
                    console.log('[51吃瓜] 命中域名缓存:', cached.host, '池:', HOST_POOL.length);
                    return cached.host;
                }
            } catch (e) { }
            try { await local.set(CACHE_SLOT, CACHE_KEY, null); } catch (e) { }
        }

        // 2) 拉发布页，收集候选域名
        let html = '';
        try {
            html = await request(rule.landing, {timeout: 12000, headers: rule.headers}) || '';
        } catch (e) {
            console.log('[51吃瓜] 发布页请求失败:', e.message);
        }

        let cands = [];
        const push = (u) => {
            if (!u) return;
            u = String(u).trim().replace(/\/+$/, '');
            if (!/^https?:\/\/[a-z0-9.-]+\.[a-z]{2,}/i.test(u)) return;
            // 排掉统计/广告/跳转页
            if (/google|gstatic|facebook|twitter|doubleclick|googletagmanager|ads\.|zjcdn/i.test(u)) return;
            if (!cands.includes(u)) cands.push(u);
        };

        // 2.1 静态入口：data-entry-key="latest/main/backup"
        let reEntry = /data-entry-key="(latest|backup|main)"[^>]*href="(https?:\/\/[^"]+)"/g, m;
        while ((m = reEntry.exec(html))) push(m[2]);
        // 2.2 兜底：所有 <li> 里的外链（发布页列表结构变化时仍能抓到）
        let reHref = /href="(https?:\/\/[a-z0-9.-]+\.[a-z]{2,}\/?)"/gi;
        while ((m = reHref.exec(html))) push(m[1]);
        // 2.3 最后兜底
        push(rule.host);

        // 3) 探活：只探首页不够。实测 hpdkrzjv.rdajyube.cc 首页 200，但 /archives/xxx/
        //    会 301 到已失效镜像，必须连详情路径一起验。
        //    必须并发：候选里常有打不开的域名，串行会撑爆框架 20s 初始化超时。
        const okPage = (t) => t && t.length > 2000
            && /post-card|post-content|post-title/.test(t)
            && !/<title>[^<]*(40[0-9]|50[0-9]|Bad Gateway|Not Found|不存在)/i.test(t.slice(0, 3000));
        const probe = async (u) => {
            let home = '';
            try { home = await request(u + '/', {timeout: 5000, headers: rule.headers}); } catch (e) { return ''; }
            if (!HIT.test(home || '') || home.length < 8000) return '';
            let idm = home.match(/\/archives\/(\d+)\//);
            if (idm) {
                let detail = '';
                try { detail = await request(u + '/archives/' + idm[1] + '/', {timeout: 6000, headers: rule.headers}); } catch (e) { }
                if (!okPage(detail)) return '';
            }
            return u;
        };

        let rs = await Promise.all(cands.map(u => probe(u).catch(() => '')));
        let goods = rs.filter((u, i) => u && rs.indexOf(u) === i).slice(0, 3);
        if (goods.length) {
            HOST_POOL = goods.slice();
            console.log('[51吃瓜] 动态域名解析成功:', goods[0], '备用:', goods.slice(1).join(',') || '无');
            try { await local.set(CACHE_SLOT, CACHE_KEY, {host: goods[0], pool: goods, time: Date.now()}); } catch (e) { }
            return goods[0];
        }
        console.log('[51吃瓜] 探活全部失败，退出兜底:', rule.host);
        return rule.host;
    },

    // ===== 列表（首页 / 分类）=====
    一级: async function (tid, pg, filter, extend) {
        let {host} = this;
        let self = this;
        pg = parseInt(pg) || 1;
        extend = extend || {};
        let url;
        if (tid === 'index') {
            url = pg === 1 ? host + '/' : host + '/page/' + pg + '/';
        } else if (tid === 'tags') {
            // 标签云：/tags.html 是第 1 页，之后是 /tags/2/ … /tags/42/
            url = pg === 1 ? host + '/tags.html' : host + '/tags/' + pg + '/';
        } else {
            url = pg === 1 ? host + '/category/' + tid + '/' : host + '/category/' + tid + '/' + pg + '/';
        }
        let html = await fetchPage(url, host);

        // 标签云页没有视频卡片，全是 <a class="itags" href="/tag/xxx/">名字</a>
        if (tid === 'tags') {
            // 越界页会 404，404 模板里也残留 itags，必须挡掉，否则会返回一条假数据
            if (/<title>[^<]*(40[0-9]|50[0-9]|不存在|Bad Gateway)/i.test(html.slice(0, 3000))) {
                return setResult([]);
            }
            let tags = [];
            let reTag = /<a[^>]*class="[^"]*itags[^"]*"[^>]*href="(\/tag\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g, tm;
            while ((tm = reTag.exec(html))) {
                let name = tm[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
                if (!name) continue;
                // 标签条目也走「列表」形态：点进去是本标签下的视频
                tags.push({title: name, url: host + tm[1]});
            }
            // 数量上限：站点按热度排序，默认 60 个够用；extend.limit 为空表示全部
            let lim = parseInt(extend.limit) || 0;
            if (!lim && extend.limit !== '') lim = 60;   // 没传时也走默认 60
            if (lim > 0) tags = tags.slice(0, lim);
            return setResult(tags);
        }

        let d = [];
        // 按卡片切块：<div class="post-card" id="post-card-283772">，广告卡是 id="ad-card-*"
        html.split(/<div class="post-card"/).slice(1).forEach((b) => {
            b = b.slice(0, 3000);
            let idm = b.match(/id="(ad-card|post-card)-(\d+)"/);
            if (!idm || idm[1] !== 'post-card') return; // 跳过广告卡
            let id = idm[2];
            let tm = b.match(/post-card-title[^>]*>([\s\S]*?)<\/h2>/);
            if (!tm) return;
            let title = tm[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
            if (!title) return;
            // 封面：站点有两种懒加载前缀 x-bg-loader-url / z-bg-loader-url，都要兼容
            let pm = b.match(/[xz]-bg-loader-url="([^"]+)"/);
            let im = b.match(/post-card-info[^>]*>([\s\S]*?)<\/div>/);
            let info = im ? im[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '';
            let dm = b.match(/itemprop="datePublished" content="([^"]+)"/);
            d.push({
                title: title,
                url: host + '/archives/' + id + '/',
                pic_url: pm ? mkPic(pm[1], self) : '',
                desc: info.slice(0, 40),
                // 内部字段，本地筛选用，返回前删掉
                _ts: dm ? Date.parse(dm[1]) || 0 : 0
            });
        });

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

        // 标签页（分类里「标签云」点进来的）：它不是详情页，是一批视频的聚合。
        // 按「合集」处理——把该标签下的卡片全部摊成集，点哪集播哪集。
        if (/\/tag\//.test(input)) {
            // 不存在的标签返回 404，别把 404 页的推荐位当内容
            if (/<title>[^<]*(40[0-9]|50[0-9]|不存在|Bad Gateway)/i.test(html.slice(0, 3000))) {
                VOD.vod_name = '标签不存在';
                VOD.vod_pic = '';
                VOD.vod_play_from = '图文';
                VOD.vod_play_url = '';
                VOD.vod_content = '该标签没有内容';
                return VOD;
            }
            let tn = strip((html.match(/<h1 class="[^"]*">([\s\S]*?)<\/h1>/) || [])[1])
                || strip((html.match(/<span class="name">([\s\S]*?)<\/span>/) || [])[1])
                || decodeURIComponent((input.match(/\/tag\/([^/]+)\//) || [])[1] || '');
            VOD.vod_name = '标签：' + tn.replace(/\s*-\s*相关.*$/, '');
            VOD.vod_pic = '';
            let eps = [];
            let seen = {};
            // 一个标签下动辄上千页（实测「51吃瓜」这个标签 1/2197），只取第 1 页就只剩 25 条。
            // 这里按页号并发多抓几页合并，TAG_PAGES 控制上限，避免详情请求拖太久。
            let TAG_PAGES = 12;     // 12 页 × 25 条 ≈ 300 条
            let TAG_CONC = 8;       // 同时最多 8 个请求，别把站点打出 429
            let collect = (h) => {
                h.split(/<div class="post-card"/).slice(1).forEach((b) => {
                    b = b.slice(0, 3000);
                    let idm = b.match(/id="(ad-card|post-card)-(\d+)"/);
                    if (!idm || idm[1] !== 'post-card') return;
                    if (seen[idm[2]]) return;
                    let tm2 = b.match(/post-card-title[^>]*>([\s\S]*?)<\/h2>/);
                    if (!tm2) return;
                    let t = strip(tm2[1]);
                    if (!t) return;
                    seen[idm[2]] = 1;
                    if (!VOD.vod_pic) {
                        let pmm = b.match(/[xz]-bg-loader-url="([^"]+)"/);
                        if (pmm) VOD.vod_pic = mkPic(pmm[1], self);
                    }
                    eps.push(t.slice(0, 30) + '$' + host + '/archives/' + idm[2] + '/|0');
                });
            };
            collect(html);

            // <span class="page-info"> 1/2197 </span> 是站点给的总页数
            let pgm = html.match(/page-info[^>]*>\s*(\d+)\s*\/\s*(\d+)\s*</);
            let totalPg = pgm ? (parseInt(pgm[2]) || 1) : 1;
            let wantPg = Math.min(totalPg, TAG_PAGES);
            if (wantPg > 1) {
                // input 形如 https://host/tag/{kw}/ ，第 n 页是 .../tag/{kw}/{n}/
                let base = input.replace(/\/+$/, '') + '/';
                let todo = [];
                for (let p = 2; p <= wantPg; p++) todo.push(p);
                let cur = 0;
                let worker = async () => {
                    while (cur < todo.length) {
                        let p = todo[cur++];
                        try {
                            let ph = await fetchPage(base + p + '/', host);
                            if (ph) collect(ph);
                        } catch (e) { }
                    }
                };
                let ws = [];
                for (let i = 0; i < Math.min(TAG_CONC, todo.length); i++) ws.push(worker());
                await Promise.all(ws);
            }

            if (eps.length) {
                let list = eps.join('#');
                VOD.vod_play_from = '吃瓜$$$吃瓜H265';
                VOD.vod_play_url = list + '$$$' + list;
                VOD.vod_remarks = '标签' + eps.length + '条/共' + totalPg + '页';
                VOD.vod_content = '标签「' + tn + '」共 ' + totalPg + ' 页，本源取前 ' + wantPg + ' 页共 ' + eps.length + ' 条';
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

        // 正文：直接抽 post-content 里的 <p>，按 AD_WORDS 过滤站方广告条
        let body = (html.match(/<div class="post-content"[^>]*>([\s\S]*?)<div class="post-actions"/) || [])[1] || '';
        let paras = (body.match(/<p[^>]*>[\s\S]*?<\/p>/g) || [])
            .map(s => strip(s))
            .filter(s => s && !AD_WORDS.some(w => s.includes(w)));
        VOD.vod_content = paras.join('\n').slice(0, 800) ||
            (html.match(/<meta name="description" content="([^"]*)"/) || [])[1] || '';

        // 详情页底部 <div class="tags"><div itemprop="keywords"> 里是这篇文章的标签
        let tagBlk = (html.match(/<div class="tags">([\s\S]*?)<\/div>\s*<\/div>/) || [])[1] || '';
        let tagNames = [];
        let reT = /<a[^>]*href="\/tag\/[^"]*"[^>]*>([\s\S]*?)<\/a>/g, tmm;
        while ((tmm = reT.exec(tagBlk))) {
            let n = strip(tmm[1]);
            if (n && !tagNames.includes(n)) tagNames.push(n);
        }
        if (tagNames.length) {
            VOD.vod_tag = tagNames.join(',');
            // 客户端不一定显示 vod_tag，正文末尾也带一份，搜标签时能命中
            VOD.vod_content = (VOD.vod_content + '\n标签：' + tagNames.map(n => '#' + n).join(' ')).slice(0, 900);
        }

        // 播放列表：三种页面形态统一处理
        //   A. 单视频页  ：1 个 dplayer
        //   B. 多视频页  ：N 个 dplayer（每条 data-video_title 是集名）
        //   C. 合集页    ：0 个 dplayer，正文里列着若干 /archives/{id}/ 子帖链接
        // 集地址统一带 |索引 后缀（合集页是子帖 URL，不带索引）
        let dblocks = html.split(/<div class="dplayer"/).slice(1);
        let eps = [];
        if (dblocks.length) {
            dblocks.forEach((b, i) => {
                b = b.slice(0, 6000);
                let t = strip((b.match(/data-video_title="([^"]*)"/) || [])[1]);
                // 集名兜底：没有标题就用「正片」/「第N集」
                if (!t) t = dblocks.length > 1 ? '第' + (i + 1) + '集' : '正片';
                eps.push(t.slice(0, 30) + '$' + input + '|' + i);
            });
        } else {
            // C 合集/榜单页：正文里列着若干子帖（如 /archives/283241/ 每日大瓜TOP10）
            //   陷阱：子帖自己可能又是多视频页（如 282962 里有 10 个播放器）。
            //   所以不能只把子帖当一集，要并发抓子帖、把它内部的播放器全部摊平成集。
            let seen = {}, kids = [];
            (body.match(/<p[^>]*>[\s\S]*?<\/p>/g) || []).forEach(p => {
                let lm = p.match(/href="\/archives\/(\d+)\/"/);
                if (!lm || seen[lm[1]]) return;   // 同一子帖会出现在「标题段」和「简要描述段」，去重
                seen[lm[1]] = 1;
                let t = strip(p)
                    .replace(/[｜|]?\s*点击查看详情\s*[→»]*\s*$/, '')   // 剥掉「｜点击查看详情 →」
                    .replace(/^[\s👉→▶]*点我查看详情帖\s*/, '')
                    .replace(/^[\s👉→▶]+/, '')
                    .trim();
                kids.push({id: lm[1], title: t || ('第' + (kids.length + 1) + '部')});
            });
            kids = kids.slice(0, 12);   // 榜单一般不超 12 条，防异常页拖时间

            // 并发 5 抓子帖，统计每个子帖里的播放器数量与集名
            let kp = 0, got = [];
            let worker = async () => {
                while (kp < kids.length) {
                    let k = kids[kp++];
                    let kurl = host + '/archives/' + k.id + '/';
                    let kh = '';
                    try { kh = await fetchPage(kurl, host); } catch (e) { }
                    let arr = kh ? kh.split(/<div class="dplayer"/).slice(1) : [];
                    got.push({
                        k: k, kurl: kurl,
                        titles: arr.map(x => strip((x.slice(0, 6000).match(/data-video_title="([^"]*)"/) || [])[1]))
                    });
                }
            };
            let ws = [];
            for (let i = 0; i < 5; i++) ws.push(worker());
            await Promise.all(ws);
            // 并发返回顺序不定，按 kids 原顺序还原
            let order = {};
            kids.forEach((k, i) => { order[k.id] = i; });
            got.sort((a, b) => (order[a.k.id] || 0) - (order[b.k.id] || 0));

            got.forEach(g => {
                let n = g.titles.length;
                if (!n) return;   // 子帖已删除/无播放器，直接跳过（实测 282936、282950 在部分镜像 404）
                if (n === 1) {
                    eps.push(g.k.title.slice(0, 30) + '$' + g.kurl + '|0');
                    return;
                }
                g.titles.forEach((t, i) => {
                    // 多视频页里各条 data-video_title 往往只差尾部 001/002，直接截断会全变一样，
                    // 所以统一用「子帖标题 + 第N段」，保证集名可区分
                    let nm = g.k.title.slice(0, 22) + ' 第' + (i + 1) + '段';
                    eps.push(nm.slice(0, 30) + '$' + g.kurl + '|' + i);
                });
            });
        }

        if (eps.length) {
            let list = eps.join('#');
            VOD.vod_play_from = '吃瓜$$$吃瓜H265';
            VOD.vod_play_url = list + '$$$' + list;
            if (dblocks.length > 1) VOD.vod_remarks = '共' + dblocks.length + '段';
            else if (!dblocks.length) VOD.vod_remarks = '合集' + eps.length + '集';
        } else {
            VOD.vod_play_from = '图文';
            VOD.vod_play_url = '';
        }
        return VOD;
    },

    // ===== 搜索 =====
    搜索: async function (wd, quick, pg) {
        let {host} = this;
        let self = this;
        pg = parseInt(pg) || 1;
        // 关键词以 # 开头 → 强制按标签搜（/tag/{kw}/）；
        // 否则先走站内搜索（/search/{kw}/），搜不到再自动按标签兜底，
        // 这样客户端里直接打字搜标签名也能出结果，不依赖 # 前缀。
        let byTag = /^[#＃]/.test(wd || '');
        let kw = byTag ? (wd || '').replace(/^[#＃]\s*/, '') : (wd || '');
        let mkUrl = (base) => base + encodeURIComponent(kw) + '/' + (pg > 1 ? pg + '/' : '');
        let html = await fetchPage(mkUrl(byTag ? host + '/tag/' : host + '/search/'), host);
        if (!byTag && !/<div class="post-card"[^>]*id="post-card-\d+"/.test(html)) {
            let th = await fetchPage(mkUrl(host + '/tag/'), host);
            if (/<div class="post-card"[^>]*id="post-card-\d+"/.test(th)) html = th;
        }
        let d = [];
        html.split(/<div class="post-card"/).slice(1).forEach((b) => {
            b = b.slice(0, 3000);
            let idm = b.match(/id="(ad-card|post-card)-(\d+)"/);
            if (!idm || idm[1] !== 'post-card') return;
            let tm = b.match(/post-card-title[^>]*>([\s\S]*?)<\/h2>/);
            if (!tm) return;
            let title = tm[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
            if (!title) return;
            d.push({
                title: title,
                url: host + '/archives/' + idm[2] + '/',
                pic_url: mkPic((b.match(/[xz]-bg-loader-url="([^"]+)"/) || [])[1], self),
                desc: (b.match(/post-card-info[^>]*>([\s\S]*?)<\/div>/) || ['', ''])[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40)
            });
        });
        return setResult(d);
    },

    // ===== 播放：从详情页 dplayer 的 data-config 取 m3u8 =====
    // flag = '吃瓜' → H.264；flag = '吃瓜H265' → H.265
    lazy: async function (flag, id, flags) {
        let {host} = this;
        let wantH265 = /265/i.test(flag || '');
        // 多视频页的集地址形如 <详情URL>|3，先剥索引再请求
        let idx = 0;
        let mi = id.match(/^(.*)\|(\d+)$/);
        if (mi) {
            id = mi[1];
            idx = parseInt(mi[2]) || 0;
        }
        let html = await fetchPage(id, host);

        // 一页可能有多个 dplayer，按块切分取第 idx 个；索引越界回退最后一个
        let raw = '';
        let dblocks = html.split(/<div class="dplayer"/).slice(1);
        if (dblocks.length) {
            let blk = dblocks[Math.min(idx, dblocks.length - 1)];
            let mc = blk.match(/data-config='([\s\S]*?)'/) || blk.match(/data-config="([\s\S]*?)"/);
            if (mc) raw = mc[1];
        }
        if (!raw) {
            let m = html.match(/data-config='([\s\S]*?)'/) || html.match(/data-config="([\s\S]*?)"/);
            if (m) raw = m[1];
        }
        if (raw) {
            raw = raw.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
            try {
                let cfg = JSON.parse(raw);
                let h264 = (cfg.video && cfg.video.url) || '';
                let h265 = (cfg.video_h265 && cfg.video_h265.url) || '';
                // 按线路取，取不到就回退另一条，避免空播
                let url = wantH265 ? (h265 || h264) : (h264 || h265);
                if (url) {
                    url = url.replace(/\\\//g, '/');
                    return {parse: 0, url: url, header: {'User-Agent': 'PC_UA'}};
                }
            } catch (e) {
                // JSON 解析失败，退化到正则抠 m3u8
                let mm = raw.match(/https?:\\?\/\\?\/[^"']+\.m3u8[^"']*/);
                if (mm) return {parse: 0, url: mm[0].replace(/\\\//g, '/')};
            }
        }
        // 兜底：整页正则找 m3u8
        let mm2 = html.match(/https?:\\?\/\\?\/[^"'\s]+\.m3u8[^"'\s]*/);
        if (mm2) return {parse: 0, url: mm2[0].replace(/\\\//g, '/')};
        return {parse: 1, url: id};
    },

    // ===== 封面解密代理 =====
    // 客户端请求 /proxy/51吃瓜/?url=<加密图URL>，这里取密文 → AES 解密 → 吐真图。
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
            // buffer: 2 → 返回 base64 字符串，避免二进制被当成 utf-8 破坏
            // 注意：沙箱里的 request 直接返回 base64 字符串本身，不是 {code, content} 对象
            let resp = await request(u, {headers: rule.headers, buffer: 2, timeout: 15000});
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

            // 用解密后的魔数定 MIME：URL 后缀会写错（.jpeg 里装 PNG 的情况实测存在）
            try {
                let head = Buffer.from(plain, 'base64').slice(0, 12);
                if (head[0] === 0xFF && head[1] === 0xD8) mime = 'image/jpeg';
                else if (head[0] === 0x89 && head[1] === 0x50) mime = 'image/png';
                else if (head.slice(0, 3).toString('latin1') === 'GIF') mime = 'image/gif';
                else if (head.slice(0, 4).toString('latin1') === 'RIFF') mime = 'image/webp';
            } catch (e) { }
            return [200, mime, plain, {'Cache-Control': 'public, max-age=86400'}, 1];
        } catch (e) {
            return [500, 'text/plain', 'proxy error: ' + e.message];
        }
    }
};

// 所有分类共用同一套筛选（站点无服务端排序参数，全部在「一级」里本地处理）
// 「标签云」是例外：它没有时间/排序概念，只有「取多少个」
rule.class_url.split('&').forEach(function (tid) {
    if (tid === 'tags') {
        rule.filter[tid] = FILTER_TAG;
        rule.filter_def[tid] = {limit: '60'};
        return;
    }
    rule.filter[tid] = FILTER_DEF;
    rule.filter_def[tid] = {by: '', days: ''};
});
