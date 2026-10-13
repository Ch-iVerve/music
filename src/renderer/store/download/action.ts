import {
  downloadTasksGet,
  // downloadListClear,
  downloadTasksCreate,
  downloadTasksRemove,
  downloadTasksUpdate,
  getEnvParams,
} from '@renderer/utils/ipc'
import {
  downloadList,
} from './state'
import { markRaw, toRaw } from '@common/utils/vueTools'
import { getMusicUrl, getPicUrl } from '@renderer/core/music/online'
import { appSetting } from '../setting'
import { qualityList } from '..'
import { proxyCallback } from '@renderer/worker/utils'
import { arrPush, arrUnshift, joinPath } from '@renderer/utils'
import { DOWNLOAD_STATUS } from '@common/constants'
import { proxy } from '../index'
import { ingestDownloadedFile } from '@renderer/core/localLibrary'
import { dialog } from '@renderer/plugins/Dialog'

const waitingUpdateTasks = new Map<string, LX.Download.ListItem>()
let timer: NodeJS.Timeout | null = null
const throttleUpdateTask = (tasks: LX.Download.ListItem[]) => {
  for (const task of tasks) waitingUpdateTasks.set(task.id, toRaw(task))
  if (timer) return
  timer = setTimeout(() => {
    timer = null
    void downloadTasksUpdate(Array.from(waitingUpdateTasks.values()))
    waitingUpdateTasks.clear()
  }, 100)
}

/**
 * 撤掉某个任务的**待写**（`throttleUpdateTask` 那 100ms 批写里的这一条）。
 *
 * 用在「已完成任务随即被移除」的收尾上：`setStatus(COMPLETED)` 会排一次节流写，而它可能
 * 晚于 `removeTask` 的删行落地——那样「已完成」行会被写回 `download_list`，库里积下永远不会
 * 再出现的幽灵任务（2026-10-13 真机：一次下载后库里多了一行 `isComplate=1`）。
 * 撤掉之后若节流已经先写过，`removeTask` 的删行仍在它后面——两种顺序都以「行已删」收尾。
 */
const cancelPendingTaskUpdate = (id: string) => {
  waitingUpdateTasks.delete(id)
}

const runingTask = new Map<string, LX.Download.ListItem>()

// const initDownloadList = (list: LX.Download.ListItem[]) => {
//   downloadList.splice(0, downloadList.length, ...list)
// }

export const getDownloadList = async(): Promise<LX.Download.ListItem[]> => {
  if (!downloadList.length) {
    const list = await downloadTasksGet()
    for (const downloadInfo of list) {
      markRaw(downloadInfo.metadata)
      switch (downloadInfo.status) {
        case DOWNLOAD_STATUS.RUN:
        case DOWNLOAD_STATUS.WAITING:
          downloadInfo.status = DOWNLOAD_STATUS.PAUSE
          downloadInfo.statusText = window.i18n.t('download___status_paused')
        default:
          break
      }
    }
    arrPush(downloadList, list)
  }
  return downloadList
}

const addTasks = async(list: LX.Download.ListItem[]) => {
  const addMusicLocationType = appSetting['list.addMusicLocationType']

  await downloadTasksCreate(list.map(i => toRaw(i)), addMusicLocationType)

  if (addMusicLocationType === 'top') {
    arrUnshift(downloadList, list)
  } else {
    arrPush(downloadList, list)
  }
  window.app_event.downloadListUpdate()
}

const setStatusText = (downloadInfo: LX.Download.ListItem, text: string) => { // 设置状态文本
  downloadInfo.statusText = text
  throttleUpdateTask([downloadInfo])
}

const setUrl = (downloadInfo: LX.Download.ListItem, url: string) => {
  downloadInfo.metadata.url = url
  throttleUpdateTask([downloadInfo])
}

const updateFilePath = (downloadInfo: LX.Download.ListItem, filePath: string) => {
  downloadInfo.metadata.filePath = filePath
  throttleUpdateTask([downloadInfo])
}

const setProgress = (downloadInfo: LX.Download.ListItem, progress: LX.Download.ProgressInfo) => {
  downloadInfo.total = progress.total
  downloadInfo.downloaded = progress.downloaded
  downloadInfo.writeQueue = progress.writeQueue
  if (progress.progress == 100) {
    downloadInfo.speed = ''
    downloadInfo.progress = 99.99
    setStatusText(downloadInfo, window.i18n.t('download_status_write_queue', { num: progress.writeQueue }))
  } else {
    downloadInfo.speed = progress.speed
    downloadInfo.progress = progress.progress
  }
  throttleUpdateTask([downloadInfo])
}

