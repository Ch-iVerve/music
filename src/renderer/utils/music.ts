import { checkPath, extname, readFile, getFileStats } from '@common/utils/nodejs'
import { decodeKrc } from '@common/utils/lyricUtils/kg'
import { type IAudioMetadata } from 'music-metadata'

export const checkLocalFileAvailable = async(musicInfo: LX.Music.MusicInfoLocal): Promise<boolean> => {
  return checkPath(musicInfo.meta.filePath)
}

/**
 * 下载条目的文件路径。集合概念统一后下载文件只存在于「暂存目录」（完成即收编入库、原件删除），
 * 不再有「文件名改动 / 挪窝」的回退查找场景——savePath 兜底（旧 `download.savePath` 设置）随该批下架。
 */
export const getDownloadFilePath = async(musicInfo: LX.Download.ListItem): Promise<string> => {
  if (musicInfo.isComplate && !/\.ape$/.test(musicInfo.metadata.fileName) && await checkPath(musicInfo.metadata.filePath)) {
    return musicInfo.metadata.filePath
  }
  return ''
}

export const getLocalFilePath = async(musicInfo: LX.Music.MusicInfoLocal): Promise<string> => {
  return (await checkPath(musicInfo.meta.filePath)) ? musicInfo.meta.filePath : ''
}


let prevFileInfo: {
  path: string
  promise: Promise<LX.MusicMetadataModule.IAudioMetadata | null>
} = {
  path: '',
  promise: Promise.resolve(null),
}
const getFileMetadata = async(path: string) => {
  if (prevFileInfo.path == path) return prevFileInfo.promise
  prevFileInfo.path = path
  return prevFileInfo.promise = checkPath(path).then(async(isExist) => {
    return isExist ? import('music-metadata').then(async({ parseFile }) => parseFile(path)).catch(err => {
      console.log(err)
      return null
    }) : null
  })
}
/**
 * 获取歌曲文件封面图片
 * @param path 路径
 */
export const getLocalMusicFilePic = async(path: string) => {
  const filePath = new RegExp('\\' + extname(path) + '$')
  let picPath = path.replace(filePath, '.jpg')
  let stats = await getFileStats(picPath)
  if (stats) return picPath
  picPath = path.replace(filePath, '.png')
  stats = await getFileStats(picPath)
  if (stats) return picPath
  const metadata = await getFileMetadata(path)
  if (!metadata) return null
  const { selectCover } = await import('music-metadata')
  return selectCover(metadata.common.picture)
}

// const timeExp = /^\[([\d:.]*)\]{1}/
/**
 * 解析歌词文件，分离可能存在的翻译、罗马音歌词
 * @param lrc 歌词内容
 * @returns
 */
// export const parseLyric = (lrc: string): LX.Music.LyricInfo => {
//   const lines = lrc.split(/\r\n|\r|\n/)
//   const lyrics: string[][] = []
//   const map = new Map<string, number>()

//   for (let i = 0; i < lines.length; i++) {
//     const line = lines[i].trim()
//     let result = timeExp.exec(line)
//     if (result) {
//       const index = map.get(result[1]) ?? 0
//       if (!lyrics[index]) lyrics[index] = []
//       lyrics[index].push(line)
//       map.set(result[1], index + 1)
//     } else {
//       if (!lyrics[0]) lyrics[0] = []
//       lyrics[0].push(line)
//     }
//   }
//   const lyricInfo: LX.Music.LyricInfo = {
//     lyric: lyrics[0].join('\n'),
//     tlyric: '',
//   }
//   if (lyrics[1]) lyricInfo.tlyric = lyrics[1].join('\n')
//   if (lyrics[2]) lyricInfo.rlyric = lyrics[2].join('\n')

//   return lyricInfo
// }

type IComment = NonNullable<IAudioMetadata['common']['comment']> extends Array<infer U> ? U : never

/**
 * 获取歌曲文件歌词
 * @param path 路径
 */
export const getLocalMusicFileLyric = async(path: string): Promise<LX.Music.LyricInfo | null> => {
  // 尝试读取同目录下的同名lrc文件
  const filePath = new RegExp('\\' + extname(path) + '$')
  let lrcPath = path.replace(filePath, '.lrc')
  let stats = await getFileStats(lrcPath)
  // console.log(lrcPath, stats)
  if (stats && stats.size < 1024 * 1024 * 10) {
    const lrcBuf = await readFile(lrcPath)
    const { detect } = await import('jschardet')
    const { confidence, encoding } = detect(lrcBuf)
    console.log('lrc file encoding', confidence, encoding)
    if (confidence > 0.8) {
      const iconv = (await import('iconv-lite')).default
      if (iconv.encodingExists(encoding)) {
        const lrc = iconv.decode(lrcBuf, encoding)
        if (lrc) {
          return {
            lyric: lrc,
          }
        }
      }
    }
  }
  // 尝试读取同目录下的同名krc文件
  lrcPath = path.replace(filePath, '.krc')
  stats = await getFileStats(lrcPath)
  console.log(lrcPath, stats?.size)
  if (stats && stats.size < 1024 * 1024 * 10) {
    const lrcBuf = await readFile(lrcPath)
    try {
      return await decodeKrc(lrcBuf)
    } catch (e) {
      console.log(e)
    }
  }


  // 尝试读取文件内歌词
  const metadata = await getFileMetadata(path)
  // console.log(metadata?.common)
  if (!metadata) return null
  // let lyricInfo = metadata.common.lyrics?.[0]
  // if (lyricInfo) {
  //   let lyric: string | undefined
  //   if (typeof lyricInfo == 'object') lyric = lyricInfo.text
  //   else if (typeof lyricInfo == 'string') lyric = lyricInfo
  //   if (lyric && lyric.length > 10) {
  //     return { lyric }
  //   }
  // }
  // console.log(metadata)
  for (const info of Object.values(metadata.native)) {
    for (const ust of info) {
      switch (ust.id) {
        case 'LYRICS': {
          const value = typeof ust.value == 'string' ? ust.value : (ust as IComment).text
          if (value && value.length > 10) return { lyric: value }
          break
        }
        case 'USLT': {
          const value = ust.value as IComment
          if (value.text && value.text.length > 10) return { lyric: value.text }
          break
        }
      }
    }
  }
  return null
}
