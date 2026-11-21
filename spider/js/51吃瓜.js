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

// 站点域名几乎每天换一批，而且不同路径可能落在不同域名上：
// 实测 hpdkrzjv.rdajyube.cc 的首页还是 200，但 /archives/xxx/ 会 301 到一个已失效的
// jegajbgg 镜像（404/502），而发布页新给的 auytnoh.jegajbgg.cc 反而是全路径可用。
// 所以 hostJs 把探活过的候选存进 HOST_POOL，取页失败时把路径换到池里其它域名再试。
var HOST_POOL = [];

async function fetchPage(u, host) {
    let ok = (t) => t && t.length > 2000 && /post-card|post-content|post-title/.test(t)
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
    class_name: '首页&每日大赛&网黄合集&吃瓜榜单&瓜友点播&热门大瓜&必看大瓜&成人视频&伦理道德&国产视频&探花精选&学生校园&网红黑料&骚男骚女&明星爆料&海外吃瓜&人人吃瓜&领导干部&软萌甜妹&竞技吃瓜&吃瓜看戏&擦边撩骚&性爱技巧&吃瓜新闻&51原创短剧&原创博主',
    class_url: 'index&mrds&whhj&mrdg&qghj&rdsj&bkdg&ysyl&lldd&gcjq&thjx&xsxy&whhl&snsn&whmx&hwcg&rrcg&ldcg&jpll&sjb&qubk&dcbq&zzs&cgxw&51djc&yczq',

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
        pg = parseInt(pg) || 1;
        extend = extend || {};
        let url;
        if (tid === 'index') {
            url = pg === 1 ? host + '/' : host + '/page/' + pg + '/';
        } else {
            url = pg === 1 ? host + '/category/' + tid + '/' : host + '/category/' + tid + '/' + pg + '/';
        }
        let html = await fetchPage(url, host);
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
            let pm = b.match(/x-bg-loader-url="([^"]+)"/);
            let im = b.match(/post-card-info[^>]*>([\s\S]*?)<\/div>/);
            let info = im ? im[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '';
            let dm = b.match(/itemprop="datePublished" content="([^"]+)"/);
            d.push({
                title: title,
                url: host + '/archives/' + id + '/',
                pic_url: pm ? pm[1] : '',
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
        let html = await fetchPage(input, host);
        let strip = (s) => (s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        let VOD = {};
        VOD.vod_id = input;
        VOD.vod_name = strip((html.match(/<h1 class="post-title[^"]*"[^>]*>([\s\S]*?)<\/h1>/) || [])[1]);
        if (!VOD.vod_name) VOD.vod_name = (html.match(/<meta itemprop="headline" content="([^"]*)"/) || [])[1] || '';
        VOD.vod_pic = (html.match(/<meta itemprop="image" content="([^"]*)"/) || [])[1] || '';
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
            // C 合集页：按出现顺序收集子帖链接，集名用链接所在 <p> 的文字
            let seen = {};
            (body.match(/<p[^>]*>[\s\S]*?<\/p>/g) || []).forEach(p => {
                let lm = p.match(/href="\/archives\/(\d+)\/"/);
                if (!lm || seen[lm[1]]) return;
                seen[lm[1]] = 1;
                let t = strip(p).replace(/^[\s👉→▶]*点我查看详情帖\s*/, '').replace(/^[\s👉→▶]+/, '');
                if (!t) t = '第' + (eps.length + 1) + '集';
                eps.push(t.slice(0, 30) + '$' + host + '/archives/' + lm[1] + '/');
            });
        }

        if (eps.length) {
            let list = eps.join('#');
            VOD.vod_play_from = '吃瓜$$$吃瓜H265';
            VOD.vod_play_url = list + '$$$' + list;
            if (dblocks.length > 1) VOD.vod_remarks = '共' + dblocks.length + '段';
            else if (!dblocks.length) VOD.vod_remarks = '合集' + eps.length + '部';
        } else {
            VOD.vod_play_from = '图文';
            VOD.vod_play_url = '';
        }
        return VOD;
    },

    // ===== 搜索 =====
    搜索: async function (wd, quick, pg) {
        let {host} = this;
        pg = parseInt(pg) || 1;
        let url = host + '/search/' + encodeURIComponent(wd) + '/' + (pg > 1 ? pg + '/' : '');
        let html = await fetchPage(url, host);
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
                pic_url: (b.match(/x-bg-loader-url="([^"]+)"/) || [])[1] || '',
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
    }
};

// 所有分类共用同一套筛选（站点无服务端排序参数，全部在「一级」里本地处理）
rule.class_url.split('&').forEach(function (tid) {
    rule.filter[tid] = FILTER_DEF;
    rule.filter_def[tid] = {by: '', days: ''};
});
