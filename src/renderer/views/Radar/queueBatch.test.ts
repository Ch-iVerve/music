import { describe, expect, it } from 'vitest'
import { keepPlayingSongInQueue } from './queueBatch'

/**
 * 钉住的契约：**「换一批」后当前这首必须还在队列里**（语义 A）。
 * 期望值来自那条备注：当前曲不在新一批里时放队首——否则 `useWatchList` 会把
 * `playIndex < 0` 判成「歌曲被移除」并 `playNext(true)`，正在播的这首会被跳掉。
 */
describe('keepPlayingSongInQueue', () => {
  const song = (id: string) => ({ id, name: `song-${id}` })

  it('当前曲在新一批里：原样返回，不重复、不挪位', () => {
    const batch = [song('a'), song('b'), song('c')]
    expect(keepPlayingSongInQueue(batch, song('b'))).toEqual(batch)
  })

  it('当前曲不在新一批里：放到队首（继续播，且下一首落到新一批的第一首）', () => {
    const batch = [song('a'), song('b')]
    expect(keepPlayingSongInQueue(batch, song('old')).map(s => s.id)).toEqual(['old', 'a', 'b'])
  })

  it('没有正在播的歌：原样返回', () => {
    const batch = [song('a')]
    expect(keepPlayingSongInQueue(batch, null)).toBe(batch)
    expect(keepPlayingSongInQueue(batch, undefined)).toBe(batch)
  })

  it('id 为空的伪对象不当作当前曲', () => {
    const batch = [song('a')]
    expect(keepPlayingSongInQueue(batch, song(''))).toBe(batch)
  })
})
