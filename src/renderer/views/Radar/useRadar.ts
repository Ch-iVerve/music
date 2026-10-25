import { markRawList, reactive, ref } from '@common/utils/vueTools'
import { deduplicationList, toNewMusicInfo } from '@renderer/utils'
import { LIST_IDS } from '@common/constants'
import { addListMusics, getListMusicsFromCache } from '@renderer/store/list/action'
import { tempListMeta } from '@renderer/store/list/state'
import { playInfo } from '@renderer/store/player/state'
import music from '@renderer/utils/musicSdk'
import { RADAR_QUEUE_ID } from '@renderer/utils/queueIds'
import { refillPlayQueueForBatch } from './queueBatch'

/**
 * 雷达页（`/radar`）取数。数据来自 `GetRadarSong`（`tx/recommend.js` 的 getRadarRecommend），
 * 与发现页原来那个雷达区块**是同一个接口**——2026-09-23 从 `views/Discover/useDiscover.ts`
 * 搬到这里，不是复制（工单 01 的验收口径）。
 *
 * 三条约束是从发现页原样带过来的，改之前先读：
 *
 *   1. 🔴 **歌曲必须过 `toNewMusicInfo`**：数据层（`musicSdk/tx/**`）流通的是老式平铺对象，
 *      而 UI 侧读的是 `item.meta._qualitys`，漏了转换不是显示难看，是渲染期抛错。
 *   2. 🔴 **列表只做原地改（splice/push），不整体替换数组**：`usePlay` 在 setup 时就把
 *      `props.list` 的数组引用存下来了（`components/material/OnlineList/usePlay.ts:22`），
 *      换成新数组会让双击播放读到旧数组。
 *   3. **翻页带 key 竞态守卫**：连点「加载更多」时旧请求可能后到，回来先比 key。
 *
 * 状态放模块级（不是组合函数的局部变量）：路由页没有 keep-alive，切走再回来组件会重建，
 * 状态留在模块里才能「切回来立刻显示上次的内容」，`isInited` 则避免再打一轮请求。
 */

const t = (key: string) => window.i18n.t(key as any)

/** 雷达列表的区块状态（发现页 SongBlock 的同形状，字段含义见那边的注释）。 */
export interface RadarBlock {
  list: LX.Music.MusicInfoOnline[]
  total: number
  page: number
  limit: number
  noItemLabel: string
  /** 服务端 `HasMore` 恒为 true（`tx/recommend.js:241-242`），所以按钮一直在。 */
  hasMore: boolean
  /** 供「加载更多」按钮做禁用态（失败后必须还能重试，所以不能拿文案当判据）。 */
  isLoading: boolean
  /** 翻页失败只提示、不清空已有内容。 */
  moreError: string
  /** 整块失败(非翻页失败)的标记:空态「重试」键的判据(2026-10-25 UI 审查 P1)。 */
  isLoadFailed: boolean
}

const radar = reactive<RadarBlock>({
  list: [],
  total: 0,
  page: 1,
  // limit 恒等于「已加载条数」：让列表内部的分页器不出现（Pagination 在 maxPage <= 1 时不渲染），
  // 翻页统一走页面自己的「加载更多」按钮。
  limit: 1,
  noItemLabel: '',
  hasMore: false,
  isLoading: false,
  moreError: '',
  isLoadFailed: false,
})

let radarKey = ''

const isInited = ref(false)

/**
 * 轮播游标（**按来源分槽**）。
 *
 * 放模块级的理由和列表数据一样：路由页没有 keep-alive，切走再回来组件会重建——
 * 游标留在组件内 `ref` 里就会归零（用户 2026-09-23 报的「跳去歌手页再回来位置重置」）。
 * 分槽是为「每日30首 / 雷达推荐」两个 Tab 各记一份（票 04），票 02 只落 `radar` 槽。
 *
 * 不落盘：重启不需要恢复（和列表滚动位置那种持久化不是一回事）。
 */
const cursors = reactive<Record<string, number>>({ radar: 0 })

