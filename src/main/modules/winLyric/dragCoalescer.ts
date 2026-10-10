/**
 * 拖动帧合并器：把高频到达的拖动帧收敛成至多每 `intervalMs` 一帧。
 *
 * 为什么要在主进程合并（2026-10-10 实测）：拖动/缩放的每一帧都是一次
 * `setContentBounds`（X11 重组态 + WM 重排），mousemove 的到达频率跟着鼠标报告率走
 * （常见 125–1000Hz），不设上限时主进程事件循环被灌满，实测拖动期间应用进程树
 * CPU ~18%、窗口跟手严重滞后。合并到 ~60fps 后，每帧只剩一次窗口写入。
 *
 * 为什么丢中间帧是无损的：拖动协议里每个 update 携带的是「自按下以来的**总**位移」
 * （见 `src/renderer-lyric/utils/windowDrag.ts` 与 `applyWindowDrag` 的注释），
 * 后一帧完全覆盖前一帧的语义，只取最新即可，不需要任何插值或补齐。
 */

/** 落地节拍：16ms ≈ 60Hz，与显示刷新对齐 */
export const DRAG_FLUSH_INTERVAL_MS = 16

export interface DragCoalescer<T> {
  /** 记录一帧；已是最新则覆盖（同一节拍内只保留最后一帧） */
  push: (action: T) => void
  /** 同步冲刷暂存帧。拖动结束（end）时必须调：否则快速甩动松手后，最后一帧被节拍器吞掉，窗口停在松手前的位置 */
  flushNow: () => void
  /** 丢弃暂存帧并取消定时。新一轮拖动 start 时调：上一轮残帧的位移相对新基准没有意义 */
  clear: () => void
}

export const createDragCoalescer = <T>(flush: (action: T) => void, intervalMs = DRAG_FLUSH_INTERVAL_MS): DragCoalescer<T> => {
  let pending: T | null = null
  let timer: NodeJS.Timeout | null = null

  const runFlush = () => {
    timer = null
    if (pending == null) return
    const action = pending
    pending = null
    flush(action)
  }

  return {
    push(action) {
      pending = action
      if (!timer) timer = setTimeout(runFlush, intervalMs)
    },
    flushNow() {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      runFlush()
    },
    clear() {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      pending = null
    },
  }
}
