import { getDB } from '../../db'
import {
  createReferencingOrderRowDeleteStatement,
  createReferencingRowUpdateStatement,
  createReferencingPairsQueryStatement,
  createReferencingRowsDeleteStatement,
  createReferencingRowsQueryStatement,
  createTrackCountStatement,
  createTrackDeleteStatement,
  createTrackInsertStatement,
  createTrackQueryAllStatement,
  createTrackQueryByIdStatement,
  createTrackUpdateStatement,
  type TrackBinding,
} from './statements'

/**
 * 本地媒体库的读写（票 01）。
 *
 * 三个写函数都**不是 `async`**（同 `modules/music_url`、`modules/follow_feed` 的既有形状）：
 * better-sqlite3 的事务是同步跑完的，没有 `await` 可等，Comlink 那侧等同步返回就够了。
 */

/** boolean → 0/1（better-sqlite3 不收 boolean 绑定）；`importedAt` 不在绑定里（见 statements 的 TrackBinding 注释） */
const toBinding = <T extends LX.LocalLibrary.TrackInput | LX.LocalLibrary.Track>(track: T): TrackBinding => ({
  ...track,
  hasPic: track.hasPic ? 1 : 0,
  hasLyric: track.hasLyric ? 1 : 0,
})

/** 0/1 → boolean（出库对齐 `LX.LocalLibrary.Track`） */
const toTrack = (row: Omit<LX.LocalLibrary.Track, 'hasPic' | 'hasLyric'> & { hasPic: number, hasLyric: number }): LX.LocalLibrary.Track => ({
  ...row,
  hasPic: row.hasPic === 1,
  hasLyric: row.hasLyric === 1,
})

/**
 * 批量写曲目。整批共用一个 `importedAt` 与一个 `origin`（同 `music_url`/`follow_feed` 的口径：它们记
 * 「这批什么时候、从哪进的库」，逐行取 `Date.now()` 只会让同批行差出几毫秒）。撞已有哈希的行被
 * SQLite 安静跳过（`INSERT OR IGNORE`），去重的真正判据在渲染侧管线（票 02 先查再拷），
 * 这里的 IGNORE 是最后一道兜底。
 */
export const addTracks = (rows: LX.LocalLibrary.TrackInput[], origin: LX.LocalLibrary.Origin = 'import') => {
  const db = getDB()
  const statement = createTrackInsertStatement()
  const importedAt = Date.now()
  db.transaction((rows: LX.LocalLibrary.TrackInput[]) => {
    for (const row of rows) statement.run({ ...toBinding(row), importedAt, origin })
  })(rows)
}

/** 读全部曲目（默认序见 statements 的查询注释；排序/分组由渲染侧在其上再做） */
export const queryAllTracks = (): LX.LocalLibrary.Track[] => {
  return (createTrackQueryAllStatement().all() as Array<Omit<LX.LocalLibrary.Track, 'hasPic' | 'hasLyric'> & { hasPic: number, hasLyric: number }>)
    .map(toTrack)
}

/** 按哈希批量读（不存在的 id 静默略过——调用方拿结果长度对账） */
export const queryTracksByIds = (ids: string[]): LX.LocalLibrary.Track[] => {
  const statement = createTrackQueryByIdStatement()
  const rows: Array<ReturnType<typeof toTrack>> = []
  for (const id of ids) {
    const row = statement.get(id) as Parameters<typeof toTrack>[0] | undefined
    if (row) rows.push(toTrack(row))
  }
  return rows
}

interface ReferencingRow { listId: string, name: string, singer: string, interval: string | null, meta: string }

/**
 * 更新曲目行，并在**同一事务**里同步引用歌单行（spec D4）。
 *
 * 引用行的 `name`/`singer`/`interval` 直接跟库行对齐；`meta` 是 JSON 字符串，读出 → 只改
 * `albumName` 一个键 → 写回（`filePath`/`ext`/`songId` 是播放与身份依据，一个字节都不碰）。
 * 返回是否真的改到行（更新不存在的哈希返回 `false`，调用方据此提示而不是假装成功）。
 * 中途失败整段回滚：库行与引用行不会出现「改了一半」的状态。
 */
export const updateTrackWithReferences = (track: LX.LocalLibrary.Track): boolean => {
  const db = getDB()
  let changed = false
  db.transaction(() => {
    const result = createTrackUpdateStatement().run(toBinding(track))
    changed = result.changes > 0
    if (!changed) return
    const rows = createReferencingRowsQueryStatement().all(track.id) as ReferencingRow[]
    const updateRef = createReferencingRowUpdateStatement()
    for (const row of rows) {
      // meta 是 JSON 字符串，读出 → 只改 albumName 一个键 → 写回。解析失败（历史坏数据）就
      // **原样保留**整个字符串——宁可这一行的专辑显示旧值，也不能把 filePath/ext/songId
      // 一起洗掉（播放与身份依据，丢一个字节都算事故）
      let meta = row.meta
      try {
        const parsed = JSON.parse(row.meta) as Record<string, unknown>
        parsed.albumName = track.album ?? ''
        meta = JSON.stringify(parsed)
      } catch {}
      updateRef.run({
        listId: row.listId,
        id: track.id,
        name: track.name,
        singer: track.singer,
        interval: track.interval,
        meta,
      })
    }
  })()
  return changed
}

/**
 * 移除曲目（含级联）：引用条目行、排序行、曲目行三处一起删，**整段一个事务**——
 * 引用行删了曲目行没删（或反过来）都是半套状态。
 * 排序行按**先查出的（listId, id）配对**精确删：`my_list_music_info_order` 没有 source 概念，
 * 同 id 的在线条目（只可能与库曲目同 id 于不同列表，`UNIQUE(id,listId)` 保证）的排序位不许被误删。
 * 非 local 的条目行不属于库，不受影响。
 */
export const removeTracks = (ids: string[]) => {
  if (!ids.length) return
  const db = getDB()
  db.transaction(() => {
    const pairs = createReferencingPairsQueryStatement(ids.length).all(...ids) as Array<{ listId: string, id: string }>
    createReferencingRowsDeleteStatement(ids.length).run(...ids)
    const deleteOrder = createReferencingOrderRowDeleteStatement()
    for (const pair of pairs) deleteOrder.run({ listId: pair.listId, musicInfoId: pair.id })
    createTrackDeleteStatement(ids.length).run(...ids)
  })()
}

/** 曲目总数 */
export const countTracks = (): number => {
  return (createTrackCountStatement().get() as { count: number }).count
}
