import { txCgi, buildComm, requireCredential } from './utils/request'
import { createSong } from './utils/song'

/**
 * 云端「不喜欢」列表（QQ 账号侧，数据类功能票 02）。
 *
 * 端点全部实测过（2026-09-25 探针），记录在
 * `scripts/verify/artifacts/2026-09-25-qq-probe/NOTES.md` §2 与 `docs/agents/qq-music-native.md` §5.11。
 * 改这个文件前先读这六条，每一条都有过代价：
 *
 *   1. 网关是 `music.feedback.FeedbackBlack`，**WEB comm 就够**（不需要签名载体：参考库把它标了
 *      `sign=True`，实测直接打 `musicu.fcg` 一样通）。读 `GetDislikeList`、写 `AddDislike` /
 *      `CancelDislike` 都在这个模块下。
 *   2. 🔴 **成功判据是 `code == 0` 且 `data.Retcode == 0`——大写 R**。别照
 *      `tx/songList.js` 的 `data.retCode` 抄（那套歌单写接口是小写 r），也别把两者「统一」掉：
 *      它们是两个不同模块的字段名。本文件内的自造字段名统一写小写 `retcode`（见 `parseFeedbackResult`）。
 *   3. **条目只有五个字段**：`ID`（数字 songId 的字符串形态）、`IdType`、`Img`、`Name`、`Time`
 *      ——**没有 mid**（参考实现的 `DislikeItem` 也只有这五个，不是探针漏看）。而列表要显示歌手 /
 *      专辑 / 时长、要能播放，都离不开 mid，所以每条都要再补一次歌曲详情（见 `enrichSong`）。
 *      补法：`music.pf_song_detail_svr/get_song_detail_yqq` 的 **`song_id`**（本仓 §5.10 记过「都行」，
 *      2026-09-25 又用只读探针复验过：回的 `track_info.mid` 与搜索侧的 mid 一致、`file.media_mid` 也在）。
 *      实测没有可用的**批量**端点（`music.trackInfo.UnifiedTrackInfo` 是 `code=500003` 模块不存在、
 *      `music.musichallSong.SongInfoServer` 是 `code=40000` 方法不存在）——所以这层是「一首一条详情请求」。
 *   4. **读回时 `IdType` 是 0**（写入时传 1）：别拿 `IdType` 判成员关系，一律用 `ID`（NOTES §2 实测）。
 *   5. 翻页是**游标式**：`Page` + `SongLastid`（= 上一页最后一条的 `ID`），空页即到底
 *      （与参考实现的 `MultiFieldContinuationStrategy` 同一套）。游标不前进 / 服务端忽略游标两种
 *      异常形状都要能自己停住，不能让界面卡在循环里。
 *   6. 两个写端点都接了：`CancelDislike`（「QQ 不喜欢」tab 的移出）与 `AddDislike`（票 05 起：
 *      对在线歌在「屏蔽播放」动作里**顺带**写云端，best-effort、失败不阻塞）。`AddDislike` 的
 *      成功判据与移出完全相同（走同一个 `parseFeedbackResult`），2026-10-13 用正式凭证复验过
 *      受控往返（count 0→1→0，状态已恢复；记录在 qq-music-native.md §5.11）。
 *
 * 只读写「歌曲」这一类（`Cmd: 3`）：歌手（2）与风格（4）本账号读回来是空的，形状对但没实测过写入。
 */

const DISLIKE_MODULE = 'music.feedback.FeedbackBlack'
/** `Cmd`：3 = 歌曲（2 = 歌手 / 4 = 风格，本模块不用）。 */
const CMD_SONG = 3
/** 翻页游标键（`Cmd: 3` 对应的那个；歌手/风格是 `SingersLastid` / `StyleLastid`）。 */
const SONG_CURSOR_KEY = 'SongLastid'
/**
 * 页数硬上限：只为「游标不前进 / 服务端忽略游标」时防死循环。
 * 正常情况下第一页的条目全被去重（`added === 0`）就会自己停，撞上它的轮次很少。
 */
