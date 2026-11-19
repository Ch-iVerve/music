import { txCgi, buildComm, requireCredential } from './utils/request'
import { createSong } from './utils/song'

/**
 * 歌曲详情与关联能力（工单 09）。
 *
 * 五个端点在 2026-09-23 用本仓的请求形状（comm + loginUin 字符串）逐个实测 `code = 0`，
 * 字段名照响应抄（不猜），以下为实测记录：
 *
 *   1. 歌曲详情 `music.pf_song_detail_svr/get_song_detail_yqq`：`song_mid` 与 `song_id` 都收
 *   2. 相似歌曲 `music.recommend.TrackRelationServer/GetSimilarSongs`：`{ songid, songtype }` → `vecSong[].track`（标准歌曲对象）
 *   3. 相关歌单 `music.recommend.TrackRelationServer/GetRelatedPlaylist`：同上 → `vecPlaylist[]`
 *   4. 相关 MV `MvService.MvInfoProServer/GetSongRelatedMv`：
 *      ⚠️ `songid` 必须**字符串**、`songtype` 必须 **1**——用数字 songid + songtype 0 会得到
 *      `code=0` 但 `list` 恒空（看着像「这首歌没有 MV」，其实是参数错，本轮踩过一次）
 *   5. 其他版本 `music.musichallSong.OtherVersionServer/GetOtherVersionSongs`：
 *      `{ songmid, songtype }` → `versionList[]`（标准歌曲对象，直接喂 createSong）
 *
 * 关联能力的入参是**数字 songId + songType**（详情接口的 `track_info.id` / `.type` 就是它们）。
 *
 * 2026-09-26 追加两条**资料类**能力（同一轮实测，记录在
 * `scripts/verify/artifacts/2026-09-26-capabilities/NOTES-sheet-producer.md`）：
 *
 *   6. 制作人 `music.sociality.KolWorksTag/SongProducer`：`songid` 与 `songmid` 都收，
 *      **现有 web comm 就够**（另用 WEB 完整档案 / DESKTOP 档案对照过，逐字段一致）→ `Lst[]`
 *   7. 曲谱 `music.mir.SheetMusicSvr/GetMoreSheetMusic`：`{ songMid, begin, end, scoreType, ttype }`，
 *      走**匿名 h5 comm**（见 `sheetComm()`）；`ttype=0` 的结果与 `ttype=1` 的 unique 集合相同但**无重复**
 */

const webComm = credential => buildComm(credential)

/**
 * 曲谱端点的 comm：**匿名 h5 形态**（不带登录态）。
 *
 * 照 fork（`qqmusic_api/modules/song.py:500-569` 的 `override_comm=True`）抄；2026-09-26 实测
 * 三种形状都能过（这份匿名 comm / 这份 comm + 顶层 `loginUin` 空串 / 本仓 web comm 带登录态），
 * 取匿名这份的理由是**端点不需要凭证，就不发凭证**。
 * `g_tk: 5381` 是未登录形态的固定值，不是错误值（fork 同值）。
 */
const sheetComm = () => ({
  g_tk: 5381,
  uin: '',
  format: 'json',
  inCharset: 'utf-8',
  outCharset: 'utf-8',
  notice: 0,
  needNewCode: 1,
})

