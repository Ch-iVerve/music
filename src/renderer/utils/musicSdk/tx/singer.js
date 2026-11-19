import { httpFetch } from '../../request'
import { formatPlayTime, dateFormat } from '../../index'
import { requestMsg } from '../../message'
import { getQQCredential } from '@renderer/utils/ipc'
import { hash33 } from '@common/utils/qqSign'
import { createSong } from './utils/song'
import user from './user'

/**
 * 歌手页（M6）：歌手信息 / 专辑 / 歌曲 / 相似歌手 / 歌手 MV / **关注态（读侧）**。
 *
 * 端点与参数按 `QQMusicApi/qqmusic_api/modules/singer.py` 抄，并**逐条真机核对过响应
 * 结构**（记录见 spec §5.4）。下面五条是实测结论，改这个文件前先读：
 *
 *   1. `GetSingerDetail` 的参数键是 **`singer_mids`（复数、数组）**：写单数 `singer_mid`
 *      会被模块直接拒掉（`code=104400`，`singer_list` 为空）；`ex_singer`/`wiki_singer`/
 *      `group_singer`/`pic`/`photos` 必须是**数字** 0/1，写布尔值同样被拒（`code=10006`）。
 *   2. 专辑/歌曲列表条数的键是 **`num`**：Python 里的 `number` 实测被忽略（服务端按默认
 *      30 条返回），照抄 Python 的键反而拿不到指定条数。
 *   3. 两个计数键名不同：专辑数在 `GetAlbumList` 的 `data.total`，歌曲数在
 *      `GetSingerSongList` 的 `data.totalNum`——别互换。
 *   4. `GetSingerSongList` 的列表项是 `{ songInfo }` 包了一层。
 *   5. 相似歌手 `music.SimilarSingerSvr/GetSimilarSingerList`、歌手 MV
 *      `MvService.MvInfoProServer/GetSingerMvList` 都返回真实数据（已在真机核对）。
 *
 * 这些都是匿名可访问的公开端点，所以走匿名 comm 的 `createMusicuFetch`，不依赖登录态；
 * 歌曲对象统一由 `./utils/song` 的 `createSong` 构造（别再手写字段映射）。
 *
 * ⚠️ **唯一例外是关注态**（`getFollowState`）：它必须带登录态，走 `./user` 的账号接口。
 * 判据通道为什么不是「搜索接口的 `concern_status`」，见 `getFollowState` 上方的长注释
 * （2026-09-26 真机实测：那条路要凭证，且搜索模块一压就空）。
 */

const MUSICU_URL = 'https://u.y.qq.com/cgi-bin/musicu.fcg'
const successCode = 0

/**
 * 发一次 musicu.fcg 请求（匿名 comm）。
 *
 * 错误处理两点：**取消**要原样抛出去（否则会被重试吞掉，调用方的 `取消http请求` 判断
 * 失效），其它错误/非 0 code 才重试。
 */
const createMusicuFetch = async(data, retryNum = 0) => {
  if (retryNum > 3) throw new Error('try max num')

  let result
  try {
    result = await httpFetch(MUSICU_URL, {
      method: 'POST',
      body: {
        comm: {
          cv: 4747474,
          ct: 24,
          format: 'json',
          inCharset: 'utf-8',
          outCharset: 'utf-8',
          // uin 用字符串：数字型 uin 会被部分模块拒（M3 实测 code=10006）
          uin: '0',
        },
        ...data,
      },
      headers: {
        // 原实现拼成了 'User-Angent'（无效头），这里修正
        'User-Agent': 'Mozilla/5.0 (compatible; MSIE 9.0; Windows NT 6.1; WOW64; Trident/5.0)',
      },
    }).promise
  } catch (err) {
    if (err?.message === requestMsg.cancelRequest) throw err
    return createMusicuFetch(data, ++retryNum)
  }
  if (result.statusCode !== 200 || result.body.code != successCode) return createMusicuFetch(data, ++retryNum)

  return result.body
}

/**
 * 关注列表一次拉的粒度。**1000 是实测过的**：本账号 604 人在 `Size=1000` 时一次全回来
 * 且 `HasMore=false`（`From`/`Size` 是偏移量分页，`Size=200` 时同一份列表要拉 4 页）。
 * 服务器没有在 200 处截断（200 只是「一页 200 条」的语义）。
 */