const MAX_PAGES = 10
/**
 * 补歌曲详情的**并发上限**与**总条数上限**。
 *
 * 详情接口是单曲形态（第 3 条），列表有几条就打几条——不喜欢列表通常是几条到几十条，
 * 但极端账号可能有几百条。上限是为了不做请求风暴（红线：低频、节流），撞上后剩下的条目
 * 仍按条目自带的名字 / 封面展示、也照样能移出，只是补不出歌手 / 专辑 / 音质（界面会有缺列）。
 * 撞上会打一行日志（同 `user.js` 的 `getFavSongIds` 撞页数上限的处理）。
 */
const DETAIL_CONCURRENCY = 4
const DETAIL_MAX = 100

/** 本模块的 comm 档案：读写都走默认的 WEB 形态（文件头第 1 条）。 */
const webComm = credential => buildComm(credential)

/**
 * 判读响应节点（**纯函数**，单测直接喂响应）。
 *
 * 读与写共用同一套判据：`code == 0` 且 `data.Retcode == 0`（**大写 R**）。
 * 返回结构对齐 `songList.js` 的 `readWriteResult`（`{ ok, code, retCode, msg }`），
 * 只是字段名按本模块的实际上游拼法写：`retcode`（大写 R 的那个），**别与歌单写的 `retCode` 混用**。
 *
 * ⚠️ `Number(null) === 0`：缺字段必须算缺失而不是 0，否则「响应形状变了、连码都没有」会被读成成功
 * （同 `songList.js` 的 `toNum`）。
 */
const toNum = value => (value == null || value === '' ? Number.NaN : Number(value))

export const parseFeedbackResult = node => {
  const code = toNum(node?.code)
  const retcode = toNum(node?.data?.Retcode ?? node?.Retcode)
  const msg = String(node?.data?.Msg ?? node?.data?.msg ?? node?.msg ?? '')
  return {
    ok: code === 0 && retcode === 0,
    code: Number.isFinite(code) ? code : null,
    // 上游拼 `Retcode`（大写 R），本字段是我们自己的小写别名
    retcode: Number.isFinite(retcode) ? retcode : null,
    msg,
  }
}

/** 失败文案：把 QQ 的码原样带出来（否则真机上「点了没反应」无从查起，同 songList 的教训）。 */
const failText = (action, res) => `${action}被拒（code=${res.code ?? '-'} retcode=${res.retcode ?? '-'}${res.msg ? ` msg=${res.msg}` : ''}）`

/** 原始条目 → 本模块的内部条目（只取实测存在的那五个字段）。 */
const toItem = raw => ({
  /** 数字 songId 的字符串形态——**成员判定与写接口都用它**（`IdType` 不可靠，见文件头第 4 条）。 */
  id: String(raw?.ID ?? ''),
  name: String(raw?.Name ?? ''),
  img: String(raw?.Img ?? ''),
  time: Number(raw?.Time ?? 0) || 0,
})

/**
 * 详情拿不到时的兜底歌曲对象（老式平铺形状，`utils/song.js` 的 `createSong` 同构）。
 *
 * 只填条目自带的两个字段（名字 / 封面），**`songmid` 留空**——宁可让这一行播不了，
 * 也不能编一个假 mid（vkey 会拿它拼文件名，假的只会得到一个更难查的失败）。
 * `types/_types` 必须给空数组 / 空对象：`toNewMusicInfo` 会直接读 `meta._qualitys.*`。
 * 身份（新式模型的 `id`）由调用方按数字 songId 补，见 `views/Favorites/components/useDislikeSongs.ts`。
 */
const fallbackSong = item => ({
  singer: '',
  name: item.name,
  albumName: '',
  albumId: '',
  source: 'tx',
  interval: null,
  songId: Number(item.id) || 0,
  songType: 0,
  albumMid: '',
  strMediaMid: '',
  songmid: '',
  img: item.img,
  lrc: null,
  otherSource: null,
  types: [],
  _types: {},
  typeUrl: {},
})

/** 详情结果的**进程内缓存**（`songId → 老式歌曲对象`）。切走再切回这个 tab 不必重打详情接口。 */
const detailCache = new Map()

/**
 * 补一条条目的歌曲信息。**只缓存成功的结果**——失败时每次都会再试一次（详情接口偶发失败不该被固化）。
 */
