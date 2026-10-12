// 业务工具方法

export const toNewMusicInfo = (oldMusicInfo: any): LX.Music.MusicInfo => {
  const meta: Record<string, any> = {
    songId: oldMusicInfo.songmid, // 歌曲ID，local为文件路径
    albumName: oldMusicInfo.albumName, // 歌曲专辑名称
    picUrl: oldMusicInfo.img, // 歌曲图片链接
  }
  const newInfo = {
    id: `${oldMusicInfo.source}_${oldMusicInfo.songmid}`,
    name: oldMusicInfo.name,
    singer: oldMusicInfo.singer,
    source: oldMusicInfo.source,
    interval: oldMusicInfo.interval,
    meta: meta as LX.Music.MusicInfoOnline['meta'],
  }

  if (oldMusicInfo.source == 'local') {
    meta.filePath = oldMusicInfo.filePath ?? oldMusicInfo.songmid ?? ''
    meta.ext = oldMusicInfo.ext ?? /\.(\w+)$/.exec(meta.filePath)?.[1] ?? ''
  } else {
    meta.qualitys = oldMusicInfo.types
    meta._qualitys = oldMusicInfo._types
    meta.albumId = oldMusicInfo.albumId
    if (meta._qualitys.flac32bit && !meta._qualitys.flac24bit) {
      meta._qualitys.flac24bit = meta._qualitys.flac32bit
      delete meta._qualitys.flac32bit

      meta.qualitys = (meta.qualitys as any[]).map(quality => {
        if (quality.type == 'flac32bit') quality.type = 'flac24bit'
        return quality
      })
    }

    // 在线源只有 tx（见 LX.OnlineSource）；将来加源时这里按源补字段映射
    meta.strMediaMid = oldMusicInfo.strMediaMid
    meta.id = oldMusicInfo.songId
    meta.albumMid = oldMusicInfo.albumMid
    // songType 是 QQ 歌单写操作（增删歌曲）要用的原始 type，别在中转时丢掉
    meta.songType = oldMusicInfo.songType
  }

  return newInfo
}

export const toOldMusicInfo = (minfo: LX.Music.MusicInfo) => {
  const oInfo: Record<string, any> = {
    name: minfo.name,
    singer: minfo.singer,
    source: minfo.source,
    songmid: minfo.meta.songId,
    interval: minfo.interval,
    albumName: minfo.meta.albumName,
    img: minfo.meta.picUrl ?? '',
    typeUrl: {},
  }
  if (minfo.source == 'local') {
    oInfo.filePath = minfo.meta.filePath
    oInfo.ext = minfo.meta.ext
    oInfo.albumId = ''
    oInfo.types = []
    oInfo._types = {}
  } else {
    oInfo.albumId = minfo.meta.albumId
    oInfo.types = minfo.meta.qualitys
    oInfo._types = minfo.meta._qualitys

    // 在线源只有 tx（见 LX.OnlineSource）；将来加源时这里按源补字段映射
    oInfo.strMediaMid = minfo.meta.strMediaMid
    oInfo.albumMid = minfo.meta.albumMid
    oInfo.songId = minfo.meta.id
    oInfo.songType = minfo.meta.songType
  }

  return oInfo
}

/**
 * 修复2.0.0-dev.8之前的新列表数据音质
 * @param musicInfo
 */
export const fixNewMusicInfoQuality = (musicInfo: LX.Music.MusicInfo) => {
  if (musicInfo.source == 'local') return musicInfo

  // @ts-expect-error
  if (musicInfo.meta._qualitys.flac32bit && !musicInfo.meta._qualitys.flac24bit) {
    // @ts-expect-error
    musicInfo.meta._qualitys.flac24bit = musicInfo.meta._qualitys.flac32bit
    // @ts-expect-error
    delete musicInfo.meta._qualitys.flac32bit

    musicInfo.meta.qualitys = musicInfo.meta.qualitys.map(quality => {
      // @ts-expect-error
      if (quality.type == 'flac32bit') quality.type = 'flac24bit'
      return quality
    })
  }

  return musicInfo
}

export const filterMusicList = <T extends LX.Music.MusicInfo>(list: T[]): T[] => {
  const ids = new Set<string>()
  return list.filter(s => {
    if (!s.id || ids.has(s.id) || !s.name) return false
    if (s.singer == null) s.singer = ''
    ids.add(s.id)
    return true
  })
}


const MAX_NAME_LENGTH = 80
const MAX_FILE_NAME_LENGTH = 150
export const clipNameLength = (name: string) => {
  if (name.length <= MAX_NAME_LENGTH || !name.includes('、')) return name
  const names = name.split('、')
  let newName = names.shift()!
  for (const name of names) {
    if (newName.length + name.length > MAX_NAME_LENGTH) break
    newName = newName + '、' + name
  }
  return newName
}
export const clipFileNameLength = (name: string) => {
  return name.length > MAX_FILE_NAME_LENGTH ? name.substring(0, MAX_FILE_NAME_LENGTH) : name
}

/**
 * 「复制歌名」等处的固定模板：原 `download.fileNameTemplate` 的默认值，该设置已随集合概念统一
 * （下载托管化）下架——下载暂存文件名固定为「歌曲 id + 实际档位」，用户可配命名只剩导出向导。
 */
export const DEFAULT_MUSIC_NAME_TEMPLATE = '歌名 - 歌手'

/**
 * 按模板串渲染歌名：固定模板（`DEFAULT_MUSIC_NAME_TEMPLATE`）与「复制歌名」各处共用这一个实现。
 *
 * 模板串的语义契约：
 * - 只有两个占位词：`歌手`（艺术家）与 `歌名`（歌曲名）；其余文本原样保留（不认 `{歌名}` 这类花括号写法）
 * - **所有出现都替换**（`歌名_歌名` → 替换两次），且**一趟走完**：分两趟 `replace('歌手',…).replace('歌名',…)`
 *   的写法会在艺术家名里含「歌名」时把刚填进去的艺术家名又替掉一次
 * - 这里**不做**文件名安全处理（`\ / : * ? # " < > |` 由导出侧处理）
 */
export const formatMusicName = (format: string, name: string, singer: string) => {
  return format.replace(/歌名|歌手/g, match => match === '歌名' ? name : singer)
}
