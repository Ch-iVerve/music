import { encodePath } from '@common/utils/common'
import { getLyricSourcePriority } from '@common/settings/lyricSource'
import { appSetting } from '@renderer/store/setting'
import { updateListMusics } from '@renderer/store/list/action'
import { saveLyric, saveMusicUrl } from '@renderer/utils/ipc'
import { getLocalFilePath } from '@renderer/utils/music'
import { hintMissingFileFallback } from '@renderer/core/localLibrary/availability'

import {
  buildLyricInfo,
  getCachedLyricInfo,
  getOnlineOtherSourceLyricByLocal,
  getOnlineOtherSourceLyricInfo,
  getOnlineOtherSourceMusicUrl,
  getOnlineOtherSourceMusicUrlByLocal,
  getOnlineOtherSourcePicByLocal,
  getOnlineOtherSourcePicUrl,
  getOtherSource,
} from './utils'


const getOtherSourceByLocal = async<T>(musicInfo: LX.Music.MusicInfoLocal, handler: (infos: LX.Music.MusicInfoOnline[]) => Promise<T>) => {
  let result: LX.Music.MusicInfoOnline[] = []
  result = await getOtherSource(musicInfo)
  if (result.length) try { return await handler(result) } catch {}
  if (musicInfo.name.includes('-')) {
    const [name, singer] = musicInfo.name.split('-').map(val => val.trim())
    result = await getOtherSource({
      ...musicInfo,
      name,
      singer,
    }, true)
    if (result.length) try { return await handler(result) } catch {}
    result = await getOtherSource({
      ...musicInfo,
      name: singer,
      singer: name,
    }, true)
    if (result.length) try { return await handler(result) } catch {}
  }
  let fileName = musicInfo.meta.filePath.split(/\/|\\/).at(-1)
  if (fileName) {
    fileName = fileName.substring(0, fileName.lastIndexOf('.'))
    if (fileName != musicInfo.name) {
      if (fileName.includes('-')) {
        const [name, singer] = fileName.split('-').map(val => val.trim())
        result = await getOtherSource({
          ...musicInfo,
          name,
          singer,
        }, true)
        if (result.length) try { return await handler(result) } catch {}
        result = await getOtherSource({
          ...musicInfo,
          name: singer,
          singer: name,
        }, true)
      } else {
        result = await getOtherSource({
          ...musicInfo,
          name: fileName,
          singer: '',
        }, true)
      }
      if (result.length) try { return await handler(result) } catch {}
    }
  }

  throw new Error('source not found')
}

export const getMusicUrl = async({ musicInfo, isRefresh, allowToggleSource = true, onToggleSource = () => {} }: {
  musicInfo: LX.Music.MusicInfoLocal
  isRefresh: boolean
  allowToggleSource?: boolean
  onToggleSource?: (musicInfo?: LX.Music.MusicInfoOnline) => void
}): Promise<string> => {
  if (!isRefresh) {
    const path = await getLocalFilePath(musicInfo)
    if (path) return encodePath(path)
    // 文件丢了（票 06）：明确告知「已临时换在线源」，不再静默换源
    hintMissingFileFallback()
  }

  try {
    return await getOnlineOtherSourceMusicUrlByLocal(musicInfo, isRefresh).then(({ url, quality, isFromCache }) => {
      if (!isFromCache) void saveMusicUrl(musicInfo, quality, url)
      return url
    })
  } catch {}

  if (!allowToggleSource) throw new Error('failed')

  onToggleSource()
  return getOtherSourceByLocal(musicInfo, async(otherSource) => {
    return getOnlineOtherSourceMusicUrl({ musicInfos: [...otherSource], onToggleSource, isRefresh }).then(({ url, quality: targetQuality, musicInfo: targetMusicInfo, isFromCache }) => {
      // saveLyric(musicInfo, data.lyricInfo)
      if (!isFromCache) void saveMusicUrl(targetMusicInfo, targetQuality, url)

      // TODO: save url ?
      return url
    })
  })
}

