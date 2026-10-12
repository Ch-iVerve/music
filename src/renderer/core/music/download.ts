import { getDownloadFilePath } from '@renderer/utils/music'

import {
  getMusicUrl as getOnlineMusicUrl,
  getPicUrl as getOnlinePicUrl,
  getLyricInfo as getOnlineLyricInfo,
} from './online'
import { buildLyricInfo, getCachedLyricInfo } from './utils'

export const getMusicUrl = async({ musicInfo, isRefresh }: {
  musicInfo: LX.Download.ListItem
  isRefresh: boolean
}): Promise<string> => {
  if (!isRefresh) {
    const path = await getDownloadFilePath(musicInfo)
    if (path) return path
  }

  return getOnlineMusicUrl({ musicInfo: musicInfo.metadata.musicInfo, isRefresh })
}

export const getPicUrl = async({ musicInfo, isRefresh, listId }: {
  musicInfo: LX.Download.ListItem
  isRefresh: boolean
  listId?: string | null
}): Promise<string> => {
  if (!isRefresh) {
    const path = await getDownloadFilePath(musicInfo)
    if (path) {
      const pic = await window.lx.worker.main.getMusicFilePic(path)
      if (pic) return pic
    }

    const onlineMusicInfo = musicInfo.metadata.musicInfo
    if (onlineMusicInfo.meta.picUrl) return onlineMusicInfo.meta.picUrl
  }

  return getOnlinePicUrl({ musicInfo: musicInfo.metadata.musicInfo, isRefresh }).then((url) => {
    // TODO: when listId required save url (update downloadInfo)

    return url
  })
}

export const getLyricInfo = async({ musicInfo, isRefresh }: {
  musicInfo: LX.Download.ListItem
  isRefresh: boolean
}): Promise<LX.Player.LyricInfo> => {
  if (!isRefresh) {
    const lyricInfo = await getCachedLyricInfo(musicInfo.metadata.musicInfo)
    if (lyricInfo) return buildLyricInfo(lyricInfo)
  }

  return getOnlineLyricInfo({
    musicInfo: musicInfo.metadata.musicInfo,
    isRefresh,
  }).catch(async() => {
    // 尝试读取文件内歌词
    const path = await getDownloadFilePath(musicInfo)
    if (path) {
      const rawlrcInfo = await window.lx.worker.main.getMusicFileLyric(path)
      if (rawlrcInfo) return buildLyricInfo(rawlrcInfo)
    }

    throw new Error('failed')
  })
}
