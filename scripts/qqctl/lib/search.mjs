import { asArray, guestComm, signedPost } from './tx.mjs'

/**
 * QQ 音乐搜索（music.search.SearchCgiService/DoSearchForQQMusicDesktop）与「歌手 - 歌名」匹配打分。
 * 端点照 src/renderer/utils/musicSdk/tx/musicSearch.js（2026-09-23 实测同一端点支持全部 search_type）。
 */

const SEARCH_TYPE = { song: 0, singer: 1, album: 2 }

export const stripEm = value => String(value ?? '').replace(/<\/?em>/g, '')
/** 匹配归一化：去首尾空白、压空白、统一小写——中文不受影响，英文歌名大小写差异不误伤。 */
export const norm = value => String(value ?? '').trim().toLowerCase().replace(/\s+/g, '')

/** PC 客户端形态的 searchid（照 musicSearch.js：32 位大写 hex + 5 位补零随机数）。 */
const getSearchId = () => {
  let guid = ''
  for (let i = 0; i < 32; i++) guid += Math.floor(Math.random() * 16).toString(16)
  return guid.toUpperCase() + String(Math.floor(Math.random() * 100000)).padStart(5, '0')
}

/** singer 字段收敛：常规是 [{name}]，实测网关偶发回单对象或裸串（2026-09-28 冒烟撞过），三种都认。 */
export const singerNames = raw => {
  const list = Array.isArray(raw) ? raw : raw == null || raw === '' ? [] : [raw]
  return list.map(s => (typeof s === 'string' ? s : s?.name ?? '')).filter(Boolean).join('/')
}

/** 搜索一行原始结果 → 统一歌曲行。`songType` 是 QQ 原始 `type`，写歌单（AddSonglist）要原样带上。 */
export const toSongRow = item => ({
  songId: item?.id,
  songType: item?.type ?? 0,
  song: stripEm(item?.name),
  singer: singerNames(item?.singer),
  album: stripEm(item?.album?.name),
})

/** search 的结果行按类型整形（song 之外只挑常用键；mv/songlist 两类未沉淀，别放开）。 */
const shapeTyped = (type, list) => {
  if (type === 'song') return list.map(toSongRow)
  if (type === 'singer') {
    return list.map(item => ({ id: String(item?.singerMID ?? ''), name: stripEm(item?.singerName), songNum: Number(item?.songNum ?? 0) }))
  }
  return list.map(item => ({ id: String(item?.albumMID ?? ''), name: stripEm(item?.albumName), singer: stripEm(item?.singerName) }))
}

/** type 参数白名单（SEARCH_TYPE 的键），非法值在入口拦掉而不是打成 undefined 发出去。 */
export const parseSearchType = value => {
  if (!(value in SEARCH_TYPE)) throw new Error(`不支持的搜索类型：${value}（可用：${Object.keys(SEARCH_TYPE).join('/')}）`)
  return value
}

export { asArray } from './tx.mjs'

export const search = async(query, { type = 'song', num = 20 } = {}) => {
  const typeKey = parseSearchType(type)
  const moduleKey = 'music.search.SearchCgiService'
  const payload = await signedPost({
    comm: guestComm(),
    [moduleKey]: {
      module: moduleKey,
      method: 'DoSearchForQQMusicDesktop',
      param: {
        grp: 1,
        num_per_page: num,
        page_num: 1,
        query,
        remoteplace: 'txt.newclient.top',
        search_type: SEARCH_TYPE[typeKey],
        searchid: getSearchId(),
      },
    },
  })
  const node = payload?.[moduleKey] ?? payload?.req
  if (!node || payload.code != 0 || node.code != 0) {
    throw new Error(`搜索被拒: code=${payload?.code}/${node?.code}`)
  }
  const list = asArray(
    typeKey === 'song' ? node.data?.body?.song?.list : node.data?.body?.[typeKey]?.list,
    `body.${typeKey}.list`,
  )
  return { list: shapeTyped(typeKey, list), total: Number(node.data?.meta?.estimate_sum ?? node.data?.meta?.sum ?? list.length) }
}

/** 专辑名含这些痕迹 = 现场/综艺版嫌疑（2026-09-29 实战：乐夏版抢了录音室版的搜索首位）。 */
export const LIVE_ALBUM_RE = /乐队的夏天|歌手\s?20|现场|演唱会|Live|live|我们的歌|闪光的|天赐|披荆|时光|第\s?\d+\s?期/

/**
 * 「歌手 - 歌名」匹配打分（2026-09-28 大运河音乐节实战沉淀）。吃 **search() 的整形行**
 * （songId/song/singer/album）——别再喂原始网关行：整形行没有 name/singer[]，重整形会
 * 全部判空（2026-09-28 冒烟撞过，症状是「歌手对、歌名空、分数骤降」）。
 *
 * score = [歌名全等2|含1]×10 + [歌手全等2|含1] - [专辑是现场/综艺版 5]；
 * **≥22 才高置信**——21 分几乎都是「歌手名带乐队后缀」（二手玫瑰乐队/盘尼西林乐队）这类
 * 人工可确认但机器不敢单独拍板的形态，宁可交人工。带正式专辑名的候选借降权输给 live 版
 * 时会自然排到前面（「能用专辑要用专辑」是 2026-09-29 用户的明确要求）。
 * 候选按分数降序带前 5 条，给人工定案用。
 */
export const pickBest = (rows, singer, song) => {
  const scored = (rows ?? []).map(row => {
    const singers = String(row.singer ?? '').split('/')
    const nameMatch = norm(row.song) === norm(song)
    const nameContain = norm(row.song).includes(norm(song))
    const singerMatch = singers.some(n => norm(n) === norm(singer))
    const singerContain = singers.some(n => norm(n).includes(norm(singer)))
    const liveAlbum = LIVE_ALBUM_RE.test(String(row.album ?? ''))
    return {
      ...row,
      score: (nameMatch ? 2 : nameContain ? 1 : 0) * 10 + (singerMatch ? 2 : singerContain ? 1 : 0) - (liveAlbum ? 5 : 0),
    }
  })
  scored.sort((a, b) => b.score - a.score)
  const best = scored[0]
  return {
    confident: Boolean(best) && best.score >= 22,
    best: best ?? null,
    candidates: scored.slice(0, 5),
  }
}