const setStatus = (downloadInfo: LX.Download.ListItem, status: LX.Download.DownloadTaskStatus, statusText?: string) => { // 设置状态及状态文本
  if (statusText == null) {
    switch (status) {
      case DOWNLOAD_STATUS.RUN:
        statusText = window.i18n.t('download___status_running')
        break
      case DOWNLOAD_STATUS.WAITING:
        statusText = window.i18n.t('download___status_waiting')
        break
      case DOWNLOAD_STATUS.PAUSE:
        statusText = window.i18n.t('download___status_paused')
        break
      case DOWNLOAD_STATUS.ERROR:
        statusText = window.i18n.t('download___status_error')
        break
      case DOWNLOAD_STATUS.COMPLETED:
        statusText = window.i18n.t('download___status_completed')
        break
      default:
        statusText = ''
        break
    }
  }

  if (downloadInfo.statusText == statusText && downloadInfo.status == status) return

  if (status == DOWNLOAD_STATUS.COMPLETED) downloadInfo.isComplate = true
  downloadInfo.statusText = statusText
  downloadInfo.status = status
  throttleUpdateTask([downloadInfo])
}

const getProxy = () => {
  return proxy.enable && proxy.host ? {
    host: proxy.host,
    port: parseInt(proxy.port || '80'),
  } : proxy.envProxy ? {
    host: proxy.envProxy.host,
    port: parseInt(proxy.envProxy.port || '80'),
  } : undefined
}
/**
 * 把 QQ 元数据（歌名/歌手/专辑/封面）写进下载文件的内嵌 tag——收编入库时解析读的就是它
 * （让库行拿到的是 QQ 元数据而不是文件原始 tag；封面尤其重要，库视图封面靠它）。
 *
 * 集合概念统一后固定「写文本 meta + 封面、不写歌词、不产生旁车」：原来那组
 * `download.isEmbed*` / `isDownloadLrc` 设置已随本批下架（库的歌词走库内编辑，不靠下载旁车）。
 * `ape` 不支持写 tag，直接跳过（沿用改造前的分支）。
 * @param downloadInfo 下载任务信息
 */
const saveMeta = async(downloadInfo: LX.Download.ListItem): Promise<void> => {
  if (downloadInfo.metadata.quality === 'ape') return
  const imageUrl = downloadInfo.metadata.musicInfo.meta.picUrl ??
    await getPicUrl({ musicInfo: downloadInfo.metadata.musicInfo, isRefresh: false }).catch(err => {
      console.log(err)
      return null
    })
  const info = {
    filePath: downloadInfo.metadata.filePath,
    isEmbedLyricLx: false,
    isEmbedLyricT: false,
    isEmbedLyricR: false,
    title: downloadInfo.metadata.musicInfo.name,
    artist: downloadInfo.metadata.musicInfo.singer?.replaceAll('、', ';'),
    album: downloadInfo.metadata.musicInfo.meta.albumName,
    APIC: imageUrl,
  }
  await window.lx.worker.download.writeMeta(info, { lyric: '' }, getProxy()).catch(err => {
    console.log('[download] 写入内嵌 meta 失败（不影响入库）:', err)
  })
}

