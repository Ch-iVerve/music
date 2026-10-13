import { describe, expect, it } from 'vitest'
import {
  ONLINE_LIST_FALLBACK_QUEUE_ID, BOARD_QUEUE_PREFIX, DAILY_30_QUEUE_ID, DISLIKE_SONGS_QUEUE_ID, FAV_SONGS_QUEUE_ID, FOLLOW_FEED_ALBUM_ID_PREFIX, FOLLOW_FEED_QUEUE_ID, RADAR_QUEUE_ID,
  albumQueueId, boardQueueId, cloudQueueId, newSongsQueueId, searchQueueId, singerSongsQueueId, songListQueueId,
} from './queueIds'

/**
 * 队列身份的**生成函数稳定性**（票 06 M3 的验收项）—— dom project（`src/renderer/utils/*.test.ts`）。
 *
 * 这些返回值会被存进 `tempListMeta.id` 再与宿主页的 `:list-id` 逐字符比对，所以钉两件事：
 *   1. 同输入同输出（生成函数是纯函数，不掺时间戳/随机数）；
 *   2. 归一化口径（`null`/`undefined` → 前缀 + 空串），以及「前缀常量与生成函数同源」
 *      ——`syncSourceList` 靠 `BOARD_QUEUE_PREFIX` 反解 `boardQueueId()` 的输出，这一条断了
 *      就是「复制到我的歌单」的榜单同步悄悄失效。
 */
describe('utils/queueIds', () => {
  it('生成函数同输入同输出', () => {
    for (const run of [albumQueueId, songListQueueId, boardQueueId, cloudQueueId, searchQueueId, singerSongsQueueId, newSongsQueueId]) {
      const first = run('abc')
      expect(run('abc')).toBe(first)
      expect(run('abc')).toBe(first)
    }
  })

  it('各生成函数前缀正确、拼的是原样 id', () => {
    expect(albumQueueId('mid1')).toBe('album__mid1')
    expect(songListQueueId('978')).toBe('tx__978')
    expect(boardQueueId('26')).toBe('board__26')
    expect(cloudQueueId('126')).toBe('cloud_126')
    expect(searchQueueId('周杰伦')).toBe('search__周杰伦')
    expect(singerSongsQueueId('singerMid')).toBe('singer__songs__singerMid')
    expect(newSongsQueueId(1)).toBe('discover__new_songs__1')
  })

  it('null / undefined 归一成「前缀 + 空串」（路由 query 未就绪时的老口径）', () => {
    expect(albumQueueId(null)).toBe('album__')
    expect(albumQueueId(undefined)).toBe('album__')
    expect(songListQueueId(null)).toBe('tx__')
    expect(singerSongsQueueId(undefined)).toBe('singer__songs__')
  })

  it('数字与字符串形态拼出来一致（调用点两边都有）', () => {
    expect(cloudQueueId(126)).toBe(cloudQueueId('126'))
    expect(boardQueueId(26)).toBe(boardQueueId('26'))
  })

  it('BOARD_QUEUE_PREFIX 与 boardQueueId 同源（syncSourceList 反解依赖这一条）', () => {
    const identity = boardQueueId('26')
    expect(identity.startsWith(BOARD_QUEUE_PREFIX)).toBe(true)
    expect(identity.slice(BOARD_QUEUE_PREFIX.length)).toBe('26')
  })

  it('FOLLOW_FEED_ALBUM_ID_PREFIX 拼出的是与时间线不同的身份', () => {
    expect(`${FOLLOW_FEED_ALBUM_ID_PREFIX}item1`).not.toBe(FOLLOW_FEED_QUEUE_ID)
  })

  it('自造常量值稳定（改动等于把「正在播放那一行」的回归面全开）', () => {
    expect(FAV_SONGS_QUEUE_ID).toBe('fav__songs')
    expect(DISLIKE_SONGS_QUEUE_ID).toBe('dislike__songs')
    expect(RADAR_QUEUE_ID).toBe('radar__recommend')
    expect(DAILY_30_QUEUE_ID).toBe('daily30__recommend')
    expect(FOLLOW_FEED_QUEUE_ID).toBe('follow_feed__timeline')
    expect(ONLINE_LIST_FALLBACK_QUEUE_ID).toBe('online_list__temp')
  })
})