export const getPicUrl = async({ musicInfo, listId, isRefresh, onToggleSource = () => {} }: {
  musicInfo: LX.Music.MusicInfoLocal
  listId?: string | null
  isRefresh: boolean
  onToggleSource?: (musicInfo?: LX.Music.MusicInfoOnline) => void
}): Promise<string> => {
  if (!isRefresh) {
    const pic = await window.lx.worker.main.getMusicFilePic(musicInfo.meta.filePath)
    if (pic) return pic

    if (musicInfo.meta.picUrl) return musicInfo.meta.picUrl
  }

  try {
    return await getOnlineOtherSourcePicByLocal(musicInfo).then(({ url }) => {
      return url
    })
  } catch {}

  onToggleSource()
  return getOtherSourceByLocal(musicInfo, async(otherSource) => {
    return getOnlineOtherSourcePicUrl({ musicInfos: [...otherSource], onToggleSource, isRefresh }).then(({ url, musicInfo: targetMusicInfo, isFromCache }) => {
      if (listId) {
        musicInfo.meta.picUrl = url
        void updateListMusics([{ id: listId, musicInfo }])
      }

      return url
    })
  })
}

export const getLyricInfo = async({ musicInfo, isRefresh, onToggleSource = () => {} }: {
  musicInfo: LX.Music.MusicInfoLocal
  isRefresh: boolean
  onToggleSource?: (musicInfo?: LX.Music.MusicInfoOnline) => void
}): Promise<LX.Player.LyricInfo> => {
  /**
   * 本地一侧：歌词缓存（含在软件里编辑过的）+ 同目录的 `.lrc` 文件，都没有则返回 `null`。
   * `isRefresh` 时直接跳过——「重新取一份」的语义不该被本地缓存挡住（与改造前 `if (!isRefresh)` 等价）。
   */
  const getLyricInfoByLocal = async(): Promise<LX.Player.LyricInfo | null> => {
    if (isRefresh) return null
    const [lyricInfo, fileLyricInfo] = await Promise.all([getCachedLyricInfo(musicInfo), window.lx.worker.main.getMusicFileLyric(musicInfo.meta.filePath)])
    // console.log(lyricInfo, fileLyricInfo)
    if (lyricInfo?.lyric && lyricInfo.lyric != fileLyricInfo?.lyric) {
      // 存在已编辑歌词
      return buildLyricInfo({ ...lyricInfo, rawlrcInfo: fileLyricInfo ?? lyricInfo.rawlrcInfo })
    }

    if (fileLyricInfo) return buildLyricInfo(fileLyricInfo)
    if (lyricInfo?.lyric) return buildLyricInfo(lyricInfo)
    return null
  }

  /** 在线一侧：先命中歌词缓存，没有再请求在线歌词（失败抛错，由调用方回落到另一侧）。 */
  const getLyricInfoByOnline = async(): Promise<LX.Player.LyricInfo> => {
    const { lyricInfo, isFromCache } = await getOnlineOtherSourceLyricByLocal(musicInfo, isRefresh)
    if (!isFromCache) void saveLyric(musicInfo, lyricInfo)
    return buildLyricInfo(lyricInfo)
  }

  /**
   * 先走哪一侧由 `lyric.sourcePriority` 决定，默认 `localFirst` = 改造前的行为。
   * 🔴 一侧没结果 / 抛错**都要**回落到另一侧：选了「在线优先」不等于「永远不用本地歌词」，
   * 断网或未登录时同目录的 `.lrc` 仍要能出词（工单 09 的验收里点了这条）。
   */
  if (getLyricSourcePriority(appSetting) == 'onlineFirst') {
    try {
      return await getLyricInfoByOnline()
    } catch {}
    const localLyricInfo = await getLyricInfoByLocal()
    if (localLyricInfo) return localLyricInfo
  } else {
    const localLyricInfo = await getLyricInfoByLocal()
    if (localLyricInfo) return localLyricInfo
    try {
      return await getLyricInfoByOnline()
    } catch {}
  }

  onToggleSource()
  return getOtherSourceByLocal(musicInfo, async(otherSource) => {
    return getOnlineOtherSourceLyricInfo({ musicInfos: [...otherSource], onToggleSource, isRefresh }).then(async({ lyricInfo, musicInfo: targetMusicInfo, isFromCache }) => {
      void saveLyric(musicInfo, lyricInfo)

      if (isFromCache) return buildLyricInfo(lyricInfo)
      void saveLyric(targetMusicInfo, lyricInfo)

      return buildLyricInfo(lyricInfo)
    })
  })
}
