import { getDB } from '../../db'

/**
 * 本地媒体库的语句集（`local_library_track` + 引用歌单行的联动）。
 *
 * 列名 snake_case（建表如此，见 `tables.ts`），出库 `AS "camelCase"` 对齐 `LX.LocalLibrary.Track`。
 * 「引用行」= `my_list_music_info` 里 `source='local'` 且 `id` 等于曲目哈希的行（spec D4：
 * 新本地条目以哈希为 id 引用库曲目）。曲目的展示字段（name/singer/interval/album）在库行与
 * 引用行是**两份**——更新必须联动（`dbHelper.updateTrackWithReferences`），否则歌单显示旧名字。
 */

/** better-sqlite3 不接受 boolean 绑定，布尔列以 0/1 落库；出入库的换算在 dbHelper。
 * `importedAt` 不在其中：INSERT 的值由 dbHelper 统一填、UPDATE 不写它（入库事实不可改） */
export interface TrackBinding extends Omit<LX.LocalLibrary.Track, 'hasPic' | 'hasLyric' | 'importedAt'> {
  hasPic: number
  hasLyric: number
}

/** 批量写曲目（`INSERT OR IGNORE`：撞上已有哈希**保留首见行**——内容相同天然去重，不用新值覆盖） */
export const createTrackInsertStatement = () => {
  const db = getDB()
  return db.prepare<[TrackBinding & { importedAt: number }]>(`
    INSERT OR IGNORE INTO "main"."local_library_track"
      ("id", "name", "singer", "album", "interval", "ext", "size",
       "year", "genre", "track_num", "disc_num", "has_pic", "has_lyric", "imported_at")
    VALUES (@id, @name, @singer, @album, @interval, @ext, @size,
       @year, @genre, @trackNum, @discNum, @hasPic, @hasLyric, @importedAt)
  `)
}

/** 出库列清单（`AS "camelCase"` 对齐 `LX.LocalLibrary.Track`）；两处查询共用，改列只改这里 */
const TRACK_SELECT_COLUMNS = `
      "id" AS "id",
      "name" AS "name",
      "singer" AS "singer",
      "album" AS "album",
      "interval" AS "interval",
      "ext" AS "ext",
      "size" AS "size",
      "year" AS "year",
      "genre" AS "genre",
      "track_num" AS "trackNum",
      "disc_num" AS "discNum",
      "has_pic" AS "hasPic",
      "has_lyric" AS "hasLyric",
      "imported_at" AS "importedAt"`

/** 读全部曲目（默认序：名称不区分大小写，同名列按歌手——渲染侧的排序/分组在其上再排） */
export const createTrackQueryAllStatement = () => {
  const db = getDB()
  return db.prepare<[]>(`
    SELECT${TRACK_SELECT_COLUMNS}
    FROM "main"."local_library_track"
    ORDER BY "name" COLLATE NOCASE, "singer" COLLATE NOCASE
  `)
}

/** 按哈希读单条曲目 */
export const createTrackQueryByIdStatement = () => {
  const db = getDB()
  return db.prepare<[string]>(`
    SELECT${TRACK_SELECT_COLUMNS}
    FROM "main"."local_library_track"
    WHERE "id" = ?
  `)
}

/** 更新曲目行（编辑的文本字段与有无标记；`id`/`ext`/`size`/`imported_at` 不在列——身份与入库事实不可改） */
export const createTrackUpdateStatement = () => {
  const db = getDB()
  return db.prepare<[TrackBinding]>(`
    UPDATE "main"."local_library_track" SET
      "name" = @name,
      "singer" = @singer,
      "album" = @album,
      "interval" = @interval,
      "year" = @year,
      "genre" = @genre,
      "track_num" = @trackNum,
      "disc_num" = @discNum,
      "has_pic" = @hasPic,
      "has_lyric" = @hasLyric
    WHERE "id" = @id
  `)
}

/** 读某曲目的全部引用行（只取联动要动的列） */
export const createReferencingRowsQueryStatement = () => {
  const db = getDB()
  return db.prepare<[string]>(`
    SELECT "listId" AS "listId", "name" AS "name", "singer" AS "singer",
           "interval" AS "interval", "meta" AS "meta"
    FROM "main"."my_list_music_info"
    WHERE "id" = ? AND "source" = 'local'
  `)
}

/** 引用行联动更新：展示字段 + `meta.albumName`（`meta` 的其余键由 dbHelper 读改写保留） */
export const createReferencingRowUpdateStatement = () => {
  const db = getDB()
  return db.prepare<[{ listId: string, id: string, name: string, singer: string, interval: string | null, meta: string }]>(`
    UPDATE "main"."my_list_music_info"
    SET "name" = @name, "singer" = @singer, "interval" = @interval, "meta" = @meta
    WHERE "id" = @id AND "listId" = @listId
  `)
}

/** 移除曲目时级联删引用条目行（`source='local'` 的行属于库；tx 等在线行不受影响）。占位符数由 dbHelper 按批量拼 */
export const createReferencingRowsDeleteStatement = (count: number) => {
  const db = getDB()
  return db.prepare<[...string[]]>(`
    DELETE FROM "main"."my_list_music_info"
    WHERE "source" = 'local' AND "id" IN (${Array.from({ length: count }, () => '?').join(', ')})
  `)
}

/** 先查出将被删除的（listId, id）对——排序行的级联以这份**精确配对**为准，而不是按 id 一把梭（同 id 的在线条目排序位不许被误删） */
export const createReferencingPairsQueryStatement = (count: number) => {
  const db = getDB()
  return db.prepare<[...string[]]>(`
    SELECT "listId" AS "listId", "id" AS "id"
    FROM "main"."my_list_music_info"
    WHERE "source" = 'local' AND "id" IN (${Array.from({ length: count }, () => '?').join(', ')})
  `)
}

/** 级联删排序行——单对精确删除（条目行与排序行是两份数据，`UNIQUE(id,listId)` 只在条目表上） */
export const createReferencingOrderRowDeleteStatement = () => {
  const db = getDB()
  return db.prepare<[{ listId: string, musicInfoId: string }]>(`
    DELETE FROM "main"."my_list_music_info_order"
    WHERE "listId" = @listId AND "musicInfoId" = @musicInfoId
  `)
}

export const createTrackDeleteStatement = (count: number) => {
  const db = getDB()
  return db.prepare<[...string[]]>(`
    DELETE FROM "main"."local_library_track"
    WHERE "id" IN (${Array.from({ length: count }, () => '?').join(', ')})
  `)
}

/** 曲目总数（库视图的角标/空态判据） */
export const createTrackCountStatement = () => {
  const db = getDB()
  return db.prepare<[]>(`
    SELECT COUNT(*) AS "count" FROM "main"."local_library_track"
  `)
}
