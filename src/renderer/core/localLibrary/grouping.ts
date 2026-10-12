/**
 * 库视图的搜索过滤与分组（票 05，spec D17）——**纯函数**，单测直接跑。
 *
 * 分组是渲染层内存行为：不落库、不进设置、不同步。设计约束：
 * - 「不分组」= 纯平铺（仍应用搜索过滤）；
 * - 任意 tag 字段皆可为维度（用户拍板「只要存在的 tag 都可以」），空值归「未知」组且排最后；
 * - 组头可折叠：折叠状态由调用方持有（Set），本模块只负责把它反映到行序列里；
 * - 输出行是**扁平序列**（组头行 + 曲目行交错），虚拟列表按统一行高渲染。
 */

export type GroupDim = null | 'singer' | 'album' | 'genre' | 'year' | 'trackNum' | 'discNum' | 'ext' | 'origin'

export type LibraryTrack = LX.LocalLibrary.Track & { filePath?: string }

export interface LibraryRow {
  type: 'header' | 'track'
  /** header=分组键（未知组为固定哨兵）；track=曲目哈希 */
  key: string
  /** 仅 header：分组显示名 */
  label?: string
  /** 仅 header：组内曲目数 */
  count?: number
  /** 仅 header：是否已折叠 */
  collapsed?: boolean
  /** 仅 track */
  track?: LibraryTrack
  /** 仅 track：在**过滤后**曲目序列中的序号（双击播放用它定位） */
  playIndex?: number
}

const UNKNOWN_KEY = '__unknown__'

/** 搜索过滤：歌名/歌手/专辑的子串匹配（大小写不敏感；字段做空值防御，坏数据不炸过滤） */
export const filterLibraryTracks = (tracks: LibraryTrack[], query: string): LibraryTrack[] => {
  const q = query.trim().toLowerCase()
  if (!q) return tracks
  return tracks.filter(track =>
    [track.name, track.singer, track.album].some(value => (value ?? '').toLowerCase().includes(q)),
  )
}

export const groupLibraryTracks = (
  tracks: LibraryTrack[],
  dim: GroupDim,
  query: string,
  collapsedKeys: Set<string>,
  unknownLabel: string,
  /** 仅 `origin` 维度的显示名映射（`import`/`download` → 用户可见文案；缺省则显示原值） */
  originLabels: Record<string, string> = {},
): LibraryRow[] => {
  const filtered = filterLibraryTracks(tracks, query)
  if (!dim) {
    return filtered.map((track, playIndex) => ({ type: 'track' as const, key: track.id, track, playIndex }))
  }

  const groups = new Map<string, { label: string, items: Array<{ track: LibraryTrack, playIndex: number }> }>()
  filtered.forEach((track, playIndex) => {
    const raw: unknown = track[dim]
    const value = raw == null || raw === '' ? '' : String(raw)
    const key = value === '' ? UNKNOWN_KEY : value
    let group = groups.get(key)
    if (!group) {
      const label = value === '' ? unknownLabel : (dim == 'origin' ? originLabels[value] ?? value : value)
      group = { label, items: [] }
      groups.set(key, group)
    }
    group.items.push({ track, playIndex })
  })

  // 组间：名称排序（数字感知，「10」排在「2」后面），未知组恒最后；组内保持传入序（默认=名称序）
  const sortedKeys = Array.from(groups.keys()).sort((a, b) => {
    if (a == UNKNOWN_KEY) return 1
    if (b == UNKNOWN_KEY) return -1
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
  })

  const rows: LibraryRow[] = []
  for (const key of sortedKeys) {
    const group = groups.get(key)!
    rows.push({ type: 'header', key, label: group.label, count: group.items.length, collapsed: collapsedKeys.has(key) })
    if (!collapsedKeys.has(key)) {
      for (const { track, playIndex } of group.items) {
        rows.push({ type: 'track', key: track.id, track, playIndex })
      }
    }
  }
  return rows
}
