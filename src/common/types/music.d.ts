declare namespace LX {
  namespace Music {
    interface MusicQualityType { // {"type": "128k", size: "3.56M"}
      type: LX.Quality
      size: string | null
    }
    type _MusicQualityType = Partial<Record<Quality, {
      size: string | null
    }>>


    interface MusicInfoMetaBase {
      songId: string | number // 歌曲ID，mg源为copyrightId，local为文件路径
      albumName: string // 歌曲专辑名称
      picUrl?: string | null // 歌曲图片链接
      toggleMusicInfo?: MusicInfoOnline | null
    }

    interface MusicInfoMeta_online extends MusicInfoMetaBase {
      qualitys: MusicQualityType[]
      _qualitys: _MusicQualityType
      albumId?: string | number // 歌曲专辑ID
    }

    interface MusicInfoMeta_local extends MusicInfoMetaBase {
      filePath: string
      ext: string
      /** 引用的媒体库曲目哈希（票 02 起：新托管条目 id=哈希并带此字段；旧式直读路径条目没有） */
      trackId?: string
    }


    interface MusicInfoBase<S = LX.Source> {
      id: string
      name: string // 歌曲名
      singer: string // 艺术家名
      source: S // 源
      interval: string | null // 格式化后的歌曲时长，例：03:55
      meta: MusicInfoMetaBase
    }

    interface MusicInfoLocal extends MusicInfoBase<'local'> {
      meta: MusicInfoMeta_local
    }

    interface MusicInfoMeta_tx extends MusicInfoMeta_online {
      strMediaMid: string // 歌曲strMediaMid
      id?: number // 歌曲songId
      albumMid?: string // 歌曲albumMid
      songType?: number // QQ 原始 type（歌单增删歌曲的写接口要它）
    }
    interface MusicInfo_tx extends MusicInfoBase<'tx'> {
      meta: MusicInfoMeta_tx
    }

    // 在线歌曲只有 QQ 音乐一条线（见 LX.OnlineSource 的说明）。将来加源时在此补
    // `MusicInfoMeta_<源>` + `MusicInfo_<源>`，并把新类型并进这个联合即可。
    type MusicInfoOnline = MusicInfo_tx
    type MusicInfo = MusicInfoOnline | MusicInfoLocal

    interface LyricInfo {
      // 歌曲歌词
      lyric: string
      // 翻译歌词
      tlyric?: string | null
      // 罗马音歌词
      rlyric?: string | null
      // 逐字歌词
      lxlyric?: string | null
    }

    interface LyricInfoSave {
      id: string
      lyrics: LyricInfo
    }

    interface MusicFileMeta {
      title: string
      artist: string | null
      album: string | null
      APIC: string | null
      lyrics: string | null
    }

    interface MusicUrlInfo {
      id: string
      url: string
    }

    /**
     * URL 缓存回收参数（设置页重构票 08）。两个阈值都是 0 = 不回收，这是默认值（行为零变化）。
     * 消费点：worker 的 `modules/music_url/recycle.ts`（纯判断）与 `index.ts`（取行 / 删行）。
     */
    interface MusicUrlRecycleOptions {
      /** 保留天数（`cache.musicUrlKeepDays`），0 = 不按时间回收 */
      keepDays: number
      /** 容量上限 MB（`cache.maxSizeMB`），0 = 不按容量回收 */
      maxSizeMB: number
      /**
       * 正在播放那首歌的缓存 key 前缀（`${musicInfo.id}_`，含各档位）：命中的行一条都不删。
       * 启动时的回收不传（那时还没开始播），设置页的「立即回收」必须传。
       */
      keepIdPrefix?: string | null
    }

    /** URL 缓存回收结果（设置页据此给反馈文案） */
    interface MusicUrlRecycleResult {
      /** 实际删除的行数 */
      deleted: number
      /**
       * 回收前 / 后的近似总占用（字符数，id + url）。
       * `skipped` 时为 `null`——那时为了零开销**没有读库**，算不出占用。
       */
      bytesBefore: number | null
      bytesAfter: number | null
      /** 两个阈值都是 0（不回收）时为 true：调用方据此提示「不回收」而不是「已回收 0 条」 */
      skipped: boolean
    }

    interface MusicInfoOtherSourceSave {
      id: string
      list: MusicInfoOnline[]
    }

  }
}