const FOLLOW_PAGE_SIZE = 1000
/** 页数硬上限（防 `HasMore` 异常时死循环；5000 位歌手远超出正常用量，撞上会留日志）。 */
const FOLLOW_MAX_PAGES = 5

/**
 * 关注动态一轮扫描里，**一个请求最多塞几个 module**。
 *
 * **30 是实测上限**（2026-09-26 探针，记录在 `scripts/verify/artifacts/2026-09-26-new-release-probe/`）：
 * 20/25/30 个条目全数返回各自的数据，**31 起整个请求失败**——顶层 `code=500000`，
 * 所有键都只回 `{code:500000}` 且不带 `data`（不是「部分键缺失」，是整包被拒）。
 * 604 位关注歌手因此是 21 个请求；别把它当成「越大越省」的起点去试。
 */
export const FOLLOW_FEED_BATCH_SIZE = 30

/**
 * 会话内缓存：关注歌手的**行**（mid + name）。
 * `null` = 还没拉过（失败或写侧改动后也清回 null）。
 *
 * 存行而不是只存一个 mid 集合：关注动态的条目要写歌手的**名字**，而名字**不能**用来判成员
 * （见 `fetchFollowedSingers` 里的注释）——两份数据同源同缓存，别为名字再拉一次关注列表。
 */
let followedSingers = null
/** 由上面那批行派生的 mid 集合（关注态判成员走它；热路径不必每次重建 Set） */
let followedSingerMids = null
/** 在途的那次拉取（单飞：同一次会话里多个歌手页同时开也只打一次接口）。 */
let followedSingersInflight = null

const fetchFollowedSingers = async() => {
  const rows = []
  const seen = new Set()
  for (let page = 1; page <= FOLLOW_MAX_PAGES; page++) {
    // 复用账号模块（`user.js` 的 `getFollowSingers`）：端点与参数形状只留一处，
    // 别在这里再抄一遍 `music.concern.RelationList/GetFollowSingerList`（那会多一份要维护的拼写）
    const res = await user.getFollowSingers(page, FOLLOW_PAGE_SIZE)
    res.list.forEach(item => {
      // 没有 mid 的行判不了成员（mid 是唯一判据，名字不能用来比）：留一行日志便于定位。
      // 实测本账号 604/604 行都有 MID；真出现时空缺的那位会被判成「未关注」——已知代价，
      // 不改成「整表作废」（那会把所有未关注歌手都变成不显示）
      if (!item.id) {
        console.log('[tx] 关注列表有一行没有 mid，该歌手的关注态无法判定')
        return
      }
      const mid = String(item.id)
      // 跨页去重：判停用的是 `seen.size`，重复行会让它永远够不到总数而多翻几页
      if (seen.has(mid)) return
      seen.add(mid)
      rows.push({ mid, name: String(item.name ?? '') })
    })
    // 停的三个条件：服务端说没有更多 / 空页（防服务端忽略游标把同一页又给一遍）/ 够数了
    if (!res.hasMore || !res.list.length || (res.total && seen.size >= res.total)) return rows
  }
  console.log('[tx] 关注歌手的总数撞到页数上限，可能截断', { singers: rows.length, maxPages: FOLLOW_MAX_PAGES })
  return rows
}

/**
 * 关注歌手的**全量行**（mid + name）。
 *
 * 关注态（`getFollowState`）与关注动态共用这一处缓存与这**一个在途请求**：
 * 一轮检查与一次歌手页打开都指到这里，所以 `GetFollowSingerList` 不会被打两遍。
 */
const loadFollowedSingers = () => {
  if (followedSingers) return Promise.resolve(followedSingers)
  if (!followedSingersInflight) {
    followedSingersInflight = fetchFollowedSingers().then(
      rows => {
        followedSingers = rows
        followedSingerMids = new Set(rows.map(row => row.mid))
        followedSingersInflight = null
        return rows
      },
      err => {
        // 失败**不留缓存**：下次进歌手页会重试（与 useSinger 的 loadedMid「失败不写」同一条纪律）
        followedSingersInflight = null
        throw err
      },
    )
  }
  return followedSingersInflight
}