const enrichSong = async(item, credential) => {
  const cached = detailCache.get(item.id)
  if (cached) return cached
  try {
    const node = await txCgi({
      module: 'music.pf_song_detail_svr',
      method: 'get_song_detail_yqq',
      // 两种参数端点都收（§5.10），这里只能用 song_id：条目没有 mid
      param: { song_id: item.id, song_type: 0 },
    }, webComm(credential)).promise
    const track = node?.data?.track_info
    if (!track) throw new Error('歌曲详情为空')
    const song = createSong(track)
    // 没有 mid 的「歌曲」对象没法取流（`musicUrl.js` 拿 songmid 拼文件名），当失败处理
    if (!song.songmid) throw new Error('歌曲详情没有 mid')
    detailCache.set(item.id, song)
    return song
  } catch (err) {
    // 诊断一行：只有 songId 与错误信息（凭证一律不进日志）
    console.log('[tx] 不喜欢条目补歌曲信息失败，只显示条目标题', { songId: item.id, name: item.name, err: err?.message ?? String(err) })
    return fallbackSong(item)
  }
}

/** 有限并发的 map（详情接口一首一条，顺序无关；并发上限见 `DETAIL_CONCURRENCY`）。 */
const mapLimit = async(items, limit, worker) => {
  const out = new Array(items.length)
  let next = 0
  const run = async() => {
    while (next < items.length) {
      const index = next++
      out[index] = await worker(items[index], index)
    }
  }
  const runners = Array.from({ length: Math.min(limit, items.length) }, run)
  await Promise.all(runners)
  return out
}

/** 读一页（返回**原始条目数组**，判据不通过就抛）。 */
const fetchPage = async(credential, page, lastid) => {
  const node = await txCgi({
    module: DISLIKE_MODULE,
    method: 'GetDislikeList',
    param: {
      Cmd: CMD_SONG,
      Page: page,
      ...(lastid ? { [SONG_CURSOR_KEY]: lastid } : {}),
    },
  }, webComm(credential)).promise
  const result = parseFeedbackResult(node)
  if (!result.ok) throw new Error(failText('读不喜欢列表', result))
  return Array.isArray(node?.data?.Songs) ? node.data.Songs : []
}