const getUrl = async(downloadInfo: LX.Download.ListItem, isRefresh: boolean = false) => {
  let toggleMusicInfo = downloadInfo.metadata.musicInfo.meta.toggleMusicInfo
  return (toggleMusicInfo ? getMusicUrl({
    musicInfo: toggleMusicInfo,
    isRefresh,
    quality: downloadInfo.metadata.quality,
  }) : Promise.reject(new Error('not found'))).catch(() => {
    return getMusicUrl({
      musicInfo: downloadInfo.metadata.musicInfo,
      isRefresh: false,
      quality: downloadInfo.metadata.quality,
    })
  }).catch(() => '')
}
const handleRefreshUrl = (downloadInfo: LX.Download.ListItem) => {
  setStatusText(downloadInfo, window.i18n.t('download_status_error_refresh_url'))
  let toggleMusicInfo = downloadInfo.metadata.musicInfo.meta.toggleMusicInfo
  ;(toggleMusicInfo ? getMusicUrl({
    musicInfo: toggleMusicInfo,
    isRefresh: true,
    quality: downloadInfo.metadata.quality,
  }) : Promise.reject(new Error('not found'))).catch(() => {
    return getMusicUrl({
      musicInfo: downloadInfo.metadata.musicInfo,
      isRefresh: true,
      quality: downloadInfo.metadata.quality,
    })
  })
    .catch(() => '')
    .then(url => {
    // commit('setStatusText', { downloadInfo, text: '链接刷新成功' })
      setUrl(downloadInfo, url)
      void window.lx.worker.download.updateUrl(downloadInfo.id, url)
    })
    .catch(err => {
      console.log(err)
      handleError(downloadInfo, err.message)
    })
}
const handleError = (downloadInfo: LX.Download.ListItem, message?: string) => {
  setStatus(downloadInfo, DOWNLOAD_STATUS.ERROR, message)
  void window.lx.worker.download.removeTask(downloadInfo.id)
  runingTask.delete(downloadInfo.id)
  void checkStartTask()
}

const handleStartTask = async(downloadInfo: LX.Download.ListItem) => {
  if (!downloadInfo.metadata.url) {
    setStatusText(downloadInfo, window.i18n.t('download_status_url_getting'))
    const url = await getUrl(downloadInfo)
    if (!url) {
      handleError(downloadInfo, window.i18n.t('download_status_error_url_failed'))
      return
    }
    setUrl(downloadInfo, url)
    if (downloadInfo.status != DOWNLOAD_STATUS.RUN) return
  }

  // 落盘到媒体目录下的 `.tmp` 暂存区（集合概念统一 D1）：完成后由 ingestDownloadedFile 收编进库并删原件；
  // 收编失败的残留会在重扫描里以「孤儿」出现（可收编/可清理），不会污染正常库视图
  const savePath = joinPath((await getEnvParams()).mediaDir, '.tmp')
  const filePath = joinPath(savePath, downloadInfo.metadata.fileName)
  if (downloadInfo.metadata.filePath != filePath) updateFilePath(downloadInfo, filePath)

  setStatusText(downloadInfo, window.i18n.t('download_status_start'))

  await window.lx.worker.download.startTask(toRaw(downloadInfo), savePath, true, proxyCallback((event: LX.Download.DownloadTaskActions) => {
    // console.log(event)
    switch (event.action) {
      case 'start':
        setStatus(downloadInfo, DOWNLOAD_STATUS.RUN)
        break
      case 'complete':
        downloadInfo.progress = 100
        // 下载完成 = 托管入库（集合概念统一 D1）：先**等内嵌 meta 写完**（收编解析读的就是它；
        // 2026-10-13 真机教训：`writeMeta` 不透出 Promise 时这里 await 等于空等，收编会与
        // flac/mp3 的标签改写对同一文件赛跑，下载的歌进不了库、还留下 `.lxmtemp` 孤儿），
        // 再走库管线（复制进媒体目录、库行 origin='download'、成功/命中已有哈希后删暂存原件）。
        // 写 meta / 入库失败都只记日志、不把任务改回失败态——文件还在 `.tmp`。
        void (async() => {
          await saveMeta(downloadInfo).catch(err => {
            console.log('[download] 写入内嵌 meta 失败（不影响入库）:', err)
          })
          await ingestDownloadedFile(downloadInfo.metadata.filePath).catch(err => {
            console.log('[download] 完成后入库失败（文件保留在暂存目录）:', err)
          })
          setStatus(downloadInfo, DOWNLOAD_STATUS.COMPLETED)
          runingTask.delete(downloadInfo.id)
          // 先撤掉这条「已完成」的节流待写、再删行：否则它会把行写回库（幽灵行，见 cancelPendingTaskUpdate）
          cancelPendingTaskUpdate(downloadInfo.id)
          await window.lx.worker.download.removeTask(downloadInfo.id).catch(err => {
            console.log('[download] 移除已完成任务失败（库里会留一条已完成行，下次启动不再显示）:', err)
          })
          void checkStartTask()
        })()
        break
      case 'refreshUrl':
        handleRefreshUrl(downloadInfo)
        break
      case 'statusText':
        setStatusText(downloadInfo, event.data)
        break
      case 'progress':
        setProgress(downloadInfo, event.data)
        break
      case 'error':
        handleError(downloadInfo, event.data.error
          ? window.i18n.t(event.data.error) + (event.data.message ?? '')
          : event.data.message,
        )
        break
      default:
        break
    }
  }), getProxy())
}
const startTask = async(downloadInfo: LX.Download.ListItem) => {
  setStatus(downloadInfo, DOWNLOAD_STATUS.RUN)
  runingTask.set(downloadInfo.id, downloadInfo)
  void handleStartTask(downloadInfo)
}

