/*
@header({
  searchable: 2,
  filterable: 1,
  quickSearch: 0,
  title: '腾云驾雾[官]',
  lang: 'ds'
})
*/

var _TY = {
    page: 'https://pbaccess.video.%71%71.com/trpc.vector_layout.page_view.PageService/getPage?video_appid=3000010&vversion_platform=2&vdevice_guid=',
    search: 'https://pbaccess.video.%71%71.com/trpc.videosearch.mobile_search.HttpMobileRecall/MbSearchHttp',
    detail: 'https://node.video.%71%71.com/x/api/float_vinfo2?cid=',
    guid: 'a1b2c3d4e5f64a7b8c9d0e1f2a3b4c5d',
    channel: {
        choice: '100101', movie: '100173', tv: '100113', variety: '100109',
        cartoon: '100119', child: '100150', doco: '100105'
    },
    headers: {
        'User-Agent': 'PC_UA',
        'Content-Type': 'application/json',
        'Referer': 'https://v.qq.com/x/search/',
        'Origin': 'https://v.qq.com'
    }
};
var _tyStrip = function (s) {
    if (s === undefined || s === null) return '';
    return String(s)
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&quot;/gi, '"')
        .replace(/\s+/g, ' ')
        .trim();
};
// 腾讯卡片 -> drpy 列表项
var _tyItem = function (p) {
    if (!p) return null;
    let cid = p.cid || p.id || '';
    if (!cid) return null;
    let title = _tyStrip(p.title || p.mz_title || p.priority_title || p.video_titleX || '');
    if (!title) return null;
    let type = _tyStrip(p.mz_type_name || p.vid_type_name || '');
    let year = _tyStrip(p.publish_date || '').slice(0, 4) || _tyStrip(p.year || '');
    let area = _tyStrip(p.area_name || p.areaName || p.gen_area_name || '');
    let desc = [type, year, area].filter(function (x) { return x; }).join(' · ');
    if (!desc) desc = _tyStrip(p.rec_subtitle || p.sectitle || p.priority_sub_title || '');
    let content = _tyStrip(p.rec_subtitle || p.sectitle || p.priority_sub_title || '');
    let pic = p.image_url_vertical || p.image_url || p.pic_498x280 || p.pic_540x304 || '';
    return {
        title: title,
        pic_url: pic,
        desc: desc,
        content: content,
        url: _TY.detail + cid
    };
};
// getPage 响应 -> 列表
var _tyList = function (json) {
    let out = [];
    let seen = {};
    let cards = (json && json.data && json.data.CardList) || [];
    cards.forEach(function (c) {
        let list = (c && c.children_list && c.children_list.list) || {};
        (list.cards || []).forEach(function (k) {
            if (!k || !/^pc_(video|shelves|carousel)$/.test(k.type || '')) return;
            let it = _tyItem(k.params);
            if (!it) return;
            if (seen[it.url]) return;
            seen[it.url] = 1;
            out.push(it);
        });
    });
    return out;
};
// 搜索响应 -> 影视专辑列表（只取 dataType=2 的专辑卡，UGC 短视频不能进详情接口）
var _tySearchList = function (json) {
    let out = [];
    let seen = {};
    let push = function (doc, v) {
        if (!doc || !v) return;
        if (Number(doc.dataType) !== 2) return;
        let cid = doc.id || '';
        if (!cid || seen[cid]) return;
        let title = _tyStrip(v.title || '');
        if (!title) return;
        seen[cid] = 1;
        let year = _tyStrip(v.year || '');
        let area = _tyStrip(v.area || '');
        let type = _tyStrip(v.typeName || '');
        out.push({
            title: title,
            pic_url: v.imgUrl || '',
            desc: [type, year, area].filter(function (x) { return x; }).join(' · '),
            content: _tyStrip(v.descrip || ''),
            url: _TY.detail + cid
        });
    };
    let data = (json && json.data) || {};
    let normal = (data.normalList && data.normalList.itemList) || [];
    normal.forEach(function (it) { push(it.doc, it.videoInfo) });
    (data.areaBoxList || []).forEach(function (box) {
        (box.itemList || []).forEach(function (it) { push(it.doc, it.videoInfo) });
    });
    return out;
};
// 翻页必须回传上一页的 page_context，服务端不认 page_index 递推
var _tyCtx = {};
var _tyRemember = function (pg, json) {
    let ctx = json && json.data && json.data.page_context;
    if (ctx) _tyCtx[pg + 1] = ctx;
};
var _tyBody = function (tid, pg, fl) {
    // 腾讯频道筛选只认 filter_value；page_params 里塞 itype/iyear 会被服务端忽略
    let pairs = [];
    ['sort', 'iyear', 'year', 'itype', 'ifeature', 'iarea', 'itrailer', 'gender'].forEach(function (k) {
        let v = fl && fl[k];
        if (v === undefined || v === null) return;
        v = String(v);
        if (v === '' || v === '-1') return;
        pairs.push(k + '=' + v);
    });
    let page_params = {
        page_type: 'channel',
        page_id: _TY.channel[tid] || _TY.channel.choice,
        scene: 'channel',
        new_mark_label_enabled: '1',
        vl_to_mvl: '',
        free_watch_trans_info: '{"ad_frequency_control_time_list":{}}'
    };
    if (pairs.length) page_params.filter_value = pairs.join('&');
    return {
        page_params: page_params,
        page_bypass_params: {
            params: {
                platform_id: '2',
                caller_id: '3000010',
                data_mode: 'default',
                user_mode: 'default',
                specified_strategy: ''
            },
            scene: 'channel',
            app_version: '8.8.0',
            abtest_bypass_id: ''
        },
        page_context: pg > 1 ? (_tyCtx[pg] || {page_index: String(pg - 1)}) : null,
        user_activity_tag: '1'
    };
};
// 目标页上下文缺失时从前面顺推（最多回退 5 页）
var _tyResolve = async function (tid, pg, fl) {
    if (pg <= 1 || _tyCtx[pg]) return;
    let start = Math.max(1, pg - 5);
    for (let p = start; p < pg; p++) {
        if (_tyCtx[p + 1]) continue;
        let html = await request(_TY.page + _TY.guid, {
            method: 'POST',
            body: JSON.stringify(_tyBody(tid, p, fl)),
            headers: _TY.headers,
            timeout: 8000
        });
        try {
            _tyRemember(p, JSON.parse(html));
        } catch (e) {
            return;
        }
    }
};
var _tyFetch = async function (tid, pg, fl) {
    await _tyResolve(tid, pg, fl);
    let body = _tyBody(tid, pg, fl);
    let html = await request(_TY.page + _TY.guid, {
        method: 'POST',
        body: JSON.stringify(body),
        headers: _TY.headers,
        timeout: 8000
    });
    let json = {};
    try {
        json = JSON.parse(html);
    } catch (e) {
        log('腾云驾雾列表接口解析失败:' + e.message);
        return [];
    }
    _tyRemember(pg, json);
    return _tyList(json);
};
var rule = {
    title: '腾云驾雾[官]',
    host: 'https://v.%71%71.com',
    homeUrl: '/x/bu/pagesheet/list?_all=1&append=1&channel=cartoon&listpage=1&offset=0&pagesize=21&iarea=-1&sort=18',
    detailUrl: 'https://node.video.%71%71.com/x/api/float_vinfo2?cid=fyid',
    searchUrl: 'https://pbaccess.video.%71%71.com/search?wd=**&pg=fypage',
    searchable: 2,
    filterable: 1,
    url: '/x/channel/fyclass?page=fypage',
    filter_url: '',
    filter: 'H4sIAAAAAAAAA+1Y3U8aWRT/X+ZZEwYEtI9207Rp0r40+9CNDxM7G8laaZCamsYEinyoDYp1sa1I/aJSK4ita3Eo9J+Ze2fmv9g7yOWc22u3xJX0RZ7gd+ee7/M7h3mujE+EQ+O6cuOP58pf+qxyQ5kOR6LKgDKlPWaoQrOrxFhmv2e0yafnj025cCFmJSouzH4E/crcQBen+VoHH/Z1cVJq2kfzHFeVuTH35FxhaFbXIqCRnJ2YjV1JI0mWnUS5I2FQ7Ur2erxDHbT9FeE+wH0Y9wLuxbgKuCDfA7gH4epIF2dfET4M+DDGg4AHMR4APIBxP+B+N2JjA0p0pi+ZCo5cnCnXHpSpP3Ut+jSig07ruEGKSz3nysoc00SSywaVy3v2LochI/TFoZXPdWBIoJNokvqLDgz5JtVTYnA/wU2SL5CF/Q4M0TW/bpFSmnsPKivvzdYWL1MQktqg69xACBXdTNi1Je4OlIaz+YHkmhxH7mdrpFrkOPJoc5W+LnEcXLJeZsFIFXyy9nPkrIFSxPGPRboY43gQ6Z1Hzw9fN98lm+9xeCb0S5kyOvvkfzTf4pHVPJD7ZvGYfFuXmk/oG9XDPqguExV7O4bOAurFTdu+B9kR2989+1FNsyMVEUF8hcby+MyDzC9ba8I9FOLMa9NYwPogwwJdtO9BVTDHRTtRpbKG/M5OkCmwR/sMcVw2RZY/YZlwZsfi1kIa34NysEvfIJsIrtZI82/xltsfqFiuG7vnxp7RIiE9OtuX1naDdM23l0rLuBaJhsNTv5JxtYiuoWwVauSl0XO2SCrJbkjrDl0v0cKhvO4c7lutrNTpJHlqNjj5DV3hOMBLAeJozMNQYCK1IetSq86bD5LRjHlpng8VlIGVonWYkwMSX2KjQVrGnMoamPKDLQfVqDh5gjjcpF6Xtyi6tU02uhMAyS+8Mw0DbUv8+WzZWknJW5rI7CiSjWWSrP93Pt0hd00OlyOHidDko/78GUJbAqaG7+brtP4M6Yvtk8zH3pmh9JlUeNugnlz7ArC3T0Tkw51xERGJFfqTAnVa87T6T8+WeAZ95FNccnxoMAAwWBIcHAEY7FY9DDUbJbO+KK+zybJg1TmjtCvmUXg83J+CEWk5FI1ooUkdxyltkFdxmj/rOU6jozelIJGNpru1FmpAQ+D37dH7PE4qsvPe7btyftuE5ezknPgriXTvPPidy/H7ELlmd6yTHeEO0wPqH/52C2DoHzvZsqtHdvqAZE5lBiYrGbNZoAWDFnmPBS6uQv/VzT1mjDV/KsWPjV5n9113mwZ8r2V+fSuVIJsQNJ+WjRZmAX5/YBpLUiLYrIVJBvxon+yw2SEPGpYDmLX4dUDzgG5npEyKbwPQnrGepDAP2/09NvcvaIIuCAgUAAA=',
    headers: {
        'User-Agent': 'PC_UA'
    },
    timeout: 5000,
    cate_exclude: '会员|游戏|全部',
    class_name: '精选&电影&电视剧&综艺&动漫&少儿&纪录片',
    class_url: 'choice&movie&tv&variety&cartoon&child&doco',
    limit: 20,
    play_parse: true,
    推荐: async function () {
        let d = await _tyFetch('choice', 1, {});
        return setResult(d)
    },
    一级: async function () {
        let {MY_CATE, MY_PAGE, MY_FL} = this;
        let tid = MY_CATE || 'choice';
        let pg = parseInt(MY_PAGE) || 1;
        let d = await _tyFetch(tid, pg, MY_FL || {});
        return setResult(d)
    },
    二级: async function () {
        let {input, pdfh, pd, fetch_params} = this;
        let d = [];
        let VOD = {};
        let video_list = [];
        let video_lists = [];
        let list = [];
        let QZOutputJson;
        let html = await request(input);
        let sourceId = /get_playsource/.test(input) ? input.match(/id=(\d*?)&/)[1] : input.split("cid=")[1];
        let cid = sourceId;
        let detailUrl = "https://v.%71%71.com/detail/m/" + cid + ".html";
        log("详情页:" + detailUrl);
        try {
            let json = JSON.parse(html);
            VOD = {
                vod_url: input,
                vod_name: json.c.title,
                type_name: (json.typ || []).join(","),
                vod_actor: (json.nam || []).join(","),
                vod_year: json.c.year,
                vod_content: json.c.description,
                vod_remarks: json.rec || "",
                vod_pic: urljoin(input, json.c.pic)
            }
        } catch (e) {
            log("解析片名海报等基础信息发生错误:" + e.message)
        }
        if (/get_playsource/.test(input)) {
            eval(html);
            let indexList = QZOutputJson.PlaylistItem.indexList;
            for (const it of indexList) {
                let dataUrl = "https://s.video.qq.com/get_playsource?id=" + sourceId + "&plat=2&type=4&data_type=3&range=" + it + "&video_type=10&plname=qq&otype=json";
                eval(await fetch(dataUrl, fetch_params));
                let vdata = QZOutputJson.PlaylistItem.videoPlayList;
                vdata.forEach(function (item) {
                    d.push({
                        title: item.title,
                        pic_url: item.pic,
                        desc: item.episode_number + "\t\t\t播放量：" + item.thirdLine,
                        url: item.playUrl
                    })
                });
                video_lists = video_lists.concat(vdata)
            }
        } else {
            let json = JSON.parse(html);
            // 部分专辑（如《狂飙》）float_vinfo2 的 video_ids 为 null，直接取 length 会抛错
            video_lists = (json.c && json.c.video_ids) || [];
            if (!video_lists.length) {
                // 兜底：FillUnionInfo 能补一部分专辑的正片 vid
                try {
                    let body = JSON.stringify({cids: [cid], appid: '10001'});
                    let fu = JSON.parse(await request('https://pbaccess.video.qq.com/trpc.universal_backend_service.union_extra_data.UnionExtraData/FillUnionInfo?video_appid=3000010&vversion_platform=2&vversion_name=8.5.96', {
                        method: 'POST',
                        body: body,
                        headers: _TY.headers,
                        timeout: 8000
                    }));
                    let ci = (fu.data && fu.data.cover_infos && fu.data.cover_infos[cid]) || {};
                    video_lists = ci.video_ids || [];
                } catch (e) {
                    video_lists = [];
                }
            }
            let url = "https://v.qq.com/x/cover/" + sourceId + ".html";
            if (video_lists.length === 0) {
                // 版权/下架专辑拿不到正片列表，给一条可打开的详情入口，别让详情页空返回
                d.push({title: "在线播放", url: url});
            } else if (video_lists.length === 1) {
                let vid = video_lists[0];
                url = "https://v.qq.com/x/cover/" + cid + "/" + vid + ".html";
                d.push({
                    title: "在线播放",
                    url: url
                })
            } else if (video_lists.length > 1) {
                for (let i = 0; i < video_lists.length; i += 30) {
                    video_list.push(video_lists.slice(i, i + 30))
                }
                let t1 = (new Date()).getTime();
                let reqUrls = video_list.map(it => {
                    let o_url = "https://union.video.qq.com/fcgi-bin/data?otype=json&tid=1804&appid=20001238&appkey=6c03bbe9658448a4&union_platform=1&idlist=" + it.join(",");
                    return {
                        url: o_url,
                        options: {
                            timeout: rule.timeout,
                            headers: rule.headers
                        }
                    }
                });
                let htmls = await batchFetch(reqUrls);
                let t2 = (new Date()).getTime();
                log(`批量请求二级 ${detailUrl} 耗时${t2 - t1}毫秒:`);
                htmls.forEach((ht) => {
                    if (ht) {
                        eval(ht);
                        // QZOutputJson = JSON5.parse(ht.split('QZOutputJson=')[1].slice(0, -1));
                        // log(QZOutputJson)
                        QZOutputJson.results.forEach(function (it1) {
                            it1 = it1.fields;
                            let url = "https://v.qq.com/x/cover/" + cid + "/" + it1.vid + ".html";
                            d.push({
                                title: it1.title,
                                pic_url: it1.pic160x90.replace("/160", ""),
                                desc: it1.video_checkup_time,
                                url: url,
                                type: it1.category_map && it1.category_map.length > 1 ? it1.category_map[1] : ""
                            })
                        })
                    }
                });
            }
        }
        let yg = d.filter(function (it) {
            return it.type && it.type !== "正片"
        });
        let zp = d.filter(function (it) {
            return !(it.type && it.type !== "正片")
        });
        VOD.vod_play_from = yg.length < 1 ? "qq" : "qq$$$qq 预告及花絮";
        VOD.vod_play_url = yg.length < 1 ? d.map(function (it) {
            return it.title + "$" + it.url
        }).join("#") : [zp, yg].map(function (it) {
            return it.map(function (its) {
                return its.title + "$" + its.url
            }).join("#")
        }).join("$$$");
        return VOD
    },

    搜索: async function () {
        let {KEY, MY_PAGE} = this;
        let wd = KEY || '';
        let pg = parseInt(MY_PAGE) || 1;
        if (!wd) return setResult([]);
        // 腾讯搜索只有第 1 页（pagenum=0）带影视专辑，往后全是 UGC 短视频，直接返回空
        if (pg > 1) return setResult([]);
        let body = {
            version: '8.2.96',
            clientType: 1,
            filterValue: '',
            query: wd,
            pagenum: pg - 1,
            pagesize: 30,
            queryFrom: 0,
            isneedQc: true,
            preQid: '',
            sceneId: 0,
            searchDatakey: '',
            transInfo: '',
            adClientInfo: '',
            extraInfo: {
                isNewMarkLabel: '0',
                multi_terminal_pc: '1',
                themeType: '0',
                frontVersion: '26111906'
            },
            uuid: _TY.guid,
            retry: 0,
            featureList: ['DEFAULT_FEFEATURE', 'PC_SHORT_VIDEOS_WATERFALL', 'PC_WANT_EPISODE_V2', 'PC_WANT_EPISODE', 'RECOMMEND_AI_QUERY']
        };
        let html = await request(_TY.search, {
            method: 'POST',
            body: JSON.stringify(body),
            headers: _TY.headers,
            timeout: 8000
        });
        let json = {};
        try {
            json = JSON.parse(html);
        } catch (e) {
            log('腾云驾雾搜索接口解析失败:' + e.message);
            return setResult([]);
        }
        return setResult(_tySearchList(json));
    },
    lazy: async function () {
        let {input} = this;
        return {jx: 1, url: input}
    }
}