export default {
  /**
   * 云端「不喜欢」的**全部歌曲**（游标翻页拉完 + 逐条补歌曲信息）。
   *
   * 返回形状对齐 `user.getFavSong`（`{ list, total, page, limit, source }`），只是**不分页**：
   * 一次拉完，`limit` 取长度让界面的分页器只有一页。`list` 是**老式歌曲对象**（要过
   * `toNewMusicInfo` 才能进 UI/store）。
   *
   * 读失败抛错（带 QQ 的码），由 store / 视图按 §2.11 落失败文案。
   */
  async getDislikedSongs() {
    const credential = await requireCredential()
    const items = []
    const seen = new Set()
    let lastid = ''
    let page = 1

    for (; page <= MAX_PAGES; page++) {
      const rawList = await fetchPage(credential, page, lastid)
      if (!rawList.length) break
      let added = 0
      for (const raw of rawList) {
        const item = toItem(raw)
        if (!item.id || seen.has(item.id)) continue
        seen.add(item.id)
        items.push(item)
        added++
      }
      // 这一页没有新条目 = 服务端忽略了游标（把整份列表又给了一遍）→ 停，别再打后面的页
      if (added === 0) break
      // 游标取**原始响应最后一条**的 ID（不是去重后那份的最后一条）
      const nextCursor = String(rawList[rawList.length - 1]?.ID ?? '')
      if (!nextCursor || nextCursor === lastid) break
      lastid = nextCursor
    }

    if (items.length > DETAIL_MAX) {
      console.log('[tx] 不喜欢列表条目较多，只补前若干条的歌曲信息', { total: items.length, enriched: DETAIL_MAX })
    }
    // 只给能覆盖到的那部分补详情（上限见 DETAIL_MAX），其余用兜底对象
    const enrichTargets = items.slice(0, DETAIL_MAX)
    const enriched = await mapLimit(enrichTargets, DETAIL_CONCURRENCY, item => enrichSong(item, credential))
    const rest = items.slice(DETAIL_MAX).map(fallbackSong)
    const list = [...enriched, ...rest]

    return {
      list,
      total: list.length,
      page: 1,
      limit: list.length || 1,
      source: 'tx',
    }
  },

  /**
   * 加入「不喜欢」（`AddDislike`）。
   *
   * 参数形状与 `removeDislikedSongs` 同构：`{ Songs: [{ ID: '<数字 songId 字符串>', IdType: 1 }] }`
   * （票 05 的受控往返实测；`ID` 用数字 songId 的字符串形态，读侧成员判定也用同一口径）。
   *
   * 判据同移出：`code==0 且 Retcode==0`（文件头第 2 条），不通过就抛（带码）。
   * **不做读回成员校验**（移出那条有，这条不照抄）：新加入的条目落在列表哪个位置没有实测结论，
   * 只读第 1 页判成员会给出**假失败**；且这条路径本来就是 best-effort——调用方
   * （`store/user/action.ts` 的 `addDislikedSongToCloud`）吞掉失败只留日志，本地屏蔽已生效。
   */
  async addDislikedSongs(songIds) {
    const ids = (Array.isArray(songIds) ? songIds : [songIds]).map(id => String(id ?? '')).filter(Boolean)
    if (!ids.length) throw new Error('未选择要加入不喜欢的歌曲')
    const credential = await requireCredential()

    const node = await txCgi({
      module: DISLIKE_MODULE,
      method: 'AddDislike',
      param: { Songs: ids.map(id => ({ ID: id, IdType: 1 })) },
    }, webComm(credential)).promise
    const result = parseFeedbackResult(node)
    if (!result.ok) {
      // 诊断一行：只有请求形状与 QQ 的错误码（同移出那条的写法）
      console.log('[tx] 加入不喜欢被拒', { module: DISLIKE_MODULE, method: 'AddDislike', songs: ids, code: result.code, retcode: result.retcode, msg: result.msg })
      throw new Error(failText('加入不喜欢', result))
    }
    return result
  },

  /**
   * 移出「不喜欢」（`CancelDislike`）。`songIds` 是数字 songId（字符串形态也认）。
   *
   * 参数形状是实测的：`{ Songs: [{ ID: '<数字 songId 字符串>', IdType: 1 }] }`
   * ——`IdType: 1` 表示歌曲（歌手 2 / 风格 3，本模块不做）。
   *
   * 判据 `code==0 且 Retcode==0`（文件头第 2 条），不通过就抛（带码）。
   * 通过之后**再读回第一页**做一次成员校验：写接口有没有「假成功」形态没有实测证据
   * （探针那次写完读回立即生效），但本仓被假成功咬过，代价只有一次读——
   * 校验的**适用范围**写清楚：只对「本来就出现在第 1 页」的条目有判别力，条目在第 2 页往后时
   * 页 1 里本来就没有它，这里判不出真假（不构成假失败）；读回本身失败不推翻写结论（只打日志）。
   */
  async removeDislikedSongs(songIds) {
    const ids = (Array.isArray(songIds) ? songIds : [songIds]).map(id => String(id ?? '')).filter(Boolean)
    if (!ids.length) throw new Error('未选择要移出的歌曲')
    const credential = await requireCredential()

    const node = await txCgi({
      module: DISLIKE_MODULE,
      method: 'CancelDislike',
      param: { Songs: ids.map(id => ({ ID: id, IdType: 1 })) },
    }, webComm(credential)).promise
    const result = parseFeedbackResult(node)
    if (!result.ok) {
      // 诊断一行：只有请求形状与 QQ 的错误码（同 songList.js 的写法）
      console.log('[tx] 移出不喜欢被拒', { module: DISLIKE_MODULE, method: 'CancelDislike', songs: ids, code: result.code, retcode: result.retcode, msg: result.msg })
      throw new Error(failText('移出不喜欢', result))
    }

    let still = []
    try {
      const firstPage = (await fetchPage(credential, 1, '')).map(raw => toItem(raw).id)
      still = ids.filter(id => firstPage.includes(id))
    } catch (err) {
      // 读回失败 ≠ 写失败（判据已经通过了）；只把这一行留在日志里
      console.log('[tx] 移出不喜欢后读回校验失败（写已按判据通过）', err?.message ?? String(err))
    }
    if (still.length) throw new Error(`移出不喜欢没有生效（code=0 但读回仍在：${still.join(',')}）`)

    // 详情缓存里这份条目已经没用了，顺手清掉（下次重新进页面会重新拉）
    ids.forEach(id => detailCache.delete(id))
    return result
  },
}