const loadFollowedSingerMids = async() => {
  await loadFollowedSingers()
  return followedSingerMids
}

/**
 * 把 `GetSingerSongList` 的原始条目转成关注动态要的两样东西：**老式歌曲对象**（仍然交给
 * `createSong`，别手写字段映射）+ **发布时间**。
 *
 * 为什么把 `publishTime` 单拎出来、而不是给 `createSong` 加一个字段：`time_public` 只有关注动态用，
 * 而 `createSong` 是全应用共用的工厂——加了就得连带 `toNewMusicInfo` / `toOldMusicInfo` 一起补
 * （见 CONTEXT 的「新增平台字段必须两边都补」），为一个字段动那三处不划算。
 * 落库时 `publishTime` 本来就是独立的一列，所以这个形状与存储是对齐的。
 */
const toFeedSong = (raw) => {
  if (!raw?.mid) return null
  return {
    song: createSong(raw),
    publishTime: String(raw.time_public ?? ''),
  }
}

/**
 * 关注 / 取关的老式 h5 端点——**写通道只有这一条**。
 *
 * 现代网关没有关注写方法（50 方法 × 22 模块枚举全灭，又用本机 fork 的全部 refs 复核过），
 * 所以只能走 `c.y.qq.com` 的这两个老 fcgi：cookie 里要**网页会话**（`uin` + `p_skey`），
 * CSRF 用 `g_tk = hash33(p_skey, 5381)`。决策：持久化网页会话 p_skey（明文凭证，0600）。
 * 端点细节以真机实测为准。
 */
const H5_FOLLOW_ADD = 'https://c.y.qq.com/rsc/fcgi-bin/fcg_order_singer_add.fcg'
const H5_FOLLOW_DEL = 'https://c.y.qq.com/rsc/fcgi-bin/fcg_order_singer_del.fcg'

/** h5 通道用**普通浏览器 UA**（§8.1 请求身份：既不冒充官方客户端，更不自报第三方客户端）。 */
const H5_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

/**
 * h5 的响应可能是对象、也可能是字符串（老端点的 `outCharset` 是 gb2312，needle 未必按 JSON 解）。
 * 解不出来就给空对象——调用方按「没有 code」处理成 unknown，不猜成成功。
 */
const parseH5Body = (body) => {
  if (body == null) return {}
  if (typeof body === 'string') {
    try {
      return JSON.parse(body)
    } catch {
      return {}
    }
  }
  return body
}

/**
 * 把 h5 的响应分类成界面能用的原因；`null` = 成功。
 *
 * ⚠️ **已知与未知**：`1006 g_token is wrong` 是 ADR-0010 记下的会话不对形状（本仓探针实测过）；
 * `1000`（= 未登陆）来自参考实现 `jsososo/QQMusicApi` 的 `routes/user.js`（它按 `case 1000` 判未登录，
 * **本仓没有实测过**，所以注释标明出处）。频控的 code 同样**没有实测过**（探针当时连写都没写进去），
 * 这里只认 `104604`（登录/账号级限流的实测码）与文案里的「频繁/太快/rate」，
 * 其余一律落 `unknown` 并把服务端原文带回去——**不猜、不假装知道**。
 */
const classifyH5Write = (resp) => {
  const code = Number(resp?.code)
  if (code === 0) return null
  const msg = String(resp?.msg ?? resp?.message ?? '')
  if (code === 1006 || code === 1000 || /g_token|未登[录陆]/i.test(msg)) return 'web-session-expired'
  if (code === 104604 || /频繁|太快|rate/i.test(msg)) return 'rate-limited'
  return 'unknown'
}

/**
 * 关注列表缓存作废 —— **写侧（关注 / 取关）成功后必须调用**。
 *
 * 缓存是会话级的（读侧不想为每个歌手页各打一次接口，也不想象素级刷新列表），
 * 所以写操作改了关注关系后，这里不清就会让整轮会话的标记停在旧值上。
 * 写侧还没落地（票 02 只做了读侧），这个导出是留给它的接口，不是死代码。
 */
export const clearFollowSingerCache = () => {
  followedSingers = null
  followedSingerMids = null
  followedSingersInflight = null
}

