import { toNewMusicInfo } from '@common/utils/tools'

/**
 * 关注动态的**纯增量计算**：给一位歌手的「本轮抓到的歌」与「他上次的基线」，算出新条目与新基线。
 *
 * 这里没有网络、没有数据库、没有 `Date.now()`——编排在 `check.ts`，存储在主进程的
 * `follow_feed` 域。分开的理由只有一个：判据是这件事里最容易错、也最需要被钉住的部分。
 */

/** 数据层（`tx/singer.getLatestSongs`）交来的形状：老式歌曲对象 + 发布时间（`time_public`，可能为空串） */
export interface FetchedSong {
  song: any
  publishTime: string
}

/** 一轮里某位歌手的扫描结果；`ok: false` = 这一块请求失败（基线**不许**推进） */
export interface SingerFetch {
  mid: string
  ok: boolean
  songs: FetchedSong[]
}

export interface SingerDiff {
  /** 本轮要落库的条目（可能为空） */
  items: LX.FollowFeed.ItemInput[]
  /** 这位歌手的新基线（调用方只在 `ok` 时写库） */
  baseline: LX.FollowFeed.BaselineInput
}

/** 新式歌曲 id（`tx_<songmid>`）——条目去重键、播放载荷 id、基线标记都用它 */
export const newSongIdOf = (song: any): string => toNewMusicInfo(song).id

/** 一首歌 → 新歌行 */
const songItem = (singer: { mid: string, name: string }, fetched: FetchedSong): LX.FollowFeed.ItemInput => {
  const newSong = toNewMusicInfo(fetched.song)
  return {
    kind: 'song',
    singerMid: singer.mid,
    singerName: singer.name,
    itemId: newSong.id,
    name: String(newSong.name ?? ''),
    albumMid: fetched.song.albumMid ? String(fetched.song.albumMid) : null,
    albumName: fetched.song.albumName ? String(fetched.song.albumName) : null,
    trackCount: null,
    publishTime: fetched.publishTime,
    // 播放载荷：时间线里的歌可能早已不在接口的最新窗口里，不存它就得为了播放再查一次
    music: JSON.stringify(newSong),
  }
}

/**
 * 一位歌手的增量。
 *
 * ## 判新 = 「从列表头部往下走，遇到已知标记就停」
 *
 * 不是「比基线的时间更新」——2026-09-26 的抽样复核（工单 01）实测 `order: 0` **并非普遍**
 * 按发布时间倒序：歌曲侧 12 位歌手里有 1 位出现「2021 年的曲目排在 2025 年的前面」
 * （老曲重发／被合辑收编时，`time_public` 是**原始**发行日期，而排序键更接近**登记顺序**）。
 * 按时间比会在那种页面上判错；按「走到上次已知的那首为止」则与排序键无关，稳。
 *
 * 代价（诚实登记）：基线标记之后的条目永远不会被补报（`num: 1` 的扫描窗口之外也一样），
 * 所以「窗口里没遇到标记」时按「窗口内全是新的」处理——长期没开应用时宁可多报几条。
 *
 * ## 首次见到该歌手（`baseline == null`）
 *
 * `diffSinger` 自身**不产条目**（返回空 items + 第一版基线）——它只管纯增量。
 * 「首次也要让用户看到最近更新」由调用方补：`check.ts` 对首次歌手额外调 `backfillItemsOf`
 * 取最新一簇（2026-09-28 用户拍板，取代原来的「首次全静默」）。
 *
 * 判据是**有没有基线行**，不是「标记是不是 null」：一位此前没有任何作品的歌手
 * （基线行存在、标记为 null）在发出第一首歌时**必须**报出来，否则他会被永远当成「首次」而静默掉
 * ——这条路径在 `check.ts` 的补查筛选里（`row.latestSongId == null` 也要补查）。
 */
/**
 * 一批「本轮算新」的曲目 → 条目行。
 *
 * 专辑聚合（同一张专辑本轮出现 ≥2 首 → 合并成**一行新专**，收录曲不单独占行，用户拍板的形态）
 * 在这里只写一份：增量（`diffSinger`）与补齐（`backfillItemsOf`）的聚合规则必须一致。
 */
