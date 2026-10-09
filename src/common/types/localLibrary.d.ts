declare namespace LX {
  namespace LocalLibrary {
    /**
     * 本地媒体库曲目（`local_library_track` 行；列名 snake_case，出库 `AS "camelCase"` 对齐本类型）。
     *
     * 主键 `id` 是**内容哈希**：同一份音频无论从哪里导入，库中永远只有一行。
     * 歌词/封面/扩展 tag 全部内嵌在音频文件内部（spec D2 零旁车），库行只记「有无」标记。
     */
    interface Track {
      /** 内容哈希；同时是托管文件名（不含扩展名）与歌单本地条目的引用 id */
      id: string
      name: string
      singer: string
      album: string | null
      /** 展示时长（mm:ss） */
      interval: string | null
      /** 音频扩展名（不含点；托管文件名 = `${id}.${ext}`） */
      ext: string
      /** 文件字节数 */
      size: number
      year: string | null
      genre: string | null
      /** 音轨号（tag 原样，可能是 "3" 或 "3/12"） */
      trackNum: string | null
      /** 碟号 */
      discNum: string | null
      /** 内嵌封面有无 */
      hasPic: boolean
      /** 内嵌歌词有无 */
      hasLyric: boolean
      /** 入库时间（毫秒；同批共用一个值） */
      importedAt: number
    }
    /** 写入输入：`importedAt` 由 dbHelper 统一填（同批一个时间戳），调用方不传 */
    type TrackInput = Omit<Track, 'importedAt'>
  }
}