/** 简介等字段带 `\n` 与 HTML 残留，清一下（详情页只做纯文本展示）。 */
const cleanText = value => String(value ?? '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim()

export default {
  /**
   * 歌曲详情。入参一律是 **songmid**（新式歌曲对象里叫 `meta.songId`，见 tools.ts 的映射，
   * 别拿 `meta.id` 当 mid——那是数字 id）。返回 `{ track, trackRaw, info, desc, extras }`：
   * track 是老式歌曲对象，info 是发行公司/流派/时间/语言。
   */
  async getDetail(mid) {
    const credential = await requireCredential()
    const data = await txCgi({
      module: 'music.pf_song_detail_svr',
      method: 'get_song_detail_yqq',
      // 两种参数端点都收（实测），这里固定用 song_mid：调用方手里只有 mid，且 mid 可能全是数字
      // （形状像 song_id，用推断会传错）
      param: { song_mid: String(mid), song_type: 0 },
    }, webComm(credential)).promise
    const d = data?.data ?? {}
    const track = d.track_info
    if (!track) throw new Error('歌曲详情为空')
    const pick = key => cleanText(d.info?.[key]?.content?.map(item => item.value).filter(Boolean).join('、'))
    return {
      track: createSong(track),
      trackRaw: track,
      info: {
        company: pick('company'),
        genre: pick('genre'),
        lan: pick('lan'),
        pubTime: pick('pub_time'),
      },
      desc: cleanText(d.info?.intro?.content?.map(item => item.value).join('\n')),
      extras: {
        name: cleanText(d.extras?.name),
        transName: cleanText(d.extras?.transname),
        wikiUrl: d.extras?.wikiurl ?? '',
      },
    }
  },

  /** 相似歌曲：`vecSong[].track` 是标准歌曲对象。 */
  async getSimilarSongs(songId, songType = 0) {
    const credential = await requireCredential()
    const data = await txCgi({
      module: 'music.recommend.TrackRelationServer',
      method: 'GetSimilarSongs',
      param: { songid: Number(songId), songtype: Number(songType) },
    }, webComm(credential)).promise
    return (data?.data?.vecSong ?? [])
      .map(item => item?.track)
      .filter(Boolean)
      .map(createSong)
  },

  /** 相关歌单（他人歌单，跳本仓的歌单详情页）。 */
  async getRelatedPlaylists(songId, songType = 0) {
    const credential = await requireCredential()
    const data = await txCgi({
      module: 'music.recommend.TrackRelationServer',
      method: 'GetRelatedPlaylist',
      param: { songid: Number(songId), songtype: Number(songType) },
    }, webComm(credential)).promise
    return (data?.data?.vecPlaylist ?? []).map(item => ({
      id: String(item.tid ?? ''),
      name: cleanText(item.title),
      img: item.cover ?? '',
      author: cleanText(item.creator),
      total: Number(item.songNum ?? 0),
      playCount: item.playCnt ?? '',
      source: 'tx',
    }))
  },

  /** 相关 MV（字段就这几个：mvid/picurl/playcnt/singers/title/vid）。 */
  async getRelatedMv(songId) {
    const credential = await requireCredential()
    const data = await txCgi({
      module: 'MvService.MvInfoProServer',
      method: 'GetSongRelatedMv',
      // ⚠️ songid 字符串 + songtype 1，别改成数字/0（见文件头第 4 条）
      param: { songid: String(songId), songtype: 1, lastmvid: 0 },
    }, webComm(credential)).promise
    return (data?.data?.list ?? []).map(item => ({
      id: String(item.vid ?? item.mvid ?? ''),
      vid: String(item.vid ?? ''),
      name: cleanText(item.title),
      img: item.picurl ?? '',
      singer: (item.singers ?? []).map(s => cleanText(s.name)).join('、'),
      playCount: Number(item.playcnt ?? 0),
      interval: null,
      duration: 0,
      source: 'tx',
    }))
  },

  /** 其他版本：`versionList[]` 是标准歌曲对象。 */
  async getOtherVersions(songMid, songType = 0) {
    const credential = await requireCredential()
    const data = await txCgi({
      module: 'music.musichallSong.OtherVersionServer',
      method: 'GetOtherVersionSongs',
      param: { songmid: songMid, songtype: Number(songType) },
    }, webComm(credential)).promise
    return (data?.data?.versionList ?? []).filter(Boolean).map(createSong)
  },

  /**
   * 制作人（幕后名单）：`Lst[]` 按职责分组（演唱 / 作词 / 作曲 / 编曲 / 制作人 / 混音 / 录音 / 吉他…）。
   *
   * 姓名之外还有 `Icon`（头像）、`SingerMid`、`Follow`。**没有数据时 `Lst` 是空数组**（实测：「卡农」
   * 就是空 Lst，而端点的 `code` 仍是 0）——所以判据只能是 `Lst` 本身，别拿 code 判。
   * 空 `Name` 的项丢掉（换来一条无法显示的占位行没有意义）。
   *
   * `SingerMid` 也照样带出来，但**暂不做跳转**：制作人不一定在歌手页里存在（点进去可能是空页），
   * 要用的时候再定判据。
   */
  async getProducer(mid) {
    const credential = await requireCredential()
    const data = await txCgi({
      module: 'music.sociality.KolWorksTag',
      method: 'SongProducer',
      // songid / songmid 端点都收（实测），传 mid：调用方手里只有 mid，而 mid 可能全是数字
      param: { songmid: String(mid) },
    }, webComm(credential)).promise
    return (data?.data?.Lst ?? [])
      .map(group => ({
        title: cleanText(group?.Title),
        producers: (group?.Producers ?? [])
          .map(item => ({
            name: cleanText(item?.Name),
            icon: item?.Icon ?? '',
            singerMid: item?.SingerMid ?? '',
          }))
          .filter(item => item.name),
      }))
      .filter(group => group.producers.length)
  },

  /**
   * 曲谱：每条给一份 `images[]`（乐谱图片直链）。
   *
   * 实测（2026-09-26）：`picURLs` 是 `y.gtimg.cn` 的 jpg，**带不带 Referer 都能直连**（HTTP 200 /
   * `image/jpeg`），所以 UI 可以直接当 `<img src>`，不需要代理。没有图的条目（`ttype=2` 的虫虫钢琴
   * 只给 `.ccmz` 私有文件）在这里就滤掉——展示不了的不往上传。
   *
   * ⚠️ 「没有曲谱」是 **`code=10007` + `result: null`**（实测：夜间钢琴曲），不是异常；
   * fork 的端点元数据也把它标成可放行的业务码，所以这里返回空数组，不 throw。
   */
  async getSheetMusic(mid) {
    const data = await txCgi({
      module: 'music.mir.SheetMusicSvr',
      method: 'GetMoreSheetMusic',
      // ttype=0 = 用户上传；ttype=1 的 unique 集合与它相同、但同 scoreMID 会重复（实测 21→42），所以取 0
      param: { songMid: String(mid), begin: 0, end: 100, scoreType: -1, ttype: 0 },
    }, sheetComm()).promise
    if (data?.code !== 0) return []
    return (data?.data?.result ?? [])
      .map(item => {
        const images = (item?.picURLs ?? []).filter(Boolean)
        return {
          id: String(item?.scoreMID ?? ''),
          name: cleanText(item?.scoreName),
          subName: cleanText(item?.subName),
          instrument: cleanText(item?.strInsType),
          scoreType: cleanText(item?.strScoreType),
          cover: item?.coverURL ?? '',
          images,
          pageCount: images.length,
        }
      })
      .filter(item => item.images.length)
  },
}
