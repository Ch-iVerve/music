import { markRaw } from '@common/utils/vueTools'
import { createFollowFeedScheduler, type FollowFeedScheduler } from '@renderer/core/followFeed/schedule'
import { runCheck } from '@renderer/core/followFeed/check'
import {
  getFollowFeedItems,
  getFollowFeedSummary,
  getFollowFeedUnreadCount,
  getQQAuthStatus,
  markFollowFeedAllRead,
} from '@renderer/utils/ipc'
import { followFeedState } from './state'

/**
 * 关注动态的状态变更（渲染侧）。
 *
 * 这里只做「读库 → 落进 state」与「标已读」，**不含检测**：一轮检查怎么跑、哪些算新，
 * 在 `core/followFeed/` 里。
 */

/**
 * 把库里的现状读回 state（条目 / 未读 / 汇总）。
 *
 * 页面挂载时、一轮检查结束后、以及左栏角标初始化时都要调它——所以它是幂等的只读操作。
 * `items` 用 `markRaw` 交给 state：条目是**只读的展示数据**，整表做完响应式代理没有收益，
 * 反而会让 100 条 × 十余字段的对象图全变成 Proxy（仓库惯例，见 `store/user/state.ts`）。
 */
export const loadFollowFeed = async() => {
  const [items, unreadCount, summary] = await Promise.all([
    getFollowFeedItems(),
    getFollowFeedUnreadCount(),
    getFollowFeedSummary(),
  ])
  followFeedState.items = markRaw(items)
  followFeedState.unreadCount = unreadCount
  followFeedState.monitoredCount = summary.monitoredCount
  followFeedState.lastSuccessAt = summary.lastSuccessAt
}

/**
 * 进入页面：先记下「本次未读」的条目，再把它们全部置为已读、角标清零。
 *
 * 顺序不能反——置完已读就分辨不出哪几条是这次的新内容了（页内标记依赖 `freshIds`）。
 * 进入页面会**重置** `freshIds`（一次进入 = 一批「本次新增」）。
 */
export const openFollowFeed = async() => {
  await loadFollowFeed()
  followFeedState.freshIds = []
  await markSeen()
}

/**
 * 把当前未读的条目标成已读，并把它们并入「本次新增」的那组 id。
 *
 * 两个调用点：进入页面（`openFollowFeed`），以及**页面开着时一轮检查刚插进新条目**——
 * 后者由页面 watch 未读数后调用它。用**并入**而不是重置，是因为用户可能还停在页面上，
 * 上一批的「本次新增」标记不该因为又来了一批就消失。
 */
export const markSeen = async() => {
  const fresh = followFeedState.items.filter(item => item.read === 0).map(item => item.id)
  if (!fresh.length) return
  followFeedState.freshIds = Array.from(new Set([...followFeedState.freshIds, ...fresh]))
  await markFollowFeedAllRead()
  // 只改内存里的标记，不重读列表：库那边已经全置 1，重读只是白跑一趟
  for (const item of followFeedState.items) item.read = 1
  followFeedState.unreadCount = 0
}

/**
 * 只刷新左栏角标（不读整份列表）。
 *
 * 左栏在每个页面都渲染，不该为了一个数字把 100 条条目读出来——这也是 `get_summary` /
 * `get_unread_count` 这两个通道单独存在的原因。
 */
export const loadFollowFeedBadge = async() => {
  followFeedState.unreadCount = await getFollowFeedUnreadCount()
}

// ---------------------------------------------------------------- 一轮检查与节奏（票 04/06）

/**
 * 跑一轮检查，并把结果落进 state。
 *
 * 两条刻意的行为：
 * - **未登录时静默跳过**（也不是失败）：页面本来就有登录引导，这里不该靠失败重试去提醒；
 *   跳过时**不写基线**，所以「上次成功检查」的时间也不会动——它只表示真的跑通了一轮。
 * - **失败时向上抛**：调用方（调度器）据此累计失败次数并降频。`lastError` 同时落进 state 供页面显示。
 */
export const performFollowFeedCheck = async() => {
  const status = await getQQAuthStatus()
  if (!status.isLogin) return
  if (followFeedState.isChecking) return
  followFeedState.isChecking = true
  try {
    await runCheck()
    followFeedState.lastError = null
  } catch (err) {
    followFeedState.lastError = { at: Date.now(), reason: err instanceof Error ? err.message : String(err) }
    throw err
  } finally {
    followFeedState.isChecking = false
  }
  await loadFollowFeed()
}

/** 调度器实例（模块级单例：`start` 幂等，别为它建 store 状态——它没有 UI） */
let scheduler: FollowFeedScheduler | null = null

/**
 * 启动后自动跑一次，之后每 30 分钟一轮（连续失败自动降频）。
 *
 * 幂等：`init()` 在 deeplink/activate 时会被再次调用（见 `main/index.ts`），
 * 所以这里判断「已经起过就直接返回」，否则每次唤起应用都会多一条定时链。
 */
export const startFollowFeedSchedule = async() => {
  if (scheduler) return
  scheduler = createFollowFeedScheduler({ run: performFollowFeedCheck })
  await scheduler.start()
}

export const stopFollowFeedSchedule = () => {
  scheduler?.stop()
  scheduler = null
}

/**
 * 手动刷新（页面顶部的按钮）：立刻跑一轮，并**重置退避**——用户修好了网络就不该再等 6 小时。
 * 调度器还没起来时（例如页面比初始化序列先到）退化成「只跑这一轮」。
 */
export const refreshFollowFeed = async() => {
  if (scheduler) return scheduler.trigger()
  await performFollowFeedCheck()
  await loadFollowFeed()
}