export default {
  /**
   * 「我关注了这位歌手没」——歌手页的**只读**关注态（读侧）。
   *
   * ## 判据通道：全量关注列表 + mid 集合成员判定（不是搜索接口的 `concern_status`）
   *
   * spec 里用户选的是「搜索接口现查」（`search_type=1` 的每条带 `concern_status`），
   * 2026-09-26 实现时**先按那条路真机试过**，三条实测把它否掉了（记录：
   * `scripts/verify/artifacts/2026-09-26-capabilities/NOTES-follow-read.md`）：
   *
   *   1. **匿名搜的 `concern_status` 恒为 0**（本账号关注了周杰伦，访客 comm 搜回来仍是 0）
   *      ——要拿真值必须带凭证再用**另一套**请求形状打搜索模块；而本仓既有的搜索入口
   *      （`musicSearch.js`）是访客档案，`concern_status` 直接读会**把已关注显示成未关注**。
   *   2. **按名搜不一定命中**：60 个已关注样本里 1 个名字（`ROSÉ (로제)`）搜回来 0 条，
   *      只能落「不可判」；同名歌手本身不是问题（按 mid 精确匹配）。
   *   3. 更关键：搜索模块**一压就空**——连续 ~100 次请求后，`search_type` 0/1 全都
   *      `code=0 且 data=None`，三种载体（musicu+web 凭证 / musicu+访客 / musics 签名）
   *      与两条 search_type 一致，而同一时刻 `GetSingerDetail` / `GetFollowSingerList`
   *      照常 `code=0`；20 分钟后仍未恢复。浏览歌手页正是「连续多次」的场景。
   *
   * 全量通道（本实现）：`GetFollowSingerList` + `Size=1000` **一次请求**把整个关注列表拉回来
   * （本账号 604 人，`HasMore=false`），按 mid 判成员——不依赖名字、不依赖搜索模块，
   * 且会话内缓存后比「每个歌手页搜一次」更省请求（铺开时同样受益：调用方直接复用这个集合）。
   *
   * ## 返回值三态（这条是契约，界面与测试都按它走）
   *
   * - `true`  = 已关注（mid 在集合里）
   * - `false` = 未关注（列表拿到了，mid 不在集合里）
   * - `null`  = **取不到**（未登录 / 请求失败）——界面必须**什么都不显示**，
   *   **不许退化成 `false`**：把「不知道」画成「未关注」是在骗用户。
   *
   * @param {string} id 歌手 mid
   * @returns {Promise<boolean|null>}
   */
  async getFollowState(id) {
    const mid = String(id ?? '').trim()
    if (!mid) return null
    try {
      return (await loadFollowedSingerMids()).has(mid)
    } catch (err) {
      console.log('[singer] follow state', err)
      return null
    }
  },
  /**
   * 歌手信息（含歌曲数 / 专辑数）。
   * 一次网关请求里并发三个模块：详情 + 专辑数（各取 1 条）+ 歌曲数（取 1 条）。
   * @param {string} id 歌手 mid
   */
  getInfo(id) {
    return createMusicuFetch({
      req_1: {
        module: 'music.musichallSinger.SingerInfoInter',
        method: 'GetSingerDetail',
        param: {
          singer_mids: [id],
          ex_singer: 1,
          wiki_singer: 1,
          group_singer: 0,
          pic: 1,
          photos: 0,
        },
      },
      req_2: {
        module: 'music.musichallAlbum.AlbumListServer',
        method: 'GetAlbumList',
        param: {
          singerMid: id,
          order: 0,
          begin: 0,
          num: 1,
          songNumTag: 0,
          singerID: 0,
        },
      },
      req_3: {
        module: 'musichall.song_list_server',
        method: 'GetSingerSongList',
        param: {
          singerMid: id,
          order: 1,
          begin: 0,
          num: 1,
        },
      },
    }).then(body => {
      // 三个模块任一被拒（模块级 code）都算失败；用可选链兜住"节点缺失"的情况
      if (body.req_1?.code != successCode || body.req_2?.code != successCode || body.req_3?.code != successCode) throw new Error('get singer info faild.')
      const info = body.req_1.data.singer_list[0]
      if (!info) throw new Error('get singer info faild.')
      const music = body.req_3.data
      const album = body.req_2.data
      return {
        source: 'tx',
        id: info.basic_info.singer_mid,
        info: {
          name: info.basic_info.name,
          desc: info.ex_info?.desc ?? '',
          // pic.pic 是 http:// 的 300x300（实测）；统一升到 https，和本仓其它封面一致
          avatar: String(info.pic?.pic ?? '').replace(/^http:/, 'https:'),
          // 注意：ex_info.genre 实测不是性别（周杰伦、G.E.M. 都是 1），这里沿用上游字段，
          // 待歌手页真正接入时再按 UI 需求核对来源
          gender: info.ex_info?.genre === 1 ? 'man' : 'woman',
        },
        count: {
          music: music.totalNum,
          album: album.total,
        },
      }
    })
  },
  /**
   * 歌手专辑列表
   * @param {string} id 歌手 mid
   * @param {number} page 从 1 开始
   * @param {number} limit
   */
  getAlbumList(id, page = 1, limit = 10) {
    return createMusicuFetch({
      req: {
        module: 'music.musichallAlbum.AlbumListServer',
        method: 'GetAlbumList',
        param: {
          singerMid: id,
          order: 0,
          // begin 是**原始偏移量**（实测：begin=0 → 第 1 张，begin=100 → 第 101 张）。
          // 曾经写成 `if (page === 1) page = 0` + `begin: page * limit`，那会让 page ≥ 2
          // 整整跳掉一页（偏移 50–99 永远取不到）——别改回那种写法。
          begin: (page - 1) * limit,
          num: limit,
          songNumTag: 0,
          singerID: 0,
        },
      },
    }).then(body => {
      if (body.req?.code != successCode) throw new Error('get singer album faild.')

      const list = this.filterAlbumList(body.req.data.albumList)
      return {
        source: 'tx',
        list,
        limit,
        page,
        total: body.req.data.total,
      }
    })
  },
  /**
   * 歌手歌曲列表
   * @param {string} id 歌手 mid
   * @param {number} page 从 1 开始
   * @param {number} limit
   */
  getSongList(id, page = 1, limit = 100) {
    return createMusicuFetch({
      req: {
        module: 'musichall.song_list_server',
        method: 'GetSingerSongList',
        param: {
          singerMid: id,
          order: 1,
          // 同 getAlbumList：begin 是原始偏移量，分页用 (page-1)*limit；
          // 服务端对 num 的上限实测是 100
          begin: (page - 1) * limit,
          num: limit,
        },
      },
    }).then(body => {
      if (body.req?.code != successCode) throw new Error('get singer song list faild.')

      const list = this.filterSongList(body.req.data.songList)
      return {
        source: 'tx',
        list,
        limit,
        page,
        total: body.req.data.totalNum,
      }
    })
  },
  /**
   * 关注歌手的全量行（mid + name）——关注动态用它写条目（条目里要歌手名）。
   * 与 `getFollowState` 共用同一份缓存与同一个在途请求，见模块顶部的缓存注释。
   */
  getFollowedSingers() {
    return loadFollowedSingers()
  },
  /**
   * 关注 / 取消关注歌手（老式 h5 写通道）。
   *
   * ## 为什么是这个形状
   *
   * 失败**不抛异常**，而是返回 `{ ok: false, reason }`：界面要按 reason 给**不同的引导**——
   * 未登录 → 登录引导；没有 / 过期网页会话 → 就地发起重新扫码；频控与网络 → 只是可重试的失败。
   * 混成一句「操作失败」等于让用户猜。类型见 `common/types/follow_singer.d.ts`。
   *
   * **没有网页会话时一个请求都不打**：那种情况打过去也只会被 `1006` 拒，白多一次可疑请求
   * （边界：不做无谓的试探与重试）。
   *
   * 成功后调 `clearFollowSingerCache()`：关注态的会话缓存必须作废，否则整轮会话里标记停在旧值上
   * （歌手页与之后铺开的每一处读的都是那份缓存）。
   *
   * @param {string} id 歌手 mid
   * @param {boolean} follow true = 关注、false = 取关
   * @returns {Promise<LX.FollowSinger.WriteResult>}
   */
  async setFollowSinger(id, follow) {
    const mid = String(id ?? '').trim()
    if (!mid) return { ok: false, reason: 'unknown', message: '缺少歌手 mid' }

    let credential
    try {
      credential = await getQQCredential()
    } catch (err) {
      console.log('[tx] follow write: 读取凭证失败', err)
      return { ok: false, reason: 'network', message: '读取登录凭证失败' }
    }
    if (credential == null) return { ok: false, reason: 'not-logged-in', message: 'QQ 音乐未登录' }

    // uin 用**QQ 号**而不是 musicid：p_skey 是按 QQ 号签发的，两者必须配套（g_tk 才算得对）
    const uin = String(credential.uin ?? '')
    const pSkey = String(credential.p_skey ?? '')
    if (!uin || !pSkey) {
      return { ok: false, reason: 'no-web-session', message: '需要重新扫码以启用关注' }
    }

    let resp
    try {
      resp = parseH5Body((await httpFetch(follow ? H5_FOLLOW_ADD : H5_FOLLOW_DEL, {
        method: 'POST',
        form: {
          g_tk: String(hash33(pSkey, 5381)),
          format: 'json',
          singermid: mid,
        },
        headers: {
          'User-Agent': H5_UA,
          // cookie 的组成（`uin` 的形态**待重扫后的真机往返定形**）：
          //   - `p_skey` 是这条通道的关键（探针实测：**没有它**时连 `g_tk=5381` 都被 `1006` 拒）
          //   - `qm_keyst` 是老式 h5 那边音乐会话的 cookie 名（spec 的「必要时」）
          //   - `uin` 在 QQ 的老 h5 上有**带 `o` 前缀**的历史形态（页面上一般是 `p_uin`/`pt2gguin`
          //     那种形态），这里三种一起给，服务端取它认识的那个；哪个才是它要的，
          //     等票 05 的真机往返跑通后收敛（现在没有可用会话，无法实测）
          Cookie: [
            `uin=${uin}`,
            `p_uin=o${uin}`,
            `pt2gguin=o${uin}`,
            `p_skey=${pSkey}`,
            `qm_keyst=${String(credential.musickey ?? '')}`,
          ].join('; '),
        },
        timeout: 15000,
      }).promise).body)
    } catch (err) {
      console.log('[tx] follow write failed', err)
      return { ok: false, reason: 'network', message: err?.message ?? '网络请求失败' }
    }

    const reason = classifyH5Write(resp)
    if (reason != null) {
      return { ok: false, reason, message: String(resp?.msg ?? resp?.message ?? `code=${String(resp?.code ?? '?')}`) }
    }

    clearFollowSingerCache()
    return { ok: true }
  },
  /**
   * 关注动态：**批量**取多位歌手的「最新若干首」——一轮扫描（`num: 1`）与补查（`num: 10`）都走它。
   *
   * 与 `getSongList` 的三处不同，都是刻意的：
   *   1. `order: 0`（实测大体是发布时间倒序）而不是 `order: 1`（热度序）——后者对「有没有新东西」
   *      毫无意义；抽样复核的结论与反例形态以真机实测为准；
   *   2. 一个请求塞多位歌手（每人一个 `req_N` 键——`createMusicuFetch` 的 body 顶层天然支持多模块，
   *      `getInfo` 就是一次发三个），否则 604 位歌手要打 604 个请求；
   *   3. 返回 `publishTime`（`time_public`）——`createSong` 不带这个字段，理由见 `toFeedSong`。
   *
   * ⚠️ `ok` 是**一整块**的成败：同一块里的 30 位歌手要么全 `ok`、要么全 `false`（31 个 module 会让
   * 整个请求被拒）。调用方**只许对 `ok: true` 的歌手推进基线**——这样局部失败会在下一轮自然补上，
   * 不需要重试队列。
   *
   * @param {string[]} mids 歌手 mid
   * @param {number} num 每位歌手取几首（扫描用 1，补查用 10）
   * @returns {Promise<Array<{ mid: string, ok: boolean, songs: Array<{ song: object, publishTime: string }> }>>}
   */
  async getLatestSongs(mids, num = 1) {
    const out = []
    for (let start = 0; start < mids.length; start += FOLLOW_FEED_BATCH_SIZE) {
      const chunk = mids.slice(start, start + FOLLOW_FEED_BATCH_SIZE)
      const body = {}
      chunk.forEach((mid, index) => {
        body[`req_${index}`] = {
          module: 'musichall.song_list_server',
          method: 'GetSingerSongList',
          param: { singerMid: mid, order: 0, begin: 0, num },
        }
      })
      try {
        const res = await createMusicuFetch(body)
        chunk.forEach((mid, index) => {
          const node = res[`req_${index}`]
          if (node?.code != successCode) {
            out.push({ mid, ok: false, songs: [] })
            return
          }
          out.push({
            mid,
            ok: true,
            songs: (node.data?.songList ?? []).map(item => toFeedSong(item?.songInfo)).filter(Boolean),
          })
        })
      } catch (err) {
        console.log('[tx] 关注动态批量取歌失败，这一块歌手本轮跳过', err)
        for (const mid of chunk) out.push({ mid, ok: false, songs: [] })
      }
    }
    return out
  },
  /**
   * 相似歌手（QQ 不给分页，只有条数）。
   * @param {string} id 歌手 mid
   * @param {number} num 想要几条
   */
  getSimilarSingerList(id, num = 10) {
    return createMusicuFetch({
      req: {
        module: 'music.SimilarSingerSvr',
        method: 'GetSimilarSingerList',
        param: {
          singerMid: id,
          number: num,
        },
      },
    }).then(body => {
      if (body.req?.code != successCode) throw new Error('get similar singer faild.')

      const list = this.filterSimilarSingerList(body.req.data.singerlist)
      return {
        source: 'tx',
        list,
        total: list.length,
      }
    })
  },
  /**
   * 歌手 MV 列表。
   * @param {string} id 歌手 mid
   * @param {number} page 从 1 开始
   * @param {number} limit
   */
  getMvList(id, page = 1, limit = 20) {
    return createMusicuFetch({
      req: {
        module: 'MvService.MvInfoProServer',
        method: 'GetSingerMvList',
        param: {
          singermid: id,
          order: 1,
          count: limit,
          start: (page - 1) * limit,
        },
      },
    }).then(body => {
      if (body.req?.code != successCode) throw new Error('get singer mv list faild.')

      const data = body.req.data
      const list = (data.list ?? []).map(item => ({
        source: 'tx',
        // MV 的 id 有两套：数字 mvid（老接口）与字符串 vid（分享/播放页用）
        id: String(item.mvid),
        vid: item.vid,
        name: item.title,
        img: item.picurl,
        interval: item.duration ? formatPlayTime(item.duration) : null,
        playCount: item.playcnt,
        pubDate: item.pubdate ? dateFormat(item.pubdate * 1000, 'Y-M-D') : null,
      }))
      return {
        source: 'tx',
        list,
        limit,
        page,
        total: data.total ?? list.length,
      }
    })
  },
  filterAlbumList(raw) {
    return (raw ?? []).map(item => {
      return {
        id: item.albumID,
        mid: item.albumMid,
        count: item.totalNum,
        info: {
          name: item.albumName,
          author: item.singerName,
          img: `https://y.gtimg.cn/music/photo_new/T002R500x500M000${item.albumMid}.jpg`,
          desc: null,
        },
      }
    })
  },
  filterSongList(raw) {
    // 原先这里 `raw.map(...)` 没有 return，恒返回 undefined（歌手页歌曲列表必崩）
    return (raw ?? []).map(item => createSong(item.songInfo))
  },
  filterSimilarSingerList(raw) {
    return (raw ?? []).map(item => ({
      source: 'tx',
      // 相似歌手只给 mid（没有数字 id 之外的稳定标识），统一用 mid 当 id
      id: item.singerMid,
      name: item.singerName,
      // singerPic 是 150x150 的 http 图；缺失时按 mid 拼 500x500 的兜底图
      img: String(item.singerPic || `https://y.gtimg.cn/music/photo_new/T001R500x500M000${item.singerMid}.jpg`).replace(/^http:/, 'https:'),
      desc: null,
    }))
  },
}
