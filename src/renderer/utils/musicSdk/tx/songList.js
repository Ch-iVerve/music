import { httpFetch } from '../../request'
import { decodeName, dateFormat, formatPlayCount } from '../../index'
import { createSong } from './utils/song'
import { txCgi, buildComm, requireCredential } from './utils/request'
import { pickSonglistTotal } from './utils/songlistTotal'
// 「我喜欢」的 dirId（201）与它的**真实 tid** 的解析都在 tx/user.js：读取侧（`getFavSong` 的
// `dirid`）与写侧（本文件的 `likeSong`）必须用同一个目录，常量只留一份。
import user, { FAV_DIR_ID } from './user'

/** 增删歌曲的端点（工单 09：判读与诊断都收在 `readWriteResult` 里）。 */
const SONG_WRITE_MODULE = 'music.musicasset.PlaylistDetailWrite'

/**
 * 分享链接的**域名白名单**（`handleParseId` 的闸）。
 *
 * 为什么必须有：`handleParseId` 直接拿外部串去 `httpFetch`，而它的入口之一是「贴一条分享链接」——
 * 深链 `chiverve-music://songlist/open?url=…`（以及 `page/open?songlist=…`）也能把**任意 URL**
 * 送到这里。不设闸就是一条**盲 SSRF**：请求不带凭证、响应也不回传，但足以让本机去 GET 内网 /
 * 本机 localhost 的任意端点（例如本应用自己的 OpenAPI `127.0.0.1:23330` 的 `/collect`、`/skip-next`）。
 *
 * 真链接都是 QQ 域的分享页（`y.qq.com` / `c6.y.qq.com` / `i.y.qq.com` …），所以按「`qq.com` 及其
 * 子域」放行。⚠️ 用锚定的正则而不是 `endsWith('qq.com')`：后者会放过 `notqq.com` 这种域。
 */
const isAllowedShareLink = (link) => {
  try {
    const url = new URL(link)
    return (url.protocol === 'http:' || url.protocol === 'https:') && /(^|\.)qq\.com$/.test(url.hostname)
  } catch {
    return false
  }
}

/**
 * 写接口要带的「我喜欢」tid——**拿不到就回 0**（= 旧行为）。
 *
 * 真机 A/B（2026-09-24）已证 **tid 不是成败变量**：给 0 时服务端会自己解析成真实 tid
 * （3802852742）并回显，`code` 一样是 0。留着它是因为它让「写哪个目录」显式化，也是唯一有
 * 完整记录的那次成功形状（M6 自建歌单往返传的是目标歌单自己的 tid）。解析失败**绝不能挡住写**，
 * 所以吞掉异常回落 0。⚠️ 别把这里的失败当成写失败——写失败的真因（comm 档案）在 `_writeSongList`。
 */
const favDirTid = async() => {
  try {
    return await user.getFavDirTid()
  } catch (err) {
    console.log('[tx] 取「我喜欢」的 tid 失败，按 tid=0 写', err)
    return 0
  }
}

/**
 * 判读写歌单接口的响应节点（**纯函数**，单测直接喂响应）。
 *
 * 响应是 `req_1` 节点，实测形状 `{ code: 0, data: { retCode: 0, result: {...} } }`
 * （M6 的四个写操作均经真机实测）。判据先看这两条：
 *
 *   1. **模块级 `code` 与 `data.retCode` 都是 0 才算成功**（数值或数值串都认）。
 *      两个都是「判据」不是「诊断」，缺一个就会出**假成功**：
 *      - 只看 `retCode`（2026-09-24 之前）：真机实测被拒的响应是
 *        `{ code: 80105, data: { retCode: 0, result: {...} } }`——`retCode` 照样是 0，
 *        于是界面报成功、还就地改了收藏态，QQ 侧却什么都没发生（用户原话「点后没加也没移除」）。
 *      - 旧实现还把 `retCode === 80092` 当成功。80092 的语义是猜的（注释写「歌单里没有这首歌」），
 *        而参考实现 `modules/songlist.py:152-155,186-189` 对 80092 **两个方向都返回 False**，
 *        且它的 docstring 明确说「已在歌单里」/「不在歌单里」这两种幂等情况走 `retCode 0`。
 *      → 本轮不给任何方向留例外：宁可让用户看到一句带码的失败，也不静默替服务端宣布成功。
 *   2. 判不出成功时，把 `code` / `retCode` / `msg` **原样带出去**。旧实现只回一个 false，
 *      连 QQ 的错误码都丢了；真机上「收藏点了没反应」时无从查起（本票的硬要求：
 *      失败必须能原样贴回来）。
 *
 * ⚠️ `Number(null) === 0`：缺字段（`null`/`undefined`/空串）必须算**缺失**而不是 0，
 * 否则「响应形状变了、连 code 都没有」会被读成成功。`toNum` 就是为这一条存在的。
 *
 * @returns {{ ok: boolean, code: number|null, retCode: number|null, msg: string }}
 */
