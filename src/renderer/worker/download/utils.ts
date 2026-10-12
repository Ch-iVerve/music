import { DOWNLOAD_STATUS, QUALITYS } from '@common/constants'

export const getExt = (type: string): LX.Download.FileExt => {
  switch (type) {
    case 'ape':
      return 'ape'
    case 'flac':
    case 'flac24bit':
      return 'flac'
    case 'wav':
      return 'wav'
    case '128k':
    case '192k':
    case '320k':
    default:
      return 'mp3'
  }
}

/**
 * 获取音乐音质
 * @param musicInfo
 * @param type 请求的档位
 * @param qualityList 当前音源支持的档位表（`qualityList[source]` 的数组顺序有语义，见 api-source-info.ts）
 * @param degradeWhenUnsupported 请求档位不可用时是否按现有逻辑静默降档（`download.degradeWhenUnsupported`，
 *   默认 true = 改造前行为）；为 false 时返回 null —— 「当前档位不可用」，由调用方决定不建任务并提示
 * @returns 实际要用的档位；不可用且不允许降档时返回 null
 */
export const getMusicType = (musicInfo: LX.Music.MusicInfoOnline, type: LX.Quality, qualityList: LX.QualityList, degradeWhenUnsupported = true): LX.Quality | null => {
  const list = qualityList[musicInfo.source]
  if (!list) return degradeWhenUnsupported ? '128k' : null
  if (!list.includes(type)) {
    // 不允许降档时，「请求的档位不在音源支持列表里」本身就是不可用，不拿列表末位兜底
    if (!degradeWhenUnsupported) return null
    type = list[list.length - 1]
  }
  // 允许降档：从请求档位沿 QUALITYS 向下找第一个真有的档；不允许降档：只看请求档位本身
  const rangeType = degradeWhenUnsupported ? QUALITYS.slice(QUALITYS.indexOf(type)) : [type]
  for (const type of rangeType) {
    if (musicInfo.meta._qualitys[type]) return type
  }
  return degradeWhenUnsupported ? '128k' : null
}

// const checkExistList = (list: LX.Download.ListItem[], musicInfo: LX.Music.MusicInfo, type: LX.Quality, ext: string): boolean => {
//   return list.some(s => s.id === musicInfo.id && (s.metadata.type === type || s.metadata.ext === ext))
// }

/**
 * 创建下载任务信息
 * @param degradeWhenUnsupported 请求档位不可用时是否静默降档（`download.degradeWhenUnsupported`）
 * @returns 请求档位不可用且不允许降档时返回 null（不建任务，由调用方提示；见 `createDownloadTasks`）
 */
export const createDownloadInfo = (musicInfo: LX.Music.MusicInfoOnline, type: LX.Quality, qualityList: LX.QualityList, degradeWhenUnsupported = true, listId?: string): LX.Download.ListItem | null => {
  const quality = getMusicType(musicInfo, type, qualityList, degradeWhenUnsupported)
  if (!quality) return null
  const ext = getExt(quality)
  const key = `${musicInfo.id}_${quality}_${ext}`
  // if (checkExistList(list, musicInfo, type, ext)) return null
  const downloadInfo: LX.Download.ListItem = {
    id: key,
    isComplate: false,
    status: DOWNLOAD_STATUS.WAITING,
    statusText: '待下载',
    downloaded: 0,
    total: 0,
    progress: 0,
    speed: '',
    writeQueue: 0,
    metadata: {
      musicInfo,
      url: null,
      // 实际档位（不是请求档位）：URL 缓存与任务 id 都按它算，见 AGENTS §2.6 硬约束 2
      quality,
      ext,
      filePath: '',
      listId,
      // 暂存文件名 = 歌曲 id + 实际档位（唯一、无非法字符；收编与续传的判据都稳定）
      fileName: `${musicInfo.id}_${quality}.${ext}`,
    },
  }
  // downloadInfo.metadata.filePath = joinPath(savePath, downloadInfo.metadata.fileName)
  // commit('addTask', downloadInfo)

  // 删除同路径下的同名文件
  // TODO
  // void removeFile(downloadInfo.metadata.filePath)
  // .catch(err => {
  //   if (err.code !== 'ENOENT') {
  //     return commit('setStatusText', { downloadInfo, text: '文件删除失败' })
  //   }
  // })

  return downloadInfo
}