const getStartTask = (list: LX.Download.ListItem[]): LX.Download.ListItem | null => {
  let downloadCount = 0
  const waitList = list.filter(item => {
    if (item.status == DOWNLOAD_STATUS.WAITING) return true
    if (item.status == DOWNLOAD_STATUS.RUN) ++downloadCount
    return false
  })
  // console.log(downloadCount, waitList)
  return downloadCount < appSetting['download.maxDownloadNum'] ? waitList.shift() ?? null : null
}

const checkStartTask = async() => {
  if (runingTask.size >= appSetting['download.maxDownloadNum']) return
  let result = getStartTask(downloadList)
  // console.log(result)
  while (result) {
    await startTask(result)
    result = getStartTask(downloadList)
  }
}

/**
 * 过滤重复任务
 * @param list
 */
const filterTask = (list: LX.Download.ListItem[]) => {
  const set = new Set<string>()
  for (const item of downloadList) set.add(item.id)
  return list.filter(item => {
    if (set.has(item.id)) return false
    markRaw(item.metadata)
    set.add(item.id)
    return true
  })
}
/**
 * 创建下载任务
 * @param list 要下载的歌曲
 * @param quality 下载音质
 */
export const createDownloadTasks = async(list: LX.Music.MusicInfoOnline[], quality: LX.Quality, listId?: string) => {
  if (!list.length) return
  // 档位守卫与任务文件名都在 worker 里算（`download.degradeWhenUnsupported` 由这里读出来传进去：
  // worker 是独立 realm，拿不到主窗的 appSetting）
  const { tasks: newTasks, unsupported } = await window.lx.worker.download.createDownloadTasks(list, quality,
    toRaw(qualityList.value),
    appSetting['download.degradeWhenUnsupported'],
    listId,
  )
  // 关掉自动降档时，档位不可用的歌既不降档也不建任务 —— 必须明确告诉用户被跳过了几首，不能静默丢掉
  if (unsupported) void dialog({ message: window.i18n.t('download__quality_unavailable_tip', { num: unsupported }) })
  const tasks = filterTask(newTasks)

  if (tasks.length) await addTasks(tasks)
  void checkStartTask()
}

/**
 * 开始下载任务
 * @param list
 */
export const startDownloadTasks = async(list: LX.Download.ListItem[]) => {
  for (const downloadInfo of list) {
    switch (downloadInfo.status) {
      case DOWNLOAD_STATUS.PAUSE:
      case DOWNLOAD_STATUS.ERROR:
        if (runingTask.size < appSetting['download.maxDownloadNum']) void startTask(downloadInfo)
        else setStatus(downloadInfo, DOWNLOAD_STATUS.WAITING)
      default:
        break
    }
  }
  void checkStartTask()
}

/**
 * 暂停下载任务
 * @param list
 */
export const pauseDownloadTasks = async(list: LX.Download.ListItem[]) => {
  for (const downloadInfo of list) {
    switch (downloadInfo.status) {
      case DOWNLOAD_STATUS.RUN:
        void window.lx.worker.download.pauseTask(downloadInfo.id)
        runingTask.delete(downloadInfo.id)
      case DOWNLOAD_STATUS.WAITING:
      case DOWNLOAD_STATUS.ERROR:
        setStatus(downloadInfo, DOWNLOAD_STATUS.PAUSE)
      default:
        break
    }
  }
  void checkStartTask()
}

/**
 * 移除下载任务
 * @param ids 要移除的任务Id
 */
export const removeDownloadTasks = async(ids: string[]) => {
  await downloadTasksRemove(ids)

  const idsSet = new Set<string>(ids)
  const newList = downloadList.filter(task => {
    if (runingTask.has(task.id)) {
      void window.lx.worker.download.removeTask(task.id)
      runingTask.delete(task.id)
    }
    return !idsSet.has(task.id)
  })
  downloadList.splice(0, downloadList.length)
  arrPush(downloadList, newList)


  void checkStartTask()
  window.app_event.downloadListUpdate()
}
