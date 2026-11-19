import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 搜索历史的**失败收口**（2026-09-26 审查）。
 *
 * 真机症状：搜索历史走 IPC 读写，读接口挂掉时 `getHistoryList()` 的 rejection 直接冒到顶层——
 * 三个调用点（`views/Search/components/BlankView.vue` 的 `void getHistoryList()`、
 * 两个 `useList` 的 `void addHistoryWord(text)`）谁都没接 → dev 下 webpack-dev-server 弹全屏
 * 错误浮层，**吞掉真实鼠标输入**（同类问题已修过一例）。
 *
 * 契约（照同文件 `hotSearch.catch` 的口径）：历史词是非关键路径，读不到就当没有历史、
 * 写不下就只记日志，**一律不抛给调用方**。这里钉住这两个行为。
 */

const ipc = vi.hoisted(() => ({
  getSearchHistoryList: vi.fn(),
  saveSearchHistoryList: vi.fn(),
}))

vi.mock('@renderer/utils/ipc', () => ipc)

/** 顶层未处理 rejection 的探针：Node 在微任务清空后的下一轮事件循环里 emit */
const trackUnhandledRejection = () => {
  const reasons: unknown[] = []
  const listener = (reason: unknown) => { reasons.push(reason) }
  process.on('unhandledRejection', listener)
  return {
    reasons,
    stop: () => { process.off('unhandledRejection', listener) },
  }
}

/** 等一轮宏任务：IPC rejection 沿 await 链走到顶层、未处理判定落定 */
const flush = async() => new Promise(resolve => setTimeout(resolve, 0))

/**
 * 每个用例独立加载一份 store/search：`isInitedSearchHistory` 是模块私有状态，
 * 跨用例不复位会互相串（前一个用例拉成功后，后面再也进不了取数分支）。
 */
const loadStore = async() => {
  vi.resetModules()
  const { appSetting } = await import('@renderer/store/setting')
  appSetting['search.isShowHistorySearch'] = true
  appSetting['search.historyMaxNum'] = 15
  const state = await import('./state')
  const action = await import('./action')
  return { state, action }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('store/search/action 的历史词失败收口', () => {
  it('读历史失败 → 不抛（调用点是 void），历史保持空、顶层没有未处理 rejection', async() => {
    const { state, action } = await loadStore()
    ipc.getSearchHistoryList.mockRejectedValue(new Error('IPC 挂了'))
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const unhandled = trackUnhandledRejection()

    // 生产调用点就是 `void getHistoryList()`（BlankView），所以这里也按那个方式调
    void action.getHistoryList()
    await flush()
    unhandled.stop()

    expect(state.historyList).toEqual([])
    expect(unhandled.reasons).toEqual([])
    expect(log).toHaveBeenCalled()
    log.mockRestore()
  })

  it('读失败不算「已初始化」：下次再进来还会重试（失败不能把历史永久锁空）', async() => {
    const { state, action } = await loadStore()
    ipc.getSearchHistoryList.mockRejectedValueOnce(new Error('boom'))
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    await action.getHistoryList()
    expect(state.historyList).toEqual([])

    ipc.getSearchHistoryList.mockResolvedValueOnce(['周杰伦'])
    await action.getHistoryList()

    expect(state.historyList).toEqual(['周杰伦'])
    log.mockRestore()
  })

  it('addHistoryWord：历史读不通也照样记下这个词并落盘（调用点同样不接 rejection）', async() => {
    vi.useFakeTimers()
    try {
      const { state, action } = await loadStore()
      ipc.getSearchHistoryList.mockRejectedValue(new Error('boom'))
      const log = vi.spyOn(console, 'log').mockImplementation(() => {})

      await expect(action.addHistoryWord('周杰伦')).resolves.toBeUndefined()

      expect(state.historyList).toEqual(['周杰伦'])
      // 落盘走 500ms 的 throttle（`saveSearchHistoryListThrottle`），推过去看它真的写了
      await vi.advanceTimersByTimeAsync(500)
      expect(ipc.saveSearchHistoryList).toHaveBeenCalledWith(['周杰伦'])
      log.mockRestore()
    } finally {
      vi.useRealTimers()
    }
  })
})
