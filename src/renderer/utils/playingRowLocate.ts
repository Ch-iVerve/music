/**
 * 「定位到正在播放」的判定、居中算法与落点登记（ui-polish-3 工单 08）。
 *
 * 三件事放一个文件，是因为它们说的是同一件事——**当前这份列表里正在播的是哪一行、怎么把它摆到
 * 列表中间、播放栏那个按钮此刻该找谁**。前两件是纯函数（单测在 `playingRowLocate.test.ts`），
 * 第三件是模块级的一小份登记表（列表挂载时登记、卸载时注销）。
 *
 * ⚠️ 为什么「当前页能不能原地定位」必须由**列表自己登记**，播放栏看路由算不出来：
 * - 本地歌曲表在 `/playlists?id=…`，队列身份恰好等于该 id，路由还能推；
 * - 在线歌曲表的宿主页却千差万别：`/album?mid=…` 的队列是 `album__<mid>`、`/musicHall` 的榜单是
 *   `board__<id>`、`/favorites` 是 `fav__songs`、歌手页是 `singer__songs__<mid>`（各宿主的
 *   `:list-id`，字面量的家都在 `utils/queueIds.ts`），而 `/album` 页根本不在 `/list` 这条路由上。
 * 只有列表组件同时握着「本列表的内容」与「真实容器几何」，所以由它回答，播放栏问一次。
 */
import { ref } from '@common/utils/vueTools'
import { LIST_IDS } from '@common/constants'

export interface PlayingRowLocator {
  /** 此刻能不能原地定位：这首歌真在这份列表里，且这份列表可见（同一页里被 v-show 藏起来的那份不该抢答） */
  canLocate: () => boolean
  /** 把这首歌滚到列表中间（末尾附近居中不了的情况由调用方按 clamp 后的位置滚） */
  locate: () => void
}

/** 挂载中的歌曲表登记的能力。模块级：路由页切走即注销，不留残影。 */
const locators: PlayingRowLocator[] = []

/**
 * 登记表的版本号：播放栏那个按钮的可用状态靠它感知（登记 / 注销都会 +1）。
 * 列表在页间切换时不是靠数据变化，而是靠挂载与卸载——没有这个计数器，按钮会一直停在旧状态。
 */
const locatorVersion = ref(0)

/**
 * 登记一份列表的定位能力，返回注销函数（组件 `onBeforeUnmount` 里调用）。
 */
export const registerPlayingRowLocator = (locator: PlayingRowLocator): (() => void) => {
  locators.push(locator)
  locatorVersion.value++
  return () => {
    const index = locators.indexOf(locator)
    if (index > -1) {
      locators.splice(index, 1)
      locatorVersion.value++
    }
  }
}

/** 当前页有没有能原地定位的列表（播放栏据此决定按钮亮不亮）。读它就是响应式的。 */
export const hasPlayingRowLocator = (): boolean => {
  void locatorVersion.value
  return locators.some(locator => locator.canLocate())
}

/**
 * 让能原地定位的那份列表去定位。没人接返回 `false`——调用方据此改走「跳到这首歌所在的列表」
 * （与播放栏进度区点击同一个落点）。
 */
export const locatePlayingRow = (): boolean => {
  // 从后往前：同一页挂了两份列表时（tab 用 v-show），后登记的那份才是用户当时点开的那一份；
  // 藏起来的那份由各自的 `canLocate()` 用可见性判掉，不会抢答。
  for (let i = locators.length - 1; i >= 0; i--) {
    const locator = locators[i]
    if (!locator.canLocate()) continue
    locator.locate()
    return true
  }
  return false
}

/** 播放栏那个按钮此刻可不可用：没有正在播放的歌（没播过 / 队列里没有位置）就没得定位。 */
export const canLocatePlayingRow = (playIndex: number, musicInfo: unknown) =>
  playIndex >= 0 && musicInfo != null

/**
 * 这首歌所在的列表里，有没有**可以跳过去的列表页**；有就返回它的 id，没有返回空串。
 *
 * 只有本地自建列表有 `/list?id=…` 这个落点。在线队列的列表身份（`album__<mid>`、`board__<id>`、
 * `online_list__temp`…）在路由上不存在，跳过去只会落到「我的歌单」的兜底列表上（与播放栏进度区
 * 点击是同一件事的坑，见票面「遗留与不确定点」）——所以这里直接判掉：按钮灰掉，
 * 比把人带到一个不相干的列表上要好。
 */
export const findJumpableListId = (listId: string | null, userListIds: string[]): string => {
  // 在线队列在播放器里的列表 id 恒为 `temp`（见 `core/player/action.ts` 的 `playMusicList`）
  if (!listId || listId == LIST_IDS.TEMP) return ''
  return userListIds.includes(listId) ? listId : ''
}

/**
 * 正在播放那首歌在**当前列表**里的行号；不在本列表里返回 `-1`。
 *
 * `isPlayingList`（本列表就是当前播放队列）这道闸必须有：不同列表可能含同一首歌，
 * 只有队列自己的列表里那一行才是「正在播放」的语义。
 * `playingMusicId` 的比对是第二道闸：没有传 `listId` 的宿主页共用同一个兜底身份
 * （`online_list__temp`，见 `OnlineList/usePlay.ts` 的 `getQueueId`），而身份相等不代表内容相等，
 * 那时 `playIndex` 指的是**另一个列表**的行号，按 id 找回来才不会点错行。
 * 第一道闸过了但 `playIndex` 对不上（列表在播放之后被编辑过）时同样按 id 兜底找一遍。
 */
export const findPlayingRowIndex = ({ list, isPlayingList, playIndex, playingMusicId }: {
  list: LX.Music.MusicInfo[]
  isPlayingList: boolean
  playIndex: number
  playingMusicId?: string | null
}): number => {
  if (!isPlayingList || !list.length || playingMusicId == null) return -1
  // id 用 `==` 比（同 `store/player/action.ts` 的 `getPlayIndex`）：本地/在线两侧的 id 类型不保证一致，
  // 这里要的是「同一首歌」而不是类型相等
  if (playIndex >= 0 && playIndex < list.length && list[playIndex].id == playingMusicId) return playIndex
  return list.findIndex(item => item.id == playingMusicId)
}

/**
 * 把第 `index` 行摆到列表中间时该设的 `scrollTop`。
 *
 * 居中口径：行的中点在容器中线上 → `index * itemHeight - (containerHeight - itemHeight) / 2`。
 * - 首行附近算出来是负数 → 夹到 `0`；
 * - 末尾附近行下方的内容不够（含整个列表不足一屏）→ 夹到最大可滚位置，即**滚到底**，
 *   不返回越界值（`VirtualizedList` 的动画路径也会再夹一次，这里先算对，非动画路径才不出偏差）。
 * 取整是为了避免半像素 `scrollTop` 让表格文字发虚。
 */
export const getCenteredScrollTop = ({ index, itemHeight, containerHeight, contentHeight }: {
  index: number
  itemHeight: number
  containerHeight: number
  contentHeight: number
}): number => {
  const target = index * itemHeight - (containerHeight - itemHeight) / 2
  const max = Math.max(contentHeight - containerHeight, 0)
  return Math.round(Math.min(Math.max(target, 0), max))
}
