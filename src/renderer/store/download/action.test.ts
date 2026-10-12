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
})
