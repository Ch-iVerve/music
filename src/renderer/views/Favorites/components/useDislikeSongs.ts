import { markRawList, reactive } from '@common/utils/vueTools'
import { deduplicationList, toNewMusicInfo } from '@renderer/utils'
import music from '@renderer/utils/musicSdk'

/**
 * 我的收藏 → 「不喜欢」Tab 取数（数据类功能票 02）。
 *
 * 与同页其它 Tab 的分工一致：**取数在这里、展示在组件里**（本仓 §2.5 的「每块取数一个
 * useXxx.ts」）。列表内容是一份云端数据，没有本地版本参与——别与本地不喜欢列表
 * （`core/dislikeList`，按「歌名+歌手」拦播放的那份）混起来，两者是不同的东西。
 *
 * 三条约定：
 *   1. 页面进来就重拉（同 `SongsPanel` 的 `loadFavSongs`）：读只有一两次请求，
 *      逐条补歌曲信息那部分在数据层有缓存（`tx/dislike.js` 的 `detailCache`），重进不会重打。
 *   2. `noItemLabel` 同时是 `material-online-list` 的**容器显隐开关**：有数据时必须给空串。
 *      所以重拉期间**只在列表为空**时落 loading 文案——否则会把上一份数据整块藏起来。
 *   3. 取数失败不抛（落失败文案，§2.11 的弱依赖处理）；**写失败必须抛**（用户主动动作，
 *      由面板弹 dialog，不许静默）。
 */

const t = (key: string, params?: any) => window.i18n.t(key as any, params)

export interface DislikeSongsBlock {
  list: LX.Music.MusicInfoOnline[]
  noItemLabel: string
  isLoading: boolean
  /** 整块失败的标记:空态「重试」键的判据(2026-10-25 UI 审查 P1)。 */
  isLoadFailed: boolean
}

export const dislikedSongs = reactive<DislikeSongsBlock>({
  list: [],
  noItemLabel: '',
  isLoading: false,
  isLoadFailed: false,
})

/** 老式对象 → 新式模型 + 去重 + markRaw（AGENTS §2.10）。 */
const toOnlineSongs = (list: any[]): LX.Music.MusicInfoOnline[] => {
  const mapped = list.map(old => {
    const item = toNewMusicInfo(old) as LX.Music.MusicInfoOnline
    // 详情没补出 mid 的条目：`toNewMusicInfo` 用 songmid 拼 `id`（会得到恒定的 `tx_`），
    // 而虚拟列表按 `id` 做 key、`deduplicationList` 也按 `id` 去重——多条会互相顶掉。
    // 兜一个按数字 songId 的唯一 id：只为「行与行不撞」，不代表它有可播的 mid。
    if (!item.meta.songId) item.id = `tx_dislike_${item.meta.id}`
    return item
  })
  return markRawList(deduplicationList(mapped))
}

/**
 * 拉云端不喜欢列表。切走再切回这个 Tab 会重拉一次（数据可能变），详情那部分走缓存。
 * 失败只落文案 + `console.log`（调用方不处理，§2.11）。
 */
export const loadDislikedSongs = async(): Promise<void> => {
  dislikedSongs.isLoading = true
  dislikedSongs.isLoadFailed = false
  // 有数据时不要落 loading（会藏掉列表，见文件头第 2 条）；首次进来给 loading 文案
  if (!dislikedSongs.list.length) dislikedSongs.noItemLabel = t('list__loading')
  try {
    const res = await music.tx.dislike.getDislikedSongs()
    const next = toOnlineSongs(res?.list ?? [])
    dislikedSongs.list.splice(0, dislikedSongs.list.length, ...next)
    dislikedSongs.noItemLabel = ''
  } catch (err: any) {
    console.log('[favorites] disliked songs', err)
    dislikedSongs.list.splice(0, dislikedSongs.list.length)
    dislikedSongs.noItemLabel = err?.message === 'QQ 音乐未登录' ? t('user_center__need_login') : t('list__load_failed')
    dislikedSongs.isLoadFailed = true
  } finally {
    dislikedSongs.isLoading = false
  }
}

/** 写失败的文案（未登录说人话，其它原样透出——带 QQ 的码，便于贴回来排查）。 */
const removeFailText = (err: any): string =>
  err?.message === 'QQ 音乐未登录' ? t('user_center__need_login') : (err?.message || t('favorites__remove_dislike_failed'))

/**
 * 把一首移出「不喜欢」。**成功后就地删掉这一行**（不重拉整份：写判据已在数据层把过关，
 * 数据层还会读回第一页做成员校验）。
 *
 * 失败抛错（带 QQ 的码），由调用方弹提示——写是用户主动动作，静默失败会让人以为已经生效。
 */
export const removeDislikedSong = async(musicInfo: LX.Music.MusicInfoOnline): Promise<void> => {
  const songId = String(musicInfo?.meta?.id ?? '')
  if (!songId) throw new Error(t('favorites__remove_dislike_failed'))
  try {
    await music.tx.dislike.removeDislikedSongs([songId])
  } catch (err: any) {
    throw new Error(removeFailText(err))
  }
  const index = dislikedSongs.list.findIndex(item => item.id === musicInfo.id)
  if (index > -1) dislikedSongs.list.splice(index, 1)
}

export default () => ({
  dislikedSongs,
  loadDislikedSongs,
  removeDislikedSong,
})