const toNum = value => (value == null || value === '' ? Number.NaN : Number(value))

export const readWriteResult = node => {
  const code = toNum(node?.code)
  const retCode = toNum(node?.data?.retCode ?? node?.retCode)
  const msg = String(node?.data?.msg ?? node?.msg ?? '')
  return {
    ok: code === 0 && retCode === 0,
    code: Number.isFinite(code) ? code : null,
    retCode: Number.isFinite(retCode) ? retCode : null,
    msg,
  }
}

export default {
  _requestObj_tags: null,
  _requestObj_hotTags: null,
  _requestObj_list: null,
  limit_list: 36,
  limit_song: 100000,
  successCode: 0,
  sortList: [
    {
      name: '推荐',
      id: -1,
    },
    {
      name: '最热',
      id: 3,
    },
    {
      name: '最新',
      id: 2,
    },
  ],
  regExps: {
    hotTagHtml: /class="c_bg_link js_tag_item" data-id="\w+">.+?<\/a>/g,
    hotTag: /data-id="(\w+)">(.+?)<\/a>/,

    // https://y.qq.com/n/yqq/playlist/7217720898.html
    // https://i.y.qq.com/n2/m/share/details/taoge.html?platform=11&appshare=android_qq&appversion=9050006&id=7217720898&ADTAG=qfshare
    listDetailLink: /\/playlist\/(\d+)/,
    listDetailLink2: /id=(\d+)/,
  },
  tagsUrl: 'https://u.y.qq.com/cgi-bin/musicu.fcg?loginUin=0&hostUin=0&format=json&inCharset=utf-8&outCharset=utf-8&notice=0&platform=wk_v15.json&needNewCode=0&data=%7B%22tags%22%3A%7B%22method%22%3A%22get_all_categories%22%2C%22param%22%3A%7B%22qq%22%3A%22%22%7D%2C%22module%22%3A%22playlist.PlaylistAllCategoriesServer%22%7D%7D',
  hotTagUrl: 'https://c.y.qq.com/node/pc/wk_v15/category_playlist.html',
  getListUrl(id, page) {
    id = parseInt(id)
    return `https://u.y.qq.com/cgi-bin/musicu.fcg?loginUin=0&hostUin=0&format=json&inCharset=utf-8&outCharset=utf-8&notice=0&platform=wk_v15.json&needNewCode=0&data=${encodeURIComponent(JSON.stringify({
        comm: { cv: 1602, ct: 20 },
        playlist: {
          method: 'get_category_content',
          param: {
            titleid: id,
            caller: '0',
            category_id: id,
            size: this.limit_list,
            page: page - 1,
            use_page: 1,
          },
          module: 'playlist.PlayListCategoryServer',
        },
        }))}`
    // return `https://u.y.qq.com/cgi-bin/musicu.fcg?loginUin=0&hostUin=0&format=json&inCharset=utf-8&outCharset=utf-8&data=${encodeURIComponent(JSON.stringify({
    //       comm: { cv: 1602, ct: 20 },
    //       playlist: {
    //         method: 'get_playlist_by_tag',
    //         param: { id: 10000000, sin: this.limit_list * (page - 1), size: this.limit_list, order: sortId, cur_page: page },
    //         module: 'playlist.PlayListPlazaServer',
    //       },
    //   }))}`
  },
  getListDetailUrl(id) {
    return `https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg?type=1&json=1&utf8=1&onlysong=0&new_format=1&disstid=${id}&loginUin=0&hostUin=0&format=json&inCharset=utf8&outCharset=utf-8&notice=0&platform=yqq.json&needNewCode=0`
  },

  // http://nplserver.kuwo.cn/pl.svc?op=getlistinfo&pid=2849349915&pn=0&rn=100&encode=utf8&keyset=pl2012&identity=kuwo&pcmp4=1&vipver=MUSIC_9.0.5.0_W1&newver=1
  // 获取标签
  getTag(tryNum = 0) {
    if (this._requestObj_tags) this._requestObj_tags.cancelHttp()
    if (tryNum > 2) return Promise.reject(new Error('try max num'))
    this._requestObj_tags = httpFetch(this.tagsUrl)
    return this._requestObj_tags.promise.then(({ body }) => {
      if (body.code !== this.successCode) return this.getTag(++tryNum)
      return this.filterTagInfo(body.tags.data.v_group)
    })
  },
  // 获取标签
  getHotTag(tryNum = 0) {
    if (this._requestObj_hotTags) this._requestObj_hotTags.cancelHttp()
    if (tryNum > 2) return Promise.reject(new Error('try max num'))
    this._requestObj_hotTags = httpFetch(this.hotTagUrl)
    return this._requestObj_hotTags.promise.then(({ statusCode, body }) => {
      if (statusCode !== 200) return this.getHotTag(++tryNum)
      return this.filterInfoHotTag(body)
    })
  },
  filterInfoHotTag(html) {
    let hotTag = html.match(this.regExps.hotTagHtml)
    const hotTags = []
    if (!hotTag) return hotTags

    hotTag.forEach(tagHtml => {
      let result = tagHtml.match(this.regExps.hotTag)
      if (!result) return
      hotTags.push({
        id: parseInt(result[1]),
        name: result[2],
        source: 'tx',
      })
    })
    return hotTags
  },
  filterTagInfo(rawList) {
    return rawList.map(type => ({
      name: type.group_name,
      list: type.v_item.map(item => ({
        parent_id: type.group_id,
        parent_name: type.group_name,
        id: item.id,
        name: item.name,
        source: 'tx',
      })),
    }))
  },

  async getRecommendList(page) {
    const { body } = await httpFetch(
    `https://u.y.qq.com/cgi-bin/musicu.fcg?loginUin=0&hostUin=0&format=json&inCharset=utf-8&outCharset=utf-8&notice=0&platform=wk_v15.json&needNewCode=0&data=${encodeURIComponent(
      JSON.stringify({
        comm: { cv: 1602, ct: 20 },
        playlist: {
          module: 'music.playlist.PlaylistSquare',
          method: 'GetRecommendWhole',
          param: {
            IsReqFeed: true,
            FeedReq: {
              From: (page - 1) * this.limit_list,
              Size: this.limit_list,
            },
          },
        },
      }),
    )}`,
    ).promise
    if (body.code !== this.successCode) throw new Error('tx getRecommendList failed')
    return {
      list:
      body.playlist.data.FeedRsp.List?.map(({ Playlist }) => ({
        play_count: formatPlayCount(Playlist.basic.play_cnt),
        id: String(Playlist.basic.tid),
        author: decodeName(Playlist.basic.creator.nick),
        name: decodeName(Playlist.basic.title),
        time: Playlist.basic.modify_time ? dateFormat(Playlist.basic.modify_time * 1000, 'Y-M-D') : '',
        img: Playlist.basic.cover.medium_url || Playlist.basic.cover.default_url,
        total: Playlist.basic.song_cnt,
        desc: decodeName(Playlist.basic.desc).replace(/<br>/g, '\n'),
        source: 'tx',
      })) || [],
      total: body.playlist.data.FeedRsp.FromLimit,
      limit: this.limit_list,
      page,
      source: 'tx',
    }
  },

  // 获取列表数据
  getList(sortId, tagId, page, tryNum = 0) {
    if (this._requestObj_list) this._requestObj_list.cancelHttp()
    if (tryNum > 2) return Promise.reject(new Error('try max num'))
    if (!tagId) {
      if (!tagId && sortId == -1) return this.getRecommendList(page)
      tagId = sortId
    }
    this._requestObj_list = httpFetch(
      this.getListUrl(tagId, page),
    )
    // console.log(this.getListUrl(sortId, tagId, page))
    return this._requestObj_list.promise.then(({ body }) => {
      if (body.code !== this.successCode) return this.getList(sortId, tagId, page, ++tryNum)
      return this.filterList(body.playlist.data, page)
    })
  },

  // filterList(data, page) {
  //   return {
  //     list: data.v_playlist.map(item => ({
  //       play_count: formatPlayCount(item.access_num),
  //       id: String(item.tid),
  //       author: item.creator_info.nick,
  //       name: item.title,
  //       time: item.modify_time ? dateFormat(item.modify_time * 1000, 'Y-M-D') : '',
  //       img: item.cover_url_medium,
  //       // grade: item.favorcnt / 10,
  //       total: item.song_ids?.length,
  //       desc: decodeName(item.desc).replace(/<br>/g, '\n'),
  //       source: 'tx',
  //     })),
  //     total: data.total,
  //     page,
  //     limit: this.limit_list,
  //     source: 'tx',
  //   }
  // },
  filterList({ content }, page) {
    // console.log(content.v_item)
    return {
      list: content.v_item.map(({ basic }) => ({
        play_count: formatPlayCount(basic.play_cnt),
        id: String(basic.tid),
        author: basic.creator.nick,
        name: basic.title,
        // time: basic.publish_time,
        img: basic.cover.medium_url || basic.cover.default_url,
        // grade: basic.favorcnt / 10,
        desc: decodeName(basic.desc).replace(/<br>/g, '\n'),
        source: 'tx',
      })),
      total: content.total_cnt,
      page,
      limit: this.limit_list,
      source: 'tx',
    }
  },

  async handleParseId(link, retryNum = 0) {
    // 闸装在 sink 上：只在深链入口做动作白名单挡不住已知之外的向量（理由见 isAllowedShareLink）
    if (!isAllowedShareLink(link)) throw new Error('link not allowed')
    if (retryNum > 2) return Promise.reject(new Error('link try max num'))

    const requestObj_listDetailLink = httpFetch(link)
    const { headers: { location }, statusCode } = await requestObj_listDetailLink.promise
    // console.log(headers)
    if (statusCode > 400) return this.handleParseId(link, ++retryNum)
    return location == null ? link : location
  },

  async getListId(id) {
    if ((/[?&:/]/.test(id))) {
      if (!this.regExps.listDetailLink.test(id)) {
        id = await this.handleParseId(id)
      }
      let result = this.regExps.listDetailLink.exec(id)
      if (!result) {
        result = this.regExps.listDetailLink2.exec(id)
        if (!result) throw new Error('failed')
      }
      id = result[1]
      // console.log(id)
    }
    return id
  },
  // 获取歌曲列表内的音乐
  async getListDetail2(id, tryNum = 0) {
    if (tryNum > 2) return Promise.reject(new Error('try max num'))

    const requestObj_listDetail = httpFetch('https://u.y.qq.com/cgi-bin/musicu.fcg', {
      method: 'post',
      headers: {
        Origin: 'https://y.qq.com',
        Referer: `https://y.qq.com/n/yqq/playsquare/${id}.html`,
      },
      body: {
        comm: {
          cv: 4747474,
          ct: 24,
          format: 'json',
          inCharset: 'utf-8',
          outCharset: 'utf-8',
          platform: 'yqq.json',
          needNewCode: 1,
          uin: 0,
        },
        req_1: {
          module: 'music.srfDissInfo.aiDissInfo',
          method: 'uniform_get_Dissinfo',
          param: {
            disstid: parseInt(id),
            userinfo: 1,
            tag: 1,
            orderlist: 1,
            song_begin: 0,
            song_num: this.limit_song,
            onlysonglist: 0,
            enc_host_uin: '',
          },
        },
      },
    })
    const { body } = await requestObj_listDetail.promise
    // console.log(body)
    if (body.code !== this.successCode) return this.getListDetail2(id, ++tryNum)
    if (body.req_1.code !== this.successCode) throw new Error('failed')

    const result = body.req_1.data
    const dirinfo = result.dirinfo
    return {
      list: this.filterListDetail(result.songlist),
      page: 1,
      limit: this.limit_song,
      total: result.total_song_num,
      source: 'tx',
      info: {
        name: dirinfo.title,
        img: dirinfo.picurl,
        desc: decodeName(dirinfo.desc ?? '').replace(/<br>/g, '\n'),
        author: dirinfo.host_nick,
        play_count: formatPlayCount(dirinfo.listennum),
      },
    }
  },
  /**
   * 获取歌曲列表内的音乐（单页）。
   *
   * ⚠️ 第 2 个参数是**页码**，不是重试次数：store 侧 `getListDetail(id, source, page)` 把它原样
   * 传进来（`store/songList/action.ts`），重试计数收在第 3 个参数。旧签名 `(id, tryNum = 0)`
   * 把页码当重试数用（第 3 页起 `tryNum > 2` 直接 reject），回退到 CGI 时又不透传页码
   * （只按默认 page=1 取）——第 2 页会拿回第 1 页的数据，`getListDetailAll`（播放全部 /
   * 收藏整张歌单 / 同步）在第 3 页整条失败（2026-09-26 审查）。
   *
   * @param {string} id 歌单 id 或分享链接
   * @param {number} page 页码（从 1 起）
   * @param {number} tryNum 重试次数
   */
  async getListDetail(id, page = 1, tryNum = 0) {
    if (tryNum > 2) return Promise.reject(new Error('try max num'))

    // eslint-disable-next-line require-atomic-updates
    id = await this.getListId(id)

    const requestObj_listDetail = httpFetch(this.getListDetailUrl(id), {
      headers: {
        Origin: 'https://y.qq.com',
        Referer: `https://y.qq.com/n/yqq/playsquare/${id}.html`,
      },
    })
    const { body } = await requestObj_listDetail.promise

    // console.log(body)
    if (body.code !== this.successCode) return this.getListDetail(id, page, ++tryNum)
    // 主路径是 fcg_ucc（带 Referer 实测对**普通歌单**回 cdlist，2026-09-26 复核）。
    // 下面这条回退链是**兜底**，不是普通歌单的常走分支：`subcode` 非 0 或响应里没有 cdlist
    // （服务端字段形态变化 / 取不到的个别歌单）时才启用——先走登录态的 CgiGetDiss
    // （实测 disstid=tid + dirid=0 对 dir 型同样有效），最后才落到 legacy 的访客端点。
    // ⚠️ 回退也必须**按页取**：CGI 端点支持 song_begin/song_num，页码必须透传，
    // 否则第 2 页起会拿回第 1 页的数据（`getListDetail` 的签名注释里有这次审查的记录）。
    if (body.subcode !== this.successCode || !body.cdlist) {
      return this.getListDetailByCgi(id, page).catch(() => this.getListDetail2(id))
    }
    const cdlist = body.cdlist[0]
    return {
      list: this.filterListDetail(cdlist.songlist),
      page: 1,
      limit: cdlist.songlist.length + 1,
      total: cdlist.songlist.length,
      source: 'tx',
      info: {
        name: cdlist.dissname,
        img: cdlist.logo,
        desc: decodeName(cdlist.desc).replace(/<br>/g, '\n'),
        author: cdlist.nickname,
        play_count: formatPlayCount(cdlist.visitnum),
      },
    }
  },
  filterListDetail(rawList) {
    // console.log(rawList)
    return rawList.map(item => {
      return createSong(item)
    })
  },

  /**
   * 歌单详情的登录态取法：`music.srfDissInfo.DissInfo/CgiGetDiss`，
   * `disstid` 直接传歌单的 **tid**、`dirid` 传 0。
   *
   * 实测（2026-09-22）：`disstid=3802852742 & dirid=0` 能读到「我喜欢」
   * （`code 0` + `dirinfo.title` + `songlist`），而 legacy 的 `fcg_ucc_getcdinfo_byids_cp`
   * 与 `srfDissInfo.aiDissInfo` 对这类 **dir 型**歌单都取不到歌曲——所以它是回退链里
   * 让"点开自己的歌单"能用的那一环。
   *
   * ⚠️ 别把 2026-09-22 的结论外推成「fcg 对普通歌单也取不到」：2026-09-26 复核时带
   * `Referer` 打 `fcg_ucc_getcdinfo_byids_cp`，**普通歌单是回 cdlist 的**（`getListDetail`
   * 的主路径就是它）；这里只是普通歌单取不到 cdlist 时的**兜底**，且是云端自建歌单
   * （`store/user/action.ts` 的 `loadCloudListSongs`）的直接读法。
   *
   * @param {string} id 歌单 tid
   * @param {number} page 页码（从 1 起）——`song_begin = num * (page - 1)`，必须透传，别固定按第 1 页取
   * @param {number} num 每页条数
   */
  async getListDetailByCgi(id, page = 1, num = 30) {
    const credential = await requireCredential()
    const data = await txCgi({
      module: 'music.srfDissInfo.DissInfo',
      method: 'CgiGetDiss',
      param: {
        disstid: Number(id),
        dirid: 0,
        tag: true,
        song_begin: num * (page - 1),
        song_num: num,
        userinfo: true,
        orderlist: true,
        enc_host_uin: credential.encryptUin,
      },
    }, buildComm(credential)).promise
    const d = data?.data ?? {}
    const list = (d.songlist ?? []).map(createSong)
    if (!list.length) throw new Error('歌单为空或不可读')
    const dir = d.dirinfo ?? {}
    return {
      list,
      page,
      limit: num,
      // 总数只能取 total_song_num：songlist_size 是**本页返回条数**（参考实现 models/songlist.py:55,63），
      // 取错会让分页永远停在第 1 页（每页 30 条时总数就显示 30）。口径与兜底实现在 utils/songlistTotal.js
      total: pickSonglistTotal(d, list.length),
      source: 'tx',
      info: {
        name: dir.title ?? '',
        img: dir.picurl ?? '',
        desc: dir.desc ?? null,
        author: '',
        play_count: '',
      },
    }
  },
  getTags() {
    return Promise.all([this.getTag(), this.getHotTag()]).then(([tags, hotTag]) => ({ tags, hotTag, source: 'tx' }))
  },

  async getDetailPageUrl(id) {
    id = await this.getListId(id)

    return `https://y.qq.com/n/ryqq/playlist/${id}`
  },

  search(text, page, limit = 20, retryNum = 0) {
    if (retryNum > 5) throw new Error('max retry')
    return httpFetch(`http://c.y.qq.com/soso/fcgi-bin/client_music_search_songlist?page_no=${page - 1}&num_per_page=${limit}&format=json&query=${encodeURIComponent(text)}&remoteplace=txt.yqq.playlist&inCharset=utf8&outCharset=utf-8`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MSIE 9.0; Windows NT 6.1; WOW64; Trident/5.0)',
        Referer: 'http://y.qq.com/portal/search.html',
      },
    })
      .promise.then(({ body }) => {
        if (body.code != 0) return this.search(text, page, limit, ++retryNum)
        // console.log(body.data.list)
        return {
          list: body.data.list.map(item => {
            return {
              play_count: formatPlayCount(item.listennum),
              id: String(item.dissid),
              author: decodeName(item.creator.name),
              name: decodeName(item.dissname),
              time: dateFormat(item.createtime, 'Y-M-D'),
              img: item.imgurl,
              // grade: item.favorcnt / 10,
              total: item.song_count,
              desc: decodeName(decodeName(item.introduction)).replace(/<br>/g, '\n'),
              source: 'tx',
            }
          }),
          limit,
          total: body.data.sum,
          source: 'tx',
        }
      })
  },

  // ── 我的歌单写操作（M6）──────────────────────────────────────────────
  //
  // 端点对照 QQMusicApi `modules/songlist.py:79-229`。都是登录态接口，凭证与 comm
  // 走 tx/utils/request（`authst` 注入在 buildComm 里）。返回 code 语义：
  // retCode 0 = 成功；80092 = 歌单里没有这首歌（删除时视为已达目标状态，不算失败）。

  /**
   * 创建歌单。重名不会失败（服务端自行加时间戳）。
   * 返回 `{ dirId, tid, name }`——**实测**新歌单的 dirId/tid 在 `data.result` 里，
   * 不在 `data.dirId`（那是删除接口的回显字段）。加歌/移歌要用返回的 `tid`。
   *
   * `dirPicUrl` 是**可选的自定义封面**（`tx/upload.js` 直传 COS 拿回的 CDN 地址）。
   * 2026-09-26 真机实测（探针 `scripts/verify/probe-qq/probe_upload.py --stage verify`）：
   * `AddPlaylist` 带 `dirPicUrl` 建出来的歌单，回读 `GetPlaylistByUin` 的 `picUrl` **就是这张图**；
   * 对照组（不带该参数）回读封面为空。所以「带封面新建」只能走**建的时候**传：
   * `EditPlaylist`（改已有歌单的封面）同日实测四个参数名 + 老版 web 完整载荷全是 `code: 1101`、
   * 回显 `dirId: 0`，改不动——别往那条路上想办法。
   */
  async createList(dirName, dirPicUrl) {
    const credential = await requireCredential()
    const param = { dirName: String(dirName ?? '') }
    // 只在真给了封面时才带上（少一个字段少一份被服务端当成「要清空封面」的风险）
    if (dirPicUrl) param.dirPicUrl = String(dirPicUrl)
    const data = await txCgi({
      module: 'music.musicasset.PlaylistBaseWrite',
      method: 'AddPlaylist',
      param,
    }, buildComm(credential)).promise
    const result = data?.data?.result ?? data?.result ?? {}
    const dirId = Number(result.dirId ?? 0)
    if (!dirId) throw new Error('创建歌单失败')
    return { dirId, tid: Number(result.tid ?? 0), name: result.dirName ?? String(dirName ?? '') }
  },

  /** 删除自建歌单。成功时 `result.dirId` 回显被删的 dirId；删不存在的歌单返回 0。 */
  async removeList(dirId) {
    const credential = await requireCredential()
    const data = await txCgi({
      module: 'music.musicasset.PlaylistBaseWrite',
      method: 'DelPlaylist',
      param: { dirId: Number(dirId) },
    }, buildComm(credential)).promise
    const result = data?.data?.result ?? data?.result ?? {}
    return Number(result.dirId ?? 0) !== 0
  },

  /**
   * 往自建歌单里加歌。
   * `songs` 每项要 `{ songId, songType }`——`songType` 是 QQ 的原始 `type`，
   * 工厂（utils/song.js）已把它放在歌曲对象上，直接传 `musicInfo.songId/songType` 即可。
   *
   * 返回 `readWriteResult` 的那个结构（`{ ok, code, retCode, msg }`），**不是裸布尔**：
   * 失败时调用方要靠 `code`/`retCode` 说清是哪一步被拒（工单 09）。
   */
  async addSongToList(dirId, songs, tid = 0) {
    return this._writeSongList('AddSonglist', dirId, songs, tid)
  },

  /** 从自建歌单里移除歌曲。参数同 addSongToList。 */
  async removeSongFromList(dirId, songs, tid = 0) {
    return this._writeSongList('DelSonglist', dirId, songs, tid)
  },

  /**
   * 收藏歌曲到 QQ 的「我喜欢」。
   *
   * dirId 固定 201（与 `tx/user.js` 的 `getFavSong` 读取侧同一个目录，常量从那里导入），
   * comm 走安卓档案（`_writeSongList` 里按 dirId 分档，那里记着 A/B 证据）。
   *
   * tid 用**运行时解析出来的真实 tid**（`user.getFavDirTid()`，拿不到回 0）。2026-09-24 的 A/B
   * 已证 **tid 不是成败变量**（给 0 服务端自己解析成 3802852742，一样 `code: 0`），真正卡住的是
   * comm 档案；但带上真实 tid 让请求「指哪个目录」显式化，且这是唯一有完整记录的那次成功形状
   * （M6 自建歌单往返传的就是目标自己的 tid），所以留着。解析失败只回落 0，**绝不挡写**。
   *
   * 失败不再只回 false：诊断信息由 `readWriteResult` 带出，调用方（store/user/action.ts）
   * 必须把它塞进报错文案，别静默吞掉。
   */
  async likeSong(songs) {
    return this.addSongToList(FAV_DIR_ID, songs, await favDirTid())
  },

  /** 从 QQ「我喜欢」移除（参考实现 songlist.unlike_song，同一端点只换 method）。 */
  async unlikeSong(songs) {
    return this.removeSongFromList(FAV_DIR_ID, songs, await favDirTid())
  },

  /**
   * 收藏 / 取消收藏（他人的）歌单（工单 08）。
   *
   * `music.musicasset.PlaylistFavWrite` 的 `FavPlaylist` / `CancelFavPlaylist`，
   * 参数是 `{ uin: encryptUin, v_playlistId: [数字 tid] }`——**tid 不是自建歌单的 dirId**。
   * 实测 code=0、`result: 0`、`v_failedPlaylistId: []`。
   */
  async setFavPlaylist(tid, fav) {
    const credential = await requireCredential()
    const numericId = Number(tid)
    if (!numericId) throw new Error('缺少歌单数字 id')
    const data = await txCgi({
      module: 'music.musicasset.PlaylistFavWrite',
      method: fav ? 'FavPlaylist' : 'CancelFavPlaylist',
      param: { uin: credential.encryptUin, v_playlistId: [numericId] },
    }, buildComm(credential)).promise
    const result = data?.data ?? {}
    const failed = result.v_failedPlaylistId ?? []
    return Number(result.result ?? 0) === 0 && !failed.map(Number).includes(numericId)
  },

  /**
   * 增删歌曲的公共实现（两者只差 method）。返回 `readWriteResult` 的结构（含诊断）。
   *
   * ⚠️ **comm 档案按 dirId 分档**（工单 09 的真机 A/B，2026-09-24）：
   *   - `dirId=201`（「我喜欢」）**必须走安卓档案**（`ct: 11, cv: 14090008, v, chid`）。用 WEB
   *     档案（`ct: 24, cv: 0`）时服务端**解析不出目标目录**——响应回显 `dirId: 0 / tid: 0 /
   *     dirName: ""`，模块级 `code: 80105`，`data.retCode` 却照旧是 0（读侧总数纹丝不动）。
   *     `tid` 给 0 或给真实的 3802852742、`songType` 给 0/1/13 都不改变这个结果 → 变量只有档案。
   *     同一份 payload 换安卓档案后：`code: 0`、回显 `dirId: 201 / dirName: "我喜欢" /
   *     tid: 3802852742`，读侧总数 928 → 929；删除方向同样 `code: 0`、总数回到 928。
   *   - 自建歌单（`dirId` 非 201）**维持 WEB 档案**：这条路有 M6 的受控往返记录，且 2026-09-24
   *     用同一 payload 复验过一次（建临时歌单 → 加新歌 → 回读 songNum 1 → 删歌单，`code: 0`）。
   *     安卓档案在自建歌单上**没有实测记录**——没测过的不动。
   */
  async _writeSongList(method, dirId, songs, tid = 0) {
    const credential = await requireCredential()
    const v_songInfo = (songs ?? []).map(song => ({
      songId: Number(song.songId),
      songType: Number(song.songType ?? 0),
    }))
    if (!v_songInfo.length) throw new Error('未选择歌曲')
    const numericDirId = Number(dirId)
    const numericTid = Number(tid)
    const commProfile = numericDirId === FAV_DIR_ID ? 'android' : 'web'
    const node = await txCgi({
      module: SONG_WRITE_MODULE,
      method,
      param: {
        dirId: numericDirId,
        tid: numericTid,
        bFmtUtf8: true,
        v_songInfo,
      },
    }, buildComm(credential, commProfile)).promise
    const result = readWriteResult(node)
    if (!result.ok) {
      // 诊断一行：只有请求形状与 QQ 的错误码，凭证/签名（authst、musickey）一律不进日志。
      // 真机上「点了没反应」时要的就是这一行（票面把它的位置写给用户）。
      // `comm` 是档案名（web/android）——2026-09-24 那次假成功的变量就是它，别再漏掉。
      console.log('[tx] 写歌单被拒', {
        module: SONG_WRITE_MODULE,
        method,
        comm: commProfile,
        dirId: numericDirId,
        tid: numericTid,
        songs: v_songInfo,
        code: result.code,
        retCode: result.retCode,
        msg: result.msg,
      })
    }
    return result
  },
}

// getList
// getTags
// getListDetail