const getCursor = (slot = 'radar') => cursors[slot] ?? 0
const setCursor = (index: number, slot = 'radar') => { cursors[slot] = index }
/** 「换一批」后游标要回到第 1 张（否则会出现「换完停在原编号」的错位感）。 */
const resetCursor = (slot = 'radar') => { cursors[slot] = 0 }

/** 老式对象 → 新式模型 + 去重 + markRaw（列表不进深度代理，AGENTS §2.10）。 */
const toOnlineSongs = (list: any[]): LX.Music.MusicInfoOnline[] => {
  const next = deduplicationList(list.map(item => toNewMusicInfo(item)) as LX.Music.MusicInfoOnline[])
  return markRawList(next)
}

/** 整块替换（保持数组引用不变，见文件头第 2 条）。 */
const setSongs = (songs: LX.Music.MusicInfoOnline[]) => {
  radar.list.splice(0, radar.list.length, ...songs)
  radar.total = radar.list.length
  radar.limit = radar.list.length || 1
  // 整块换掉（首屏 / 换一批 / 失败清空）后，原来的游标已经没有意义
  resetCursor()
}

/** 追加（「加载更多」）。 */
const appendSongs = (songs: LX.Music.MusicInfoOnline[]) => {
  radar.list.push(...songs)
  radar.total = radar.list.length
  radar.limit = radar.list.length || 1
}

/**
 * 雷达在播时，翻页新拿到的推荐接到**播放队列尾部**（ui-polish 工单 07）。
 *
 * 雷达是流式推荐（一次给一屏、`HasMore` 恒 true），「一键播放」如果不能续播，
 * 播完一屏就停——那不叫一键播放。只在「当前队列就是雷达队列」时追加，
 * 用户切去别处听歌时不打扰他的队列。
 */
const appendToPlayQueue = async(songs: LX.Music.MusicInfoOnline[]) => {
  if (!songs.length) return
  if (playInfo.playerListId !== LIST_IDS.TEMP || tempListMeta.id !== RADAR_QUEUE_ID) return
  const queued = new Set(getListMusicsFromCache(LIST_IDS.TEMP).map(song => song.id))
  const next = songs.filter(song => !queued.has(song.id))
  if (!next.length) return
  await addListMusics(LIST_IDS.TEMP, next, 'bottom')
}

/** 失败文案：未登录与真失败分开，别把「没登录」说成「加载失败」。 */
const errorLabel = (err: any) =>
  err?.message === 'QQ 音乐未登录' ? t('user_center__need_login') : t('list__load_failed')

const loadRadar = async(page = 1, more = false) => {
  if (radar.isLoading) return
  const key = `radar__${page}`
  radarKey = key
  radar.isLoading = true
  radar.moreError = ''
  radar.isLoadFailed = false
  if (!more) radar.noItemLabel = t('list__loading')
  try {
    const res = await music.tx.recommend.getRadarRecommend(page)
    if (radarKey !== key) return
    const songs = toOnlineSongs(res?.list ?? [])
    if (more) {
      appendSongs(songs)
      await appendToPlayQueue(songs)
    } else {
      setSongs(songs)
      // 「换一批」= 换队列（票 02 的语义 A）：正在播雷达队列时把新一屏灌进去，当前这首继续播
      await refillPlayQueueForBatch(songs, RADAR_QUEUE_ID)
    }
    radar.page = page
    radar.hasMore = res?.hasMore === true
    radar.noItemLabel = radar.list.length ? '' : t('no_item')
    radar.isLoadFailed = false
  } catch (err: any) {
    if (radarKey !== key) return
    console.log('[radar] loadRadar', err)
    // 翻页失败只提示、不动已有内容：这里若落 noItemLabel 会把整块内容一起藏掉
    if (more) radar.moreError = errorLabel(err)
    else {
      setSongs([])
      radar.hasMore = false
      radar.noItemLabel = errorLabel(err)
      radar.isLoadFailed = true
    }
  } finally {
    radar.isLoading = false
  }
}

const initRadar = async(force = false) => {
  if (isInited.value && !force) return
  isInited.value = true
  await loadRadar(1, false)
}

export default () => {
  return {
    radar,
    isInited,
    initRadar,
    loadRadar,
    cursors,
    getCursor,
    setCursor,
    resetCursor,
  }
}
