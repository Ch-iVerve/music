import {
  insertItems,
  isBackfilled,
  lastMondayDate,
  markAllRead,
  markBackfilled,
  queryBaselineAll,
  queryItems,
  querySummary,
  queryUnreadCount,
  saveBaseline,
} from './dbHelper'

/**
 * 关注动态的持久化域（票 02）。
 *
 * 只做「存与取」，不含任何检测逻辑：哪些算新、什么时候跑一轮，都在渲染侧的关注动态模块里。
 *
 * 读接口是同步的（Comlink 会把返回值包成 Promise 交给调用方）、写接口也不标 `async`——
 * 与 `music_url` 域的既有形状一致（`musicUrlCount` 同步、`musicUrlSave` 非 async 包装）。
 */

/** 读全部基线 */
export const followFeedBaselineAll = (): LX.FollowFeed.Baseline[] => queryBaselineAll()

/**
 * 批量写基线（一轮扫描的落点）。
 *
 * 三个写接口都**不是 `async`**、也不返回 promise——与 `modules/music_url` 的 `musicUrlSave` 同一形状：
 * dbHelper 里的事务是同步跑完的（没有 `await` 打断），Comlink 那侧等这个同步返回就够了。
 */
export const followFeedBaselineSave = (rows: LX.FollowFeed.BaselineInput[]) => {
  saveBaseline(rows)
}

/** 读时间线（发布时间倒序） */
export const followFeedItemsGet = (): LX.FollowFeed.Item[] => queryItems()

/** 批量写条目（含按上限清理） */
export const followFeedItemsAdd = (items: LX.FollowFeed.ItemInput[]) => {
  insertItems(items)
}

/** 未读条目数（左栏角标） */
export const followFeedUnreadCount = (): number => queryUnreadCount()

/** 监控数 + 上次成功覆盖时间（页面顶部的两个数） */
export const followFeedSummary = (): LX.FollowFeed.Summary => querySummary()

/** 全部标为已读（进入页面时调用） */
export const followFeedMarkAllRead = () => {
  markAllRead()
}

/** 存量补齐是否已完成（一次性标记，`db_info` 的 kv） */
export const followFeedIsBackfilled = (): boolean => isBackfilled()

/** 标记存量补齐已完成（整轮全成功才写，见 `core/followFeed/check.ts`） */
export const followFeedMarkBackfilled = () => {
  markBackfilled()
}

/** 展示窗口的下界（上周一，`YYYY-MM-DD`）——测试用它造窗口内/外的日期 */
export const followFeedWindowCutoff = () => lastMondayDate()
