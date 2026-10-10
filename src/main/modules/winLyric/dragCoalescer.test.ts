import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDragCoalescer } from './dragCoalescer'

/**
 * 拖动帧合并器的行为钉子（2026-10-10 随卡顿修复引入）。
 * 协议语义「每帧是自按下以来的总位移」见 `src/renderer-lyric/utils/windowDrag.ts`，
 * 这里只钉合并器的三条纪律：最新者胜 / flushNow 不丢尾帧 / clear 不再触发。
 */

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('createDragCoalescer', () => {
  it('高频 push 只按间隔落地一次，且取最新帧', () => {
    const flushed: number[] = []
    const coalescer = createDragCoalescer<number>(action => flushed.push(action), 16)

    coalescer.push(1)
    coalescer.push(2)
    coalescer.push(3)
    vi.advanceTimersByTime(15)
    expect(flushed).toEqual([])

    vi.advanceTimersByTime(1)
    expect(flushed).toEqual([3])
  })

  it('跨节拍的多帧按节拍分批落地', () => {
    const flushed: number[] = []
    const coalescer = createDragCoalescer<number>(action => flushed.push(action), 16)

    coalescer.push(1)
    vi.advanceTimersByTime(16)
    coalescer.push(2)
    vi.advanceTimersByTime(16)

    expect(flushed).toEqual([1, 2])
  })

  it('flushNow 立即落地暂存帧，且不重复落地（end 时不丢甩动的尾帧）', () => {
    const flushed: number[] = []
    const coalescer = createDragCoalescer<number>(action => flushed.push(action), 16)

    coalescer.push(9)
    coalescer.flushNow()
    expect(flushed).toEqual([9])

    vi.advanceTimersByTime(50)
    expect(flushed).toEqual([9])
  })

  it('clear 丢弃暂存帧且不再触发 flush（start 时清上一轮残帧）', () => {
    const flushed: number[] = []
    const coalescer = createDragCoalescer<number>(action => flushed.push(action), 16)

    coalescer.push(7)
    coalescer.clear()
    vi.advanceTimersByTime(50)

    expect(flushed).toEqual([])
  })
})