const itemsFromSongs = (singer: { mid: string, name: string }, songs: FetchedSong[]): LX.FollowFeed.ItemInput[] => {
  const items: LX.FollowFeed.ItemInput[] = []
  const albums = new Map<string, FetchedSong[]>()
  for (const item of songs) {
    const albumMid = String(item.song.albumMid ?? '')
    if (!albumMid) {
      // 没有专辑 mid 的（罕见）当单曲处理，不聚合
      items.push(songItem(singer, item))
      continue
    }
    const group = albums.get(albumMid)
    if (group) group.push(item)
    else albums.set(albumMid, [item])
  }
  for (const [albumMid, group] of albums) {
    if (group.length < 2) {
      items.push(songItem(singer, group[0]))
      continue
    }
    items.push({
      kind: 'album',
      singerMid: singer.mid,
      singerName: singer.name,
      itemId: albumMid,
      name: String(group[0].song.albumName ?? ''),
      albumMid,
      albumName: group[0].song.albumName ? String(group[0].song.albumName) : null,
      // 「曲目数」用**本轮该专辑的新歌数**，不是专辑的总曲目数
      // （`GetAlbumList` 的 `totalNum` 实测恒为 0，见 spec；且这正是用户拍板的「≥2 首算新专」）
      trackCount: group.length,
      // 发布日期取组里最新的一条：专辑行的日期应当是「这批新歌里最新的那天」
      publishTime: group.reduce((max, item) => (item.publishTime > max ? item.publishTime : max), ''),
      // 播放载荷：**本簇内每首歌**的新式歌曲对象数组——专辑行在页面上可以直接展开听
      // （2026-09-28 用户拍板：不出动态页就能播，不必跳专辑页）。注意只含本轮发现的曲目，
      // 专辑的全量曲目仍以专辑页为准（点专辑名进页）。
      music: JSON.stringify(group.map(item => toNewMusicInfo(item.song))),
    })
  }
  return items
}

/**
 * 「最新一簇」：列表头开始、与第一首**同专辑的连续曲目**。
 *
 * 补齐（首次见到该歌手 / 一次性存量补档）用它——用户拍板的口径是「每位歌手最新的更新」：
 * 一张专辑整批进列表时曲目连续排列（实测：商潮《洄潮》8 首、窦唯《秋声赋》2 首都相连），
 * 所以「从头部取到第一张不同专辑为止」就是最近一次发布。没有专辑 mid 的取头一首。
 */
export const latestCluster = (songs: FetchedSong[]): FetchedSong[] => {
  const head = songs[0]
  if (!head) return []
  const albumMid = String(head.song.albumMid ?? '')
  if (!albumMid) return [head]
  const out: FetchedSong[] = []
  for (const item of songs) {
    if (String(item.song.albumMid ?? '') !== albumMid) break
    out.push(item)
  }
  return out
}

/**
 * 补齐条目：某位歌手的「最新更新」。
 *
 * **不是首次静默**（2026-09-28 用户拍板改口径）：首次见到该歌手、以及存量库的一次性补档，
 * 都把最新一簇报出来——QQ 侧「今天释放」的作品发布日期可能是过去几天/几周的
 * （实测：窦唯《菊花赋》发布于 09-19、商潮《洄潮》09-22，但都是新近才进列表），
 * 全静默会让用户开了功能却看不到最近的更新。展示窗口（本周 + 上一周）由写入侧清理兜底。
 */
export const backfillItemsOf = (singer: { mid: string, name: string }, songs: FetchedSong[]): LX.FollowFeed.ItemInput[] =>
  itemsFromSongs(singer, latestCluster(songs))

export const diffSinger = (
  singer: { mid: string, name: string },
  songs: FetchedSong[],
  baseline: LX.FollowFeed.Baseline | undefined,
): SingerDiff => {
  const marker = baseline?.latestSongId ?? null

  const fresh: FetchedSong[] = []
  for (const item of songs) {
    if (marker != null && newSongIdOf(item.song) === marker) break
    fresh.push(item)
  }

  const newest = songs[0]
  const next: LX.FollowFeed.BaselineInput = {
    singerMid: singer.mid,
    // 本轮没取到歌时**保住旧标记**（否则下次会把历史当新的重报一遍）
    latestSongId: newest ? newSongIdOf(newest.song) : marker,
    latestSongTime: newest ? (newest.publishTime || null) : (baseline?.latestSongTime ?? null),
  }

  if (baseline == null) return { items: [], baseline: next }

  return { items: itemsFromSongs(singer, fresh), baseline: next }
}
