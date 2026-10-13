import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DOWNLOAD_STATUS } from '@common/constants'
import { startDownloadTasks } from './action'

/**
 * 下载完成的「收编入库」编排（集合概念统一 D1）。
 *
 * `complete` 事件后：先写内嵌 meta（收编解析读的就是它）→ `ingestDownloadedFile` 把文件收进
 * 媒体目录（库行 `origin='download'`、删暂存原件）→ 任务移除并置 COMPLETED。入库失败**不**把
 * 任务改回失败态（文件留在暂存目录，可手动导入），也不能让 rejection 漏到顶层——dev 下
 * webpack-dev-server 会据此弹全屏浮层吞鼠标（票 03b 的教训）。
 *
 * 这里跑真实流程（`startDownloadTasks` → worker 回调 `complete` → 收编编排），只桩掉
 * IPC、取流 / 取封面、worker 与收编函数。
 */

const {
  getMusicUrl,
  getPicUrl,
  downloadTasksUpdate,
  ingestDownloadedFile,
  worker,
} = vi.hoisted(() => ({
  getMusicUrl: vi.fn(),
  getPicUrl: vi.fn(),
  downloadTasksUpdate: vi.fn(),
  ingestDownloadedFile: vi.fn(),
  worker: {
    startTask: vi.fn(),
    writeMeta: vi.fn(),
    removeTask: vi.fn(),
    updateUrl: vi.fn(),
  },
}))

vi.mock('@renderer/utils/ipc', () => ({
  downloadTasksGet: vi.fn(),
  downloadTasksCreate: vi.fn(),
  downloadTasksRemove: vi.fn(),
  downloadTasksUpdate,
  getEnvParams: vi.fn(async() => ({ mediaDir: '/media' })),
}))
vi.mock('@renderer/core/music/online', () => ({ getMusicUrl, getPicUrl }))
vi.mock('@renderer/core/localLibrary', () => ({ ingestDownloadedFile }))
vi.mock('@renderer/worker/utils', () => ({ proxyCallback: (callback: any) => callback }))
vi.mock('@renderer/plugins/Dialog', () => ({ dialog: vi.fn() }))

const trackUnhandledRejection = () => {
  const reasons: unknown[] = []
  const listener = (reason: unknown) => { reasons.push(reason) }
  process.on('unhandledRejection', listener)
  return {
    reasons,
    stop: () => { process.off('unhandledRejection', listener) },
  }
}

/** 多轮宏任务：complete 回调里 saveMeta / 收编两条链都是异步的（每步一次 await） */
const settle = async(rounds = 8) => {
  for (let i = 0; i < rounds; i++) await new Promise(resolve => setTimeout(resolve, 0))
}

const createTask = () => ({
  id: 'download_1',
  status: DOWNLOAD_STATUS.PAUSE,
  statusText: '',
  progress: 0,
  total: 0,
  downloaded: 0,
  speed: '',
  writeQueue: 0,
  metadata: {
    musicInfo: {
      id: 'tx__song1',
      source: 'tx',
      name: '歌',
      singer: '手',
      meta: { picUrl: 'http://pic' },
    },
    quality: '320k',
    filePath: '/media/.tmp/song1_320k.mp3',
    fileName: 'song1_320k.mp3',
    url: '',
    listId: 'default',
  },
}) as unknown as LX.Download.ListItem

describe('store/download 完成后的收编编排', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(window.lx as any).worker = { download: worker }
    worker.startTask.mockImplementation(async(_task: any, _savePath: any, _skip: any, callback: any) => {
      // worker 的 complete 事件：任务文件已写完，接着写内嵌 meta 并收编入库
      callback({ action: 'complete' })
    })
    worker.writeMeta.mockResolvedValue(undefined)
    worker.removeTask.mockResolvedValue(undefined)
    getMusicUrl.mockResolvedValue('http://audio/320.mp3')
    getPicUrl.mockResolvedValue('http://pic')
    ingestDownloadedFile.mockResolvedValue(true)
  })

  it('完成 → 写内嵌 meta（含封面）→ 收编入库 → 任务移除并置 COMPLETED', async() => {
    const unhandled = trackUnhandledRejection()
    const task = createTask()

    await startDownloadTasks([task])
    await settle()
    unhandled.stop()

    expect(task.status).toBe(DOWNLOAD_STATUS.COMPLETED)
    expect(worker.writeMeta).toHaveBeenCalledTimes(1)
    const [info] = worker.writeMeta.mock.calls[0]
    expect(info.APIC).toBe('http://pic')
    expect(ingestDownloadedFile).toHaveBeenCalledWith('/media/.tmp/song1_320k.mp3')
    expect(worker.removeTask).toHaveBeenCalledWith('download_1')
    expect(unhandled.reasons).toEqual([])
  })

  it('收编失败 → 任务仍为 COMPLETED、无未处理 rejection（文件留在暂存目录可手动导入）', async() => {
    ingestDownloadedFile.mockRejectedValue(new Error('收编失败'))
    const unhandled = trackUnhandledRejection()
    const task = createTask()

    await startDownloadTasks([task])
    await settle()
    unhandled.stop()

    expect(task.status).toBe(DOWNLOAD_STATUS.COMPLETED)
    expect(worker.removeTask).toHaveBeenCalledWith('download_1')
    expect(unhandled.reasons).toEqual([])
  })

  /**
   * 写标签必须**真等写完**再收编（2026-10-13 真机教训）。
   *
   * `writeMeta` 原本是 fire-and-forget：这里 await 立刻过，收编随即对**同一个文件**开跑，
   * 而 flac 的标签改写正在 unlink 原文件 + rename 临时文件——收编读到半路消失的文件而失败
   * （下载的歌进不了库），临时件还留成 `.lxmtemp` 孤儿。判据：writeMeta 的 promise 未落地前，
   * `ingestDownloadedFile` 一次都不能被调。
   */
  it('writeMeta 未落地前不收编（写标签与收编不许赛跑）', async() => {
    let resolveMeta!: () => void
    worker.writeMeta.mockReturnValue(new Promise<void>(resolve => { resolveMeta = resolve }))
    const task = createTask()

    await startDownloadTasks([task])
    await settle(4)

    expect(worker.writeMeta).toHaveBeenCalledTimes(1)
    expect(ingestDownloadedFile).not.toHaveBeenCalled()
    expect(worker.removeTask).not.toHaveBeenCalled()

    resolveMeta()
    await settle()

    expect(ingestDownloadedFile).toHaveBeenCalledWith('/media/.tmp/song1_320k.mp3')
    expect(worker.removeTask).toHaveBeenCalledWith('download_1')
  })

  /**
   * 已完成任务**不留在库里**（2026-10-13 真机：一次下载后 `download_list` 多出一行 `isComplate=1`）。
   *
   * `setStatus(COMPLETED)` 会排一次 100ms 的节流写，而它可能晚于 `removeTask` 的删行落地，
   * 把「已完成」行又写回库。修复是删行前先撤掉这条待写。判据：整条完成链走完（含跨过 100ms），
   * 一次 `downloadTasksUpdate` 都不该发生。
   */
  it('完成链不再把「已完成」行写回 download_list（无幽灵行）', async() => {
    vi.useFakeTimers()
    try {
      const task = createTask()

      await startDownloadTasks([task])
      await vi.advanceTimersByTimeAsync(300)

      expect(task.status).toBe(DOWNLOAD_STATUS.COMPLETED)
      expect(worker.removeTask).toHaveBeenCalledWith('download_1')
      expect(downloadTasksUpdate).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
