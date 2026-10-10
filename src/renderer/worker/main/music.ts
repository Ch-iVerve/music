import { getLocalMusicFileLyric, getLocalMusicFilePic } from '@renderer/utils/music'

/**
 * 封面中转的**临时文件机制已废弃**（本地媒体库票 03，spec D2 零旁车）：
 * 过去内嵌封面 >400KB 会写 `/tmp/chiverve-music_temp/` 再以文件路径喂给 `<img>`——
 * 该目录从不清理是既有债，且零旁车模型下不再有任何旁车文件。现在大封面走 data URL
 * （内存换磁盘）；媒体库视图的封面另有 `getMusicCoverData`（字节 + ObjectURL，可撤销）。
 * 存量临时目录由主进程启动时一次性清理（`main/utils/legacyTempCleanup`）。
 */
export const getMusicFilePic = async(filePath: string) => {
  const picture = await getLocalMusicFilePic(filePath)
  if (!picture) return ''
  if (typeof picture == 'string') return picture
  return `data:${picture.format};base64,${Buffer.from(picture.data).toString('base64')}`
}

/** 读内嵌封面**原始字节**（媒体库视图用：主线程转 ObjectURL，可统一 revoke，不走 data URL 的体积放大） */
export const getMusicCoverData = async(filePath: string): Promise<{ format: string, data: Uint8Array } | null> => {
  const picture = await getLocalMusicFilePic(filePath)
  if (!picture || typeof picture == 'string') return null
  return { format: picture.format, data: picture.data }
}

export const parseLyric = (lrc: string): LX.Music.LyricInfo => {
  const verifyAwlrc = (lrc: string) => {
    return /(?:^|\s*)\[\d+:\d+(?:\.\d+)]<\d+,\d+>.+$/m.test(lrc)
  }
  const verifylrc = (lrc: string) => {
    return /(?:^|\s*)\[\d+:\d+(?:\.\d+)].+$/m.test(lrc)
  }
  const lrcTags = {
    awlrc: {
      name: 'lxlyric',
      verify: verifyAwlrc,
    },
    lrc: {
      name: 'lyric',
      verify: verifylrc,
    },
    tlrc: {
      name: 'tlyric',
      verify: verifylrc,
    },
    rlrc: {
      name: 'rlyric',
      verify: verifylrc,
    },
  } as const
  const tagRxp = /(?:^|\n\s*)\[awlrc:([^\]]+)]/i
  const lrcRxp = /^(lrc|awlrc|tlrc|rlrc):([^,]+)$/i
  const parse = (content: string) => {
    const lyricInfo: Partial<LX.Music.LyricInfo> = {}
    const lrcs = content.trim().split(',')
    for (const lrc of lrcs) {
      const result = lrcRxp.exec(lrc.trim())
      if (!result) continue
      const target = lrcTags[result[1].toLowerCase() as 'tlrc' | 'rlrc' | 'lrc' | 'awlrc']
      if (!target) continue
      const data = Buffer.from(result[2], 'base64').toString('utf-8').trim()
      if (target.verify(data)) lyricInfo[target.name] = data
    }
    return lyricInfo
  }
  let parsedInfo: Partial<LX.Music.LyricInfo> = {}
  let lyric = lrc.replace(tagRxp, (_: string, p1: string) => {
    parsedInfo = parse(p1)
    return ''
  }).trim()
  return { lyric, ...parsedInfo }
}


export const getMusicFileLyric = async(filePath: string): Promise<LX.Music.LyricInfo | null> => {
  const lyric = await getLocalMusicFileLyric(filePath)
  if (!lyric) return null
  return parseLyric(lyric.lyric)
}
