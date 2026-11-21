/*
@header({
  searchable: 1,
  filterable: 1,
  quickSearch: 0,
  title: '星辰影院',
  '类型': '影视',
  lang: 'ds'
})
*/

var _xcStrip = function (s) {
    if (s === undefined || s === null) return '';
    return String(s)
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/\s+/g, ' ')
        .trim();
};
var _xcAbs = function (u, host) {
    if (!u) return '';
    u = String(u).trim();
    if (/^https?:\/\//i.test(u)) return u;
    if (u.indexOf('//') === 0) return 'https:' + u;
    return (host || '') + (u.charAt(0) === '/' ? u : '/' + u);
};
var _xcPick = function (html, label) {
    var re = new RegExp('<strong[^>]*>\\s*' + label + '\\s*[:：]?\\s*<\\/strong>([\\s\\S]{0,1500}?)<\\/div>');
    var m = html.match(re);
    if (!m) return '';
    var names = [];
    (m[1].match(/<a[^>]*>([\s\S]*?)<\/a>/g) || []).forEach(function (a) {
        var t = _xcStrip(a);
        if (t && names.indexOf(t) < 0) names.push(t);
    });
    return names.join(',');
};

var rule = {
    类型: '影视',
    title: '星辰影院',
    host: 'https://www.xcyycn.com',
    url: '/vs/fyfilter',
    searchUrl: '/s.html?wd=**&page=fypage',
    headers: {'User-Agent': 'MOBILE_UA'},
    searchable: 1, quickSearch: 0, filterable: 1, play_parse: true, double: false, limit: 6,
    filter_url: '{{fl.cateId}}-{{fl.area}}-{{fl.by}}-{{fl.class}}-----fypage---{{fl.year}}.html',
    filter_def: {
        '1': {cateId: '1'}, '2': {cateId: '2'}, '3': {cateId: '3'}, '4': {cateId: '4'}
    },
    class_name: '电影&电视剧&动漫&综艺',
    class_url: '1&2&4&3',
    filter: 'H4sIAAAAAAAAA+2Zy04bSRSG9/MYXrOohtwmrzLKwhNZSpRMRoJMJBQhQcDEBgcbROw4OEDENYRLcxkwDbZfxlVtv8WUXVXnnJ4hx42HRRbe+T+nbn91ddXX5bcJL/H4t7eJF6nxxOPE05fJsbHEUOJV8o+UljK7o6bTWr9Jvvwr1S33qhNO77andzthLRITQzY6t9usVWzUCsgVK7otlzPC5cKdRXl5ZXNWuJyaKqjJos1ZAfUyx3ZwKKA/GDgKaDPzqRlkXZtGuFzr0Je1jzZnBfEXLl+hv46ANqfn1LvPrk0jYJxzR2Ftz43TCKj3bj8sLrp6RkB/s0vt8jfXnxGQ23qPc2YF5A7PZXDgckZAbmFW5k9czgiXa16va8c2ZwXUy2+2NmA+jXC59tpp87Jgc1ZAvUJOTcJzNwLmulHQs+jm2giYl4PtZn3dzYsRMJ9rB2H2vZtPI7BerpVZhXpdAf1tNXDVWgHjnGmE37fcOI2A/qbq7c91158RuJbyauUE1lJXQL3KWjMIwp1JVxU0zNyXJfXJ9WrFxJNO1ryNydFUkryMFV/mgrgv4+ZOuzzrDBkB3W6XVfXIdWsEPmhfXdbhQXcFGKovyJWac2METERpS1X23UQYgQvkG9azAh7K/DHmrIA2Tz9izgoYZ/0Cc1ZAvZm8diwz7t1BTZZCmNcLp4yrwWp4GRozYa2kim6aUON2sK7mG7ph2BGchhIffBlsu7QR6M2n3vyIt/S5PJx29YyAekVfdyS/fHVVQYO3/Imsz8tD9xBRQxv1UzMfzQC2LBqCcVTWWpOnegBuKKBhRSyuynTVrQgjoPbFmZ5WV9UIGOOHC5l2W40V0VmT/rWugAP8dxS85Pbk7pRzYQTkygFZBEaQw0P6yzgI1LgdzqlKCbbDroDxL5X1JujGbwR9ccdTyVHy4l6eNa9qMV/cYTF8z8a6P0l8BOMjND6M8WEa9zDu0bjAuCBx71eI658k/gjjj2j8IcYf0vgDjD+g8fsYv0/j6Nejfj3061G/Hvr1qF8P/XrUr4d+PepXoF9B/Qr0K6hfgX4F9SvQr6B+BfoV1K9Av4L6FehXUL8C/QrqV6BfQf0K9Kt/0mX5+zguSrWwJIP8fxalymVV6bxdOrNtvH6uS+PLltUnmPKXbfLZ89djNNk6mpEZd+iMPf1zNNXp/snQL4nhHzNmeHwlV+fjHmsrtWYAO64RMID9HX0oudfdiDhHHnc8ccchd+Spvy/kJnCrEbG2foZbWd5l+JpjTI5NOeZjWZ9hU46T++VW9vuBYX2OTTn+5Lic/V4J9vDbwoo47M3xLsfQLJczvNsvQ9/IyQOa/b/E15tVe5MoS9IcpfakzRiczHDg3ZFob+bnvhh6MzNLurci1t7keWumHZDngDwH5Hkzed67U/LU56u6/h7hTxsiR0fnUKDlIqEorUbL0RCUqx7pgytajoaixBktR0OE3H54i8lRJEem7G0kd4vJUCRHdSwJM2TDESZ7q8gQNEdgHEFzhMmRG3ubzNA1R8IctXLkrQqr4T7MixFxKDKcPmh9hWtRI35iUuyXBjnC7PvekyHF3hzYm9Z602YM0mKIkr23ZQh5wD0D7hlwzy24Z+SuuKe7h4ZX161sENlWbSjKKZFykVCUj6LlaCjKR9FyNASbbM9/2cxVCzncQcOmN3Ms8xvYBuo4JzJ70q1U5QZ86RkRh7ZYwmFOZJZGOBJj6K512Gj5GdemEfg006pahefYFXGoqV8S4+7s2DtJ7r6L++++vtDeWMMjvCN+YlLhaISjmH5Jhf2nkqOYGDdWDAvcwa1UjFu1u7i36u/OacA1A64ZcM0NXDPxDyQRoaiuJgAA',
    lazy: async function () {
        let {input} = this
        if (/\.(m3u8|mp4)(\?|$)/i.test(input)) return {parse: 0, url: input}
        let content = ''
        try {
            content = await request(input)
        } catch (e) {
            return {parse: 1, url: input}
        }
        let m = content.match(/player_[A-Za-z0-9_]*\s*=\s*(\{[\s\S]*?\})\s*<\/script>/);
        if (!m) m = content.match(/player_[A-Za-z0-9_]*\s*=\s*(\{[\s\S]*?\});/);
        if (!m) return {parse: 1, url: input}
        let cfg
        try {
            cfg = JSON.parse(m[1])
        } catch (e) {
            return {parse: 1, url: input}
        }
        let url = cfg.url || ''
        if (cfg.encrypt) {
            try {
                url = cfg.encrypt === '2' ? unescape(base64Decode(url)) : unescape(url)
            } catch (e) {
            }
            if (/^https?:\/\//i.test(url)) return {parse: 0, url}
        }
        if (/^https?:\/\//i.test(url) && /\.(m3u8|mp4)/i.test(url)) return {parse: 0, url}
        return {parse: 1, url: input}
    },
    推荐: async function () {
        let {input, pdfa, pdfh, pd} = this;
        let html = await request(input);
        let d = [];
        let data = pdfa(html, '.public-list-box');
        data.forEach((it) => {
            d.push({
                title: pdfh(it, 'a&&title'),
                pic_url: pd(it, 'img&&data-src'),
                desc: pdfh(it, '.public-list-prb&&Text'),
                url: pd(it, 'a&&href'),
            })
        });
        return setResult(d)
    },
    一级: async function () {
        let {input, pdfa, pdfh, pd} = this;
        let html = await request(input);
        let d = [];
        let data = pdfa(html, '.public-list-box');
        data.forEach((it) => {
            d.push({
                title: pdfh(it, 'a&&title'),
                pic_url: pd(it, 'img&&data-src'),
                desc: pdfh(it, '.public-list-prb&&Text'),
                url: pd(it, 'a&&href'),
            })
        });
        return setResult(d)
    },
    二级: async function () {
        let {input} = this;
        let host = this.HOST || rule.host;
        let html = await request(input);
        let VOD = {};
        let m;
        // 标题
        m = html.match(/<h3[^>]*class="slide-info-title[^"]*"[^>]*>([\s\S]*?)<\/h3>/);
        VOD.vod_name = _xcStrip(m && m[1]);
        // 海报
        m = html.match(/<div class="detail-pic"[\s\S]{0,900}?<img[^>]*data-src="([^"]+)"/);
        if (!m) m = html.match(/<div class="detail-pic"[\s\S]{0,900}?<img[^>]*src="([^"]+)"/);
        VOD.vod_pic = _xcAbs(m && m[1], host);
        // 备注
        m = html.match(/<span class="slide-info-remarks">([\s\S]*?)<\/span>/);
        VOD.vod_remarks = _xcStrip(m && m[1]);
        // 年份 / 地区
        let infoBlock = (html.match(/<div class="slide-info hide">([\s\S]*?)<\/div>/) || [])[1] || '';
        let yearM = infoBlock.match(/\/s\/year\/(\d+)\.html/);
        if (yearM) VOD.vod_year = yearM[1];
        let areaLinks = infoBlock.match(/<a href="\/s\/[^"]+"[^>]*>[^<]+<\/a>/g) || [];
        areaLinks.forEach(function (a) {
            if (VOD.vod_area || /\/s\/year\//.test(a)) return;
            let t = a.match(/>([^<]+)<\/a>/);
            if (t) VOD.vod_area = _xcStrip(t[1]);
        });
        // 导演 / 演员 / 类型
        VOD.vod_director = _xcPick(html, '导演');
        VOD.vod_actor = _xcPick(html, '演员');
        let typeName = _xcPick(html, '类型');
        if (typeName) VOD.type_name = typeName;
        // 简介
        m = html.match(/<div id="height_limit"[^>]*>([\s\S]*?)<\/div>/);
        VOD.vod_content = _xcStrip(m && m[1]);
        // 播放列表：线路名按 DOM 索引与 anthology-list-box 一一对应
        let tabs = [];
        let tabBlock = (html.match(/<div class="anthology-tab[\s\S]*?<div class="swiper-wrapper">([\s\S]*?)<\/div><\/div>/) || [])[1] || '';
        (tabBlock.match(/<a[^>]*class="swiper-slide"[^>]*>([\s\S]*?)<\/a>/g) || []).forEach(function (a) {
            let name = _xcStrip(a.replace(/<span class="badge">[\s\S]*?<\/span>/, ''));
            if (name) tabs.push(name);
        });
        let froms = [];
        let urls = [];
        let boxes = html.split(/<div class=['"]anthology-list-box/).slice(1);
        boxes.forEach(function (b, i) {
            let name = tabs[i] || ('线路' + (i + 1));
            let eps = [];
            let seg = b.slice(0, 20000);
            if (/anthology-list-dow/.test(seg.slice(0, 500))) {
                (seg.match(/<a[^>]*class="left"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g) || []).forEach(function (a) {
                    let hm = a.match(/href="([^"]+)"/);
                    if (!hm) return;
                    let tm = a.match(/>([\s\S]*?)<\/a>/);
                    let title = _xcStrip(tm && tm[1]) || '下载';
                    eps.push(title + '$' + _xcAbs(hm[1], host));
                });
            } else {
                let ul = (seg.match(/<ul class="anthology-list-play[\s\S]*?<\/ul>/) || [])[0] || '';
                (ul.match(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g) || []).forEach(function (a) {
                    let hm = a.match(/href="([^"]+)"/);
                    if (!hm) return;
                    let tm = a.match(/>([\s\S]*?)<\/a>/);
                    let title = _xcStrip(tm && tm[1]) || '正片';
                    eps.push(title + '$' + _xcAbs(hm[1], host));
                });
            }
            if (eps.length) {
                froms.push(name);
                urls.push(eps.join('#'));
            }
        });
        if (!froms.length) {
            VOD.vod_play_from = '星辰';
            VOD.vod_play_url = '';
        } else {
            VOD.vod_play_from = froms.join('$$$');
            VOD.vod_play_url = urls.join('$$$');
        }
        return VOD
    },
    搜索: async function () {
        let {input} = this;
        let host = this.HOST || rule.host;
        let html = await request(input);
        let d = [];
        html.split(/<div class="public-list-box/).slice(1).forEach(function (b) {
            b = b.slice(0, 3500);
            let hm = b.match(/href="(\/d[-_]\d+\.html)"/);
            if (!hm) return;
            let title = _xcStrip((b.match(/class="thumb-txt[^"]*"[^>]*>([\s\S]*?)<\/div>/) || [])[1]);
            if (!title) {
                title = _xcStrip((b.match(/alt="([^"]*)"/) || [])[1]).replace(/封面图$/, '');
            }
            let pic = (b.match(/data-src="([^"]+)"/) || [])[1] || '';
            let desc = _xcStrip((b.match(/class="public-list-prb[^"]*"[^>]*>([\s\S]*?)<\/span>/) || [])[1]);
            let content = _xcStrip((b.match(/thumb-blurb[^"]*"[^>]*>([\s\S]*?)<\/span>/) || [])[1]);
            if (!title) return;
            d.push({
                title: title,
                pic_url: _xcAbs(pic, host),
                desc: desc,
                url: _xcAbs(hm[1], host),
                content: content,
            })
        });
        return setResult(d)
    }
}
