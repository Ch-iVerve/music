import { markRawList, reactive, ref } from '@common/utils/vueTools'
import { deduplicationList, toNewMusicInfo } from '@renderer/utils'
import music from '@renderer/utils/musicSdk'
import { DAILY_30_QUEUE_ID } from '@renderer/utils/queueIds'
import type { RadarBlock } from './useRadar'
import { refillPlayQueueForBatch } from './queueBatch'

/**
 * 雷达页 →「每日30首」Tab 的取数（2026-09-23 交互与 IA 修复批次 2 / 票 04）。
 *
 * 「每日30首」原先在本仓库**没有任何实现**——它是 QQ 首页 feed 里的一张 `type=500`（歌单卡）卡。
 * 探针实测（脚本 `scripts/verify/probe-qq/probe_daily_card.py`，2026-09-23）：
 *
 *   · 卡片 `id=4279224903`、`miscellany.dirid='202'`（隐藏系统槽位，歌单标题模板「{昵称}的今日私享」）
 *   · `music.srfDissInfo.DissInfo/CgiGetDiss`（`disstid=4279224903`、`dirid=0`、
 *     `song_begin=0`、`song_num=30`）正好返回 **30 首**，`total_song_num=30`、`hasmore=0`；
 *     `song_begin=30` 返回 0 首 → **没有第二页**，所以这里没有「加载更多」，`hasMore` 恒 false
 *   · id 是**长期槽位**（歌单对象建自 2018 前后、`dirinfo.mtime` 是当天）：每天轮换的是内容，不是 id
 *
 * 三条约束照 `useRadar.ts` 的文件头（歌曲必须过 `toNewMusicInfo`；列表只原地改不整体替换；
 * 取数带竞态守卫）；状态同样放模块级——路由页没有 keep-alive，切走再回来组件会重建。
 */

/** 「每日30首」的歌单 id（见上：长期槽位，内容每天换）。 */
export const DAILY_30_TID = '4279224903'

/** 一次拿满：接口上限就是 30 首，没有分页语义。 */
const DAILY_30_NUM = 30

const t = (key: string) => window.i18n.t(key as any)

const daily = reactive<RadarBlock>({
  list: [],
  total: 0,
  page: 1,
  // limit 恒等于已加载条数：让列表内部的分页器不出现（同 useRadar 的写法）
  limit: 1,
  noItemLabel: '',
  hasMore: false,
  isLoading: false,
  moreError: '',
})

const isInited = ref(false)

/** 竞态守卫：连点「换一批」时旧响应可能后到（与 useRadar 的 key 同思路，这里只需要一个递增号）。 */
let dailyKey = 0

/** 失败文案：未登录与真失败分开，别把「没登录」说成「加载失败」。 */
const errorLabel = (err: any) =>
  err?.message === 'QQ 音乐未登录' ? t('user_center__need_login') : t('list__load_failed')

const loadDaily30 = async() => {
  if (daily.isLoading) return
  const key = ++dailyKey
  daily.isLoading = true
  daily.moreError = ''
  daily.noItemLabel = t('list__loading')
  try {
    const res = await music.tx.songList.getListDetailByCgi(DAILY_30_TID, 1, DAILY_30_NUM)
    if (dailyKey !== key) return
    const songs = markRawList(
      deduplicationList((res?.list ?? []).map((item: any) => toNewMusicInfo(item)) as LX.Music.MusicInfoOnline[]),
    )
    // 只做原地改：usePlay 在 setup 时就把数组引用存下来了（同 useRadar 文件头第 2 条）
    daily.list.splice(0, daily.list.length, ...songs)
    daily.total = daily.list.length
    daily.limit = daily.list.length || 1
    daily.page = 1
    daily.hasMore = false
    daily.noItemLabel = daily.list.length ? '' : t('no_item')
    // 「换一批」= 换队列（票 02 的语义 A，两个 tab 同一套）：本 tab 的重拉同样要同步队列
    await refillPlayQueueForBatch(songs, DAILY_30_QUEUE_ID)
  } catch (err: any) {
    if (dailyKey !== key) return
    console.log('[radar] loadDaily30', err)
    // 整块失败：清空并把失败写在空态里（这批没有「翻页失败只提示」那种半保留状态）
    daily.list.splice(0, daily.list.length)
    daily.total = 0
    daily.hasMore = false
    daily.noItemLabel = errorLabel(err)
  } finally {
    if (dailyKey === key) daily.isLoading = false
  }
}

/** 切到「每日30首」时才拉第一次（懒加载：不点这个 Tab 就不打这个请求）。 */
const initDaily30 = async() => {
  if (isInited.value) return
  isInited.value = true
  await loadDaily30()
}

export default () => {
  return {
    daily,
    isInited,
    initDaily30,
    loadDaily30,
  }
}
