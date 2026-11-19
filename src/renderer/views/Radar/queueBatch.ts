import { LIST_IDS } from '@common/constants'
import { setTempList } from '@renderer/store/list/action'
import { tempListMeta } from '@renderer/store/list/state'
import { playInfo, playMusicInfo } from '@renderer/store/player/state'

/**
 * 雷达页「换一批」与播放队列的同步（语义 A：
 * **换一批 = 换队列**，2026-09-23 用户拍板）。
 *
 * 心智模型：屏幕上是啥，队列就是啥。换完之后「下一首」必须走新一屏，而不是上一批。
 * 「当前这首继续播」是这条语义的前提，实现上有一处**非平凡**的约束，见
 * `keepPlayingSongInQueue` 的注释——不处理它会被 `useWatchList` 判成「歌曲被移除」直接跳歌。
 *
 * 只在「当前播的就是这个雷达队列」时重灌：用户切去别处听歌时不打扰他的队列
 * （与 `useRadar.appendToPlayQueue` 的守卫一致）。
 */

/**
 * 新一批里若没有正在播的那首，把它放到**队首**。
 *
 * 为什么必须放（而不是按票面字面「顺其自然成为不在列表里的当前曲」）：队列内容被覆盖后，
 * `useWatchList` 会跑 `updatePlayIndex()`，当前曲不在列表里时 `playIndex` 变 -1，
 * 接着按「歌曲被移除」走 `playNext(true)`（`src/renderer/core/useApp/usePlayer/useWatchList.ts:16-27`）
 * ——正在播的这首会被**直接跳掉**，与「当前这首继续播」冲突。
 * 放队首后 `playIndex` 恒 ≥ 0：当前曲继续播，而「下一首」正好落到新一批的第一首。
 */
export const keepPlayingSongInQueue = <T extends { id: string }>(songs: T[], playing?: T | null): T[] => {
  if (!playing?.id) return songs
  if (songs.some(song => song.id === playing.id)) return songs
  return [playing, ...songs]
}

/** 当前是否正播着这个雷达队列（`tempListMeta.id` 是队列身份，见 OnlineList/usePlay.ts:8-14）。 */
export const isPlayingQueue = (queueId: string) =>
  playInfo.playerListId === LIST_IDS.TEMP && tempListMeta.id === queueId

/**
 * 「换一批」后把新一屏灌进播放队列（**不改播放状态**：不调 `playList`，当前曲照常播）。
 *
 * `setTempList` 内部是原地 `overwriteListMusics`，所以传副本（与
 * `core/player/action.ts:280-282` 的注意事项同源）。
 */
export const refillPlayQueueForBatch = async(
  songs: LX.Music.MusicInfoOnline[],
  queueId: string,
) => {
  if (!songs.length) return
  if (!isPlayingQueue(queueId)) return
  const current = playMusicInfo.musicInfo as LX.Music.MusicInfoOnline | null
  await setTempList(queueId, keepPlayingSongInQueue([...songs], current))
}
