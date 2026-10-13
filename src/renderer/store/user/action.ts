import { markRawList } from '@common/utils/vueTools'
import { getPageSize } from '@common/settings/pageSize'
import { deduplicationList, toNewMusicInfo } from '@renderer/utils'
import music from '@renderer/utils/musicSdk'
import { appSetting } from '@renderer/store/setting'
import {
  cloudListSongs, createdLists, favAlbumIds, favAlbums, favLists, favPlaylistIds, favSongIds, favSongIdsLoaded, favSongs, followSingers, isInited, isLoading, labels,
  musicGene, pagers, profile, vip, type PlaylistCard,
} from './state'

/**
 * 账号中心（我的音乐，M4）的取数逻辑。
 *
 * 三个约定：
 *   1. 账号接口是**弱依赖**——失败只写 `noItemLabel` 文案（§2.11 三段式），不抛给视图，
 *      否则一个接口挂掉会让整页白屏。
 *   2. 列表写回用 `splice(0, len, ...)`（保持 shallowReactive 数组引用不变），
 *      歌曲列表额外过 `markRawList` 防深度代理。
 *   3. 未登录时不发请求：`getUser` 会抛错，这里统一落"请先登录 QQ 音乐"文案。
 */

const t = (key: string) => window.i18n.t(key as any)

const setList = (target: any[], list: any[], raw = false) => {
  const next = raw ? markRawList(list) : list
  target.splice(0, target.length, ...next)
}

const appendList = (target: any[], list: any[]) => {
  target.push(...markRawList(list))
}

/**
 * 列表容器的 `no-item` 文案（`material-online-list` / `song-card-grid` 拿它**同时当显隐开关**）：
 * **有数据时必须给空串**，否则一次「加载更多」失败就会把整页已加载的数据藏掉（2026-09-26 审查，
 * 云端歌单面板真机踩到）。空表时才退回「加载中 / 失败 / 暂无内容」。
 */
export const noItemLabelOf = (label: string, hasData: boolean): string =>
  hasData ? '' : (label || t('no_item'))

/**
 * 「加载更多」失败的**独立提示位**：现在把失败文案落在各块自己的 `labels` / `noItemLabel` 里，
 * 有数据时它不能当空态用（见 `noItemLabelOf`），所以搬到列表下方的这一行显示。
 *
 * 加载中的文案不算失败（刷新 / 首屏期间它也在 `labels` 里）；空表时由空态承担，不重复显示。
 */
export const moreErrorLabelOf = (label: string, hasData: boolean): string =>
  hasData && label && label !== t('list__loading') ? label : ''

/**
 * 歌曲列表写回：`tx/user.js` 给的是**老式歌曲对象**（musicSdk 内部形状），而 UI/store 用的是
 * 新式（平台字段进 `meta`，列表组件会读 `meta._qualitys`）——中间必须过 `toNewMusicInfo`
 * （写法对齐 store/leaderboard/action.ts:57）。
 *
 * 并且**原地**替换内容（splice），不能整体赋值：在线列表组件的双击播放（`OnlineList/usePlay`）
 * 捕获的是数组引用，整体赋值会让它后续播到 undefined。
 */
const toOnlineList = (list: any[]): LX.Music.MusicInfoOnline[] =>
  markRawList(deduplicationList(list.map(item => toNewMusicInfo(item)) as LX.Music.MusicInfoOnline[]))

const setSongs = (target: LX.Music.MusicInfoOnline[], list: any[]) => {
  target.splice(0, target.length, ...toOnlineList(list))
}

const appendSongs = (target: LX.Music.MusicInfoOnline[], list: any[]) => {
  target.push(...toOnlineList(list))
}

/** 统一收口：loading → 取数 → 成功清文案 / 失败落失败文案（不抛）。 */
const load = async(key: keyof typeof labels, task: () => Promise<void>) => {
  labels[key] = t('list__loading')
  try {
    await task()
    labels[key] = ''
  } catch (err: any) {
    console.log('[user]', key, err)
    labels[key] = err?.message === 'QQ 音乐未登录' ? t('user_center__need_login') : t('list__load_failed')
  }
}

const user = () => music.tx.user

/**
 * 复位账号中心的**会话缓存**（登录成功 / 登出两条路径都调，见 `store/qqAuth/action.ts`）。
 *
 * 为什么必须有：这份缓存是模块级单例，不随登录态复位——未登录时进过任一页
 * （`initUserCenter` 会把 `isInited` 置 true）→ 登录后不再取数；换号后 `favSongIds`
 * 还是上一个人的（`toggleFavSongToCloud` 会判反方向：该移除的又收藏一遍）。
 *
 * 清到「这个会话什么都没拉过」的状态：列表 / 分页 / 收藏态全量 id / 文案 / `isInited`。
 * 复位后由页面在登录信号到达时重拉（各 Favorites 面板的 `watch(() => status.isLogin)`）。
 *
 * `profile` / `vip` / `musicGene` 一并清空：它们同样是账号数据，登出后不该继续显示上一个人的
 * 昵称 / 会员态（键必须全写，理由同 state.ts 里 musicGene 的注释——`Object.assign` 是覆盖式的）。
 */
export const resetUserCenter = (): void => {
  setList(createdLists, [])
  setList(favLists, [])
  setList(favAlbums, [])
  setList(followSingers, [])
  setList(favSongs.list, [])
  favSongs.total = 0
  favSongs.page = 1
  // 收藏态（「收了没」靠的全量 id 集合）必须失效——`favSongIdsLoaded` 也要回 false
  setList(favSongIds, [])
  favSongIdsLoaded.value = false
  setList(favAlbumIds, [])
  setList(favPlaylistIds, [])
  // 云端自建歌单面板当前选中的内容（`listTid` 一并清，避免拿旧歌单的 id 误判）
  setList(cloudListSongs.list, [])
  cloudListSongs.total = 0
  cloudListSongs.page = 1
  cloudListSongs.listTid = ''
  cloudListSongs.noItemLabel = ''
  Object.assign(profile, { name: '', avatar: '', bigAvatar: '', isSinger: false, fans: 0, follow: 0, friends: 0, visitor: 0 })
  Object.assign(vip, { canRenew: false, hires: false, dolby: false, maxSongNum: 0, maxDirNum: 0 })
  Object.assign(musicGene, {
    nick: '', avatar: '', mainDescription: '', singers: [], genres: [], personality: null, personalityTags: [], status: [], ages: [], bpm: null, grooving: null, timePreference: null, characterColor: null, report: [], aiCards: [], aiTags: [],
  })
  for (const key of Object.keys(labels) as Array<keyof typeof labels>) labels[key] = ''
  pagers.favLists = { page: 1, hasMore: false }
  pagers.favAlbums = { page: 1, hasMore: false }
  pagers.followSingers = { page: 1, hasMore: false }
  isInited.value = false
  isLoading.value = false
}

/** 首屏：主页概览 + 各列表。已初始化过就直接返回（视图切回来不必重拉）。 */
export const initUserCenter = async(force = false): Promise<void> => {
  if (isLoading.value) return
  if (isInited.value && !force) return
  isLoading.value = true
  await Promise.all([
    load('profile', async() => {
      Object.assign(profile, await user().getHomepage())
    }),
    load('musicGene', async() => {
      Object.assign(musicGene, await user().getMusicGene())
    }),
    load('favSongs', async() => {
      // 每页条数现读设置（`list.pageSize`）：改完设置下次进页 / 翻页生效，不必重启
      favSongs.limit = getPageSize(appSetting)
      const res = await user().getFavSong(1, favSongs.limit)
      setSongs(favSongs.list, res.list)
      favSongs.total = res.total
      favSongs.page = 1
    }),
    load('createdLists', fetchCreatedLists),
    load('favLists', async() => {
      const res = await user().getFavSonglist(1, getPageSize(appSetting))
      setList(favLists, res.list as any)
      pagers.favLists = { page: 1, hasMore: res.hasMore === true }
    }),
    load('favAlbums', async() => {
      const res = await user().getFavAlbum(1, getPageSize(appSetting))
      setList(favAlbums, res.list as any)
      pagers.favAlbums = { page: 1, hasMore: res.hasMore === true }
    }),
    load('followSingers', async() => {
      const res = await user().getFollowSingers(1, getPageSize(appSetting))
      setList(followSingers, res.list as any)
      pagers.followSingers = { page: 1, hasMore: res.hasMore === true }
    }),
  ])
  // VIP 单独拉：失败不影响其它区块
  try {
    Object.assign(vip, await user().getVipInfo())
  } catch (err) {
    console.log('[user] vip', err)
  }
  isLoading.value = false
  isInited.value = true
}

/** 我喜欢 —— 加载更多（追加）。 */
export const loadMoreFavSongs = async(): Promise<void> => {
  // in-flight 闸：连点「加载更多」会各自算 page + 1，把同一页追加两遍
  if (labels.favSongs === t('list__loading')) return
  if (favSongs.list.length >= favSongs.total) return
  labels.favSongs = t('list__loading')
  try {
    const next = favSongs.page + 1
    const res = await user().getFavSong(next, favSongs.limit)
    appendSongs(favSongs.list, res.list)
    favSongs.page = next
    favSongs.total = res.total
    labels.favSongs = ''
  } catch (err) {
    console.log('[user] more favSongs', err)
    labels.favSongs = t('list__load_failed')
  }
}

/**
 * 我喜欢 —— 拉第一页并覆盖。
 *
 * 与 `initUserCenter` 里那份的区别：那个被 `isInited` 挡着、一个会话只跑一次；
 * 这个要能**重复调用**（「我的收藏」页每次进入都自动加载一次 QQ 的我喜欢，见需求 1），
 * 以及写入云端后用来把新歌刷出来。失败只落文案（与其它账号接口同一档，§2.11）。
 */
export const loadFavSongs = async(): Promise<void> => {
  labels.favSongs = t('list__loading')
  try {
    // 与 initUserCenter 那份同款：页长现读设置，改完设置下次进「我的收藏」生效
    favSongs.limit = getPageSize(appSetting)
    const res = await user().getFavSong(1, favSongs.limit)
    setSongs(favSongs.list, res.list)
    favSongs.total = res.total
    favSongs.page = 1
    labels.favSongs = ''
  } catch (err: any) {
    console.log('[user] favSongs', err)
    labels.favSongs = err?.message === 'QQ 音乐未登录' ? t('user_center__need_login') : t('list__load_failed')
  }
}

/**
 * 写接口的成败判据：SDK 现在给 `{ ok, code, retCode, msg }`（失败时把 QQ 的错误码带出来，
 * 见 `tx/songList.js` 的 `readWriteResult`）——真机上「点了没反应」时，那两个码是唯一线索。
 * **布尔 `true` 也认**：旧契约与测试桩给的就是它，别为了收窄类型把桩打回红。
 */
export const isWriteOk = (res: any): boolean => res === true || res?.ok === true

/**
 * 写失败时给用户看的文案：既有那句人话 + QQ 的错误码（`code` / `retCode` / `msg`）。
 *
 * 只要诊断（工单 09 的要求）：收藏写不通时，弹窗里必须带上能**原样贴回来**的码——
 * 旧实现只抛一句「添加失败」，把 `code`/`retCode` 全丢了，真机上无从查起。
 */
export const writeFailText = (res: any, fallback: string): string => {
  const detail = [res?.code != null ? `code=${res.code}` : '', res?.retCode != null ? `retCode=${res.retCode}` : '', res?.msg || '']
    .filter(Boolean)
    .join(' ')
  return detail ? `${fallback}（${detail}）` : fallback
}

/**
 * 把刚写进云端的这首歌**就地补进「我收藏的歌曲」列表**（列表加载过才动它）。
 *
 * ⚠️ 为什么不是「写完再读一次来刷新列表」（2026-09-24 用户报障，真机实测）：
 * 写成功那一刻，服务端还没把这次改动反映到读接口上——就是下面 `favSongIds` 那条注释说的
 * 「这次收藏要**等下次重拉**才认」。于是那次立刻重读拿回来的**还是旧的一页**，正好把界面盖回原样：
 * 表现是「在收藏页上点心收藏，列表当场不变，切走再回来才看到」。就地改没有这个时间差。
 *
 * 信任档位与 `favSongIds` 一致：写接口 `isWriteOk` 判过成功才动本地。
 * 位置放最前（刚收藏的歌应当一眼看到）；与服务端真实次序若有出入，下次进页面重拉时校正。
 */
const insertFavSongIntoList = (musicInfo: LX.Music.MusicInfoOnline) => {
  if (favSongs.total <= 0) return // 列表还没加载过：进页面自然会重拉，不必动
  const songId = String(musicInfo?.meta?.id ?? '')
  if (!songId || favSongs.list.some(item => String(item.meta?.id) === songId)) return
  favSongs.list.unshift(musicInfo)
  favSongs.total += 1
}

/** 取消喜欢：把这一行**就地移出列表**（理由与坑同 `insertFavSongIntoList`，两者对称）。 */
const removeFavSongFromList = (musicInfo: LX.Music.MusicInfoOnline) => {
  if (favSongs.total <= 0) return
  const songId = String(musicInfo?.meta?.id ?? '')
  const index = favSongs.list.findIndex(item => String(item.meta?.id) === songId)
  if (index === -1) return
  favSongs.list.splice(index, 1)
  favSongs.total -= 1
}

/**
 * 我喜欢 —— **写入云端**（QQ 的 dirId=201 目录）。
 *
 * 与上面那批只读接口不同，写操作**失败必须抛给调用方**（由弹窗用 `dialog` 明确报错，
 * §2.11）——收藏这种用户主动发起的动作，静默失败会让人以为已经加进去了。
 *
 * @param musicInfo 新式在线歌曲对象；QQ 的 songId/songType 在 `meta.id` / `meta.songType`
 *   （见 common/utils/tools.ts 的 toNewMusicInfo）。
 */
export const addFavSongToCloud = async(musicInfo: LX.Music.MusicInfoOnline): Promise<void> => {
  const songId = Number(musicInfo?.meta?.id ?? 0)
  if (!songId) throw new Error(t('list_add__cloud_no_song_id'))
  const res = await music.tx.songList.likeSong([
    { songId, songType: Number(musicInfo.meta.songType ?? 0) },
  ])
  if (!isWriteOk(res)) throw new Error(writeFailText(res, t('list_add__cloud_failed')))
  // 收藏态集合已加载过就地补上：不补的话这次收藏要等下次重拉才认，
  // 那之前各处按钮仍显示「没收藏」（点第二次又走一遍收藏）
  if (favSongIdsLoaded.value && !favSongIds.includes(String(songId))) favSongIds.unshift(String(songId))
  insertFavSongIntoList(musicInfo)
}

/** 取消喜欢：从 QQ「我喜欢」移除。失败抛错（带 QQ 的错误码），由调用方提示。 */
export const removeFavSongFromCloud = async(musicInfo: LX.Music.MusicInfoOnline): Promise<void> => {
  const songId = Number(musicInfo?.meta?.id ?? 0)
  if (!songId) throw new Error(t('list_add__cloud_no_song_id'))
  const res = await music.tx.songList.unlikeSong([
    { songId, songType: Number(musicInfo.meta.songType ?? 0) },
  ])
  if (!isWriteOk(res)) throw new Error(writeFailText(res, t('list_unlove__failed')))
  if (favSongIdsLoaded.value) {
    const index = favSongIds.indexOf(String(songId))
    if (index > -1) favSongIds.splice(index, 1)
  }
  removeFavSongFromList(musicInfo)
}

// ── 收藏态（「这一首喜欢了没」）────────────────────────────────────────────
// 本地收藏取消后（2026-09-24），各处的收藏按钮只能问云端。读接口没有按 id 单查的形态，
// 所以照 favAlbumIds / favPlaylistIds 的做法（工单 08）拉一份全量 id 集合缓存住。

/** 拉我喜欢的全量 id 集合（已加载过直接返回，`force` 重拉）。失败抛给调用方。 */
export const loadFavSongIds = async(force = false): Promise<void> => {
  if (favSongIdsLoaded.value && !force) return
  setList(favSongIds, await user().getFavSongIds())
  favSongIdsLoaded.value = true
}

/** 这一首在 QQ「我喜欢」里吗（先 `loadFavSongIds` 才有准确答案）。 */
export const isFavSongInCloud = (musicInfo: LX.Music.MusicInfoOnline | null | undefined): boolean => {
  const id = String(musicInfo?.meta?.id ?? '')
  return !!id && favSongIds.includes(id)
}

/**
 * 这一首**能**写进 QQ「我喜欢」吗 —— 判据是「有没有 QQ 歌曲 ID」：
 * 本地文件（source=local）与其它源的歌曲都没有（`meta.id` 是各自源的 id，送给 QQ 是错的）。
 * 三个入口（行内键 / 右键菜单 / 播放栏）共用这一条：不能收藏的歌**不显示**收藏键。
 */
export const canFavSongInCloud = (musicInfo: LX.Music.MusicInfoOnline | null | undefined): boolean =>
  musicInfo?.source == 'tx' && musicInfo?.meta?.id != null

/**
 * 「我喜欢」的**一键切换**（三个入口共用，别各写一套）：已在我喜欢里 → 移除，不在 → 加入。
 *
 * 状态判据要先有全量 id 集合，所以这里先 `loadFavSongIds()`：**动作不走界面上那份文案的判据**，
 * 否则 state 还没加载完时点下去会走反方向（该移除的又收藏一遍）。未登录时它抛
 * `QQ 音乐未登录`，由调用方用 `favErrorText` 弹提示。
 *
 * @returns 切换后的状态（true = 现在在我喜欢里）
 */
export const toggleFavSongToCloud = async(musicInfo: LX.Music.MusicInfoOnline): Promise<boolean> => {
  await loadFavSongIds()
  const isFav = isFavSongInCloud(musicInfo)
  if (isFav) await removeFavSongFromCloud(musicInfo)
  else await addFavSongToCloud(musicInfo)
  return !isFav
}

/**
 * 收藏类写操作的失败文案：写接口抛的是内部串 `QQ 音乐未登录`（`requireCredential`），
 * 界面上要说人话；其它错误原样透出，兜底用 `list_add__cloud_failed`。
 * 四个入口（收藏弹窗 / 雷达 / 快捷键与托盘 / 任务栏）共用，别各写一份。
 */
export const favErrorText = (err: any): string =>
  err?.message == 'QQ 音乐未登录' ? t('user_center__need_login') : (err?.message || t('list_add__cloud_failed'))

/**
 * 三块收藏类列表（歌单 / 专辑 / 歌手）的「加载更多」——结构完全同构，共用一份实现。
 *
 * 两条约束（2026-09-26 审查）：
 *   1. **in-flight 闸**：连点「加载更多」会各自算 `page + 1`、把同一页追加两遍；
 *      用 `labels[key]` 的加载中文案当闸（它本来就是这块的加载态，失败文案不会挡住重试）；
 *   2. **失败不抛**：按钮回调是 `void loadMore*()`，抛出去就是未处理 rejection（dev 下弹浮层
 *      吞鼠标）。与 `load()` 同口径：失败只落 `list__load_failed`，已有数据保留。
 */
const loadMoreList = async(
  key: 'favLists' | 'favAlbums' | 'followSingers',
  target: any[],
  fetcher: (page: number, limit: number) => Promise<{ list?: any[], hasMore?: boolean }>,
): Promise<void> => {
  if (labels[key] === t('list__loading')) return
  if (!pagers[key].hasMore) return
  labels[key] = t('list__loading')
  try {
    const next = pagers[key].page + 1
    const res = await fetcher(next, getPageSize(appSetting))
    appendList(target, res.list ?? [])
    pagers[key] = { page: next, hasMore: res.hasMore === true }
    labels[key] = ''
  } catch (err) {
    console.log('[user] more', key, err)
    labels[key] = t('list__load_failed')
  }
}

export const loadMoreFavLists = async(): Promise<void> =>
  loadMoreList('favLists', favLists, (page, limit) => user().getFavSonglist(page, limit))

export const loadMoreFavAlbums = async(): Promise<void> =>
  loadMoreList('favAlbums', favAlbums, (page, limit) => user().getFavAlbum(page, limit))

export const loadMoreFollowSingers = async(): Promise<void> =>
  loadMoreList('followSingers', followSingers, (page, limit) => user().getFollowSingers(page, limit))

// ── 云端自建歌单的读与写（工单 06）─────────────────────────────────────────
// 读走 `songList.getListDetailByCgi`（disstid = tid、dirid = 0，dir 型歌单也能读，
// 见 `tx/songList.js` 的注释）；写走 `createList / removeList / addSongToList / removeSongFromList`。
// 写操作**失败必须抛给调用方**（用户主动发起的动作，静默失败会让人以为已经生效）。

/** 拉取并写回云端自建歌单列表（initUserCenter / refreshCreatedLists / reloadCreatedLists 共用的取数段）。 */
const fetchCreatedLists = async(): Promise<void> => {
  const res = await user().getCreatedSonglist()
  setList(createdLists, res.list as any)
}

/** 重新拉云端自建歌单列表（建/删歌单之后刷新，best-effort：失败由调用方兜住）。 */
export const refreshCreatedLists = async(): Promise<void> => {
  await fetchCreatedLists()
}

/**
 * 云端自建歌单列表的**进页重拉**（带文案，能重复调用）。
 *
 * 与 `initUserCenter` 里那份的区别：那个被 `isInited` 挡着、一个会话只跑一次；这个是给
 * 「我的歌单」云端面板每次进入用的——云端自建歌单是**多端可变**的数据（手机 / 网页上都能
 * 建、删），会话级缓存会让本应用直到重启都看不到别端的改动（2026-09-29 用户报障）。
 * 待遇与 `loadFavSongs` 同档：进页拉一次，低频、节流。失败只落文案（未登录落登录提示），
 * 不抛给调用方；落点 `labels.createdLists` 正是左栏与右栏空态读的那份，失败可见。
 */
export const reloadCreatedLists = async(): Promise<void> => {
  labels.createdLists = t('list__loading')
  try {
    await fetchCreatedLists()
    labels.createdLists = ''
  } catch (err: any) {
    console.log('[user] createdLists', err)
    labels.createdLists = err?.message === 'QQ 音乐未登录' ? t('user_center__need_login') : t('list__load_failed')
  }
}

/**
 * 读某个云端歌单的歌曲。
 * @param id 歌单的 tid（`createdLists` 里卡片的 `id` 就是它）
 * @param more true = 追加下一页
 */
export const loadCloudListSongs = async(id: string, page = 1, more = false): Promise<void> => {
  cloudListSongs.noItemLabel = more ? cloudListSongs.noItemLabel : t('list__loading')
  if (!more) cloudListSongs.listTid = id
  try {
    // 每页条数现读设置（`list.pageSize`）：改完设置下次翻页 / 重进歌单生效
    cloudListSongs.limit = getPageSize(appSetting)
    const res = await music.tx.songList.getListDetailByCgi(id, page, cloudListSongs.limit)
    // 迟到的响应丢掉：期间用户可能已经切到别的歌单
    if (cloudListSongs.listTid !== id) return
    const list = toOnlineList(res.list ?? [])
    if (more) cloudListSongs.list.push(...list)
    else cloudListSongs.list.splice(0, cloudListSongs.list.length, ...list)
    cloudListSongs.total = Number(res.total ?? cloudListSongs.list.length)
    cloudListSongs.page = page
    cloudListSongs.noItemLabel = cloudListSongs.list.length ? '' : t('no_item')
  } catch (err: any) {
    if (cloudListSongs.listTid !== id) return
    console.log('[user] cloudListSongs', err)
    if (!more) cloudListSongs.list.splice(0, cloudListSongs.list.length)
    cloudListSongs.total = more ? cloudListSongs.total : 0
    cloudListSongs.noItemLabel = err?.message === 'QQ 音乐未登录'
      ? t('user_center__need_login')
      // 空歌单不是失败：新建出来的歌单服务端会抛「歌单为空或不可读」，
      // 真机上它被显示成一句像报错的话（实测），这里落空态
      : (err?.message === '歌单为空或不可读'
          ? t('no_item')
          : (more ? t('list__load_failed') : (err?.message || t('list__load_failed'))))
  }
}

/**
 * 新建云端歌单（返回服务端给的 dirId/tid）。
 *
 * `dirPicUrl` 是**可选的自定义封面**——调用方先把图片传成 CDN 地址
 * （`music.tx.upload.uploadImage`），再在建歌单时带上。为什么必须在"建的时候"给：
 * 改已有歌单封面的端点（`EditPlaylist`）实测不可用，理由与证据见
 * `tx/songList.js` 的 `createList` 注释。
 */
export const createCloudList = async(name: string, dirPicUrl?: string): Promise<{ dirId: number, tid: number }> => {
  const res = await music.tx.songList.createList(name, dirPicUrl)
  // 建歌单已经成功：刷新列表是 best-effort（同 `reloadFavAlbums` 的写法）。
  // 刷新失败若往外抛，调用方会提示「建歌单失败」→ 用户重试 → 建出**重复歌单**。
  try {
    await refreshCreatedLists()
  } catch (err) {
    console.log('[user] refresh createdLists', err)
  }
  return res
}

/**
 * 上传歌单封面（图片直传 QQ 的 COS 桶），返回可直接用的 CDN 地址。
 *
 * 与建歌单分成两个动作：上传可能因体积/网络失败，失败要**原样抛给调用方**并保留"重选封面"
 * 的机会，而不是让整个建歌单流程静默吃掉。`createCloudList` 收这个地址当 `dirPicUrl`。
 */
export const uploadListCover = async(file: File): Promise<string> => {
  const { url } = await music.tx.upload.uploadImage(file)
  return url
}

/** 删除云端歌单（传卡片：dirId 给接口，id=tid 用于比对当前正在看的歌单）。 */
export const removeCloudList = async(card: PlaylistCard): Promise<void> => {
  const ok = await music.tx.songList.removeList(Number(card.dirId))
  if (!ok) throw new Error(t('playlists__cloud_remove_failed'))
  // 当前正在看这个歌单的话，把歌曲也清掉（避免停在已删歌单的内容上）
  if (String(card.id) === cloudListSongs.listTid) {
    cloudListSongs.listTid = ''
    cloudListSongs.list.splice(0, cloudListSongs.list.length)
    cloudListSongs.total = 0
  }
  // 删歌单已经成功：刷新列表是 best-effort（同 `createCloudList` / `reloadFavAlbums` 的写法）。
  // 刷新失败若往外抛，调用方会提示「删除失败」→ 用户重试 → 服务端说歌单不存在、
  // 列表还是刷新不出来——歌单其实早就删掉了，重试只会让人以为删除没生效（2026-09-26 审查）。
  try {
    await refreshCreatedLists()
  } catch (err) {
    console.log('[user] refresh createdLists', err)
  }
}

/** 新式歌曲对象 → 写接口要的 `{ songId, songType }`（songId 在 `meta.id`，见 tools.ts 的映射）。 */
const toWriteSongs = (list: LX.Music.MusicInfoOnline[]) => list.map(m => {
  const songId = Number(m?.meta?.id ?? 0)
  if (!songId) throw new Error(t('list_add__cloud_no_song_id'))
  return { songId, songType: Number(m.meta.songType ?? 0) }
})

/** 往云端歌单加歌（多首）。`card` 是 `createdLists` 里的卡片（dirId 写、id=tid 写）。 */
export const addSongsToCloudList = async(card: PlaylistCard, songs: LX.Music.MusicInfoOnline[]): Promise<void> => {
  const res = await music.tx.songList.addSongToList(Number(card.dirId), toWriteSongs(songs), Number(card.id))
  if (!isWriteOk(res)) throw new Error(writeFailText(res, t('playlists__cloud_add_failed')))
  // 正在看这个歌单就刷新一下，让新歌立刻出现
  if (String(card.id) === cloudListSongs.listTid) await loadCloudListSongs(String(card.id), 1, false)
}

/** 从云端歌单删歌（多首）。 */
export const removeSongsFromCloudList = async(card: PlaylistCard, songs: LX.Music.MusicInfoOnline[]): Promise<void> => {
  const res = await music.tx.songList.removeSongFromList(Number(card.dirId), toWriteSongs(songs), Number(card.id))
  if (!isWriteOk(res)) throw new Error(writeFailText(res, t('playlists__cloud_remove_song_failed')))
  if (String(card.id) === cloudListSongs.listTid) await loadCloudListSongs(String(card.id), 1, false)
}

// ── 收藏 / 取消收藏（专辑 · 歌单，工单 08）─────────────────────────────────
// 两个读接口没有单条查询，所以「收了没」靠**收藏全量 id 集合**在本地比对（拉一次缓存住）。
// 写操作**失败必须抛给调用方**：收藏是用户主动动作，静默失败会让人以为已经生效。

/** 收藏的全量专辑 mid（`force` 时重拉）。 */
export const loadFavAlbumIds = async(force = false): Promise<void> => {
  if (favAlbumIds.length && !force) return
  const ids = await user().getFavAlbumIds()
  setList(favAlbumIds, ids)
}

/** 收藏的全量歌单 tid。 */
export const loadFavSonglistIds = async(force = false): Promise<void> => {
  if (favPlaylistIds.length && !force) return
  const ids = await user().getFavSonglistIds()
  setList(favPlaylistIds, ids)
}

/**
 * 收藏 / 取消收藏专辑。
 * @param album 专辑页拿到的详情（要 `id` 数字 id 与 `mid`）
 */
export const setAlbumFav = async(album: { id: string, mid: string }, fav: boolean): Promise<void> => {
  const ok = await music.tx.album.setFavAlbum(album.id, fav)
  if (!ok) throw new Error(fav ? t('fav__add_failed') : t('fav__cancel_failed'))
  // 本地集合与列表都跟着改，按钮状态立刻正确（`user_center` 的收藏专辑列表若已加载也一并刷新）
  const ids = favAlbumIds.slice()
  const index = ids.indexOf(album.mid)
  if (fav && index < 0) ids.unshift(album.mid)
  if (!fav && index > -1) ids.splice(index, 1)
  setList(favAlbumIds, ids)
  if (favAlbums.length) void reloadFavAlbums()
}

/** 收藏 / 取消收藏歌单（入参是歌单的 tid）。 */
export const setPlaylistFav = async(tid: string, fav: boolean): Promise<void> => {
  const ok = await music.tx.songList.setFavPlaylist(tid, fav)
  if (!ok) throw new Error(fav ? t('fav__add_failed') : t('fav__cancel_failed'))
  const ids = favPlaylistIds.slice()
  const index = ids.indexOf(String(tid))
  if (fav && index < 0) ids.unshift(String(tid))
  if (!fav && index > -1) ids.splice(index, 1)
  setList(favPlaylistIds, ids)
  if (favLists.length) void reloadFavLists()
}

// ── 「不喜欢」的云端写入（票 05，best-effort）──────────────────────────────
// 与上面那批收藏写的口径**故意不同**：这条失败不抛。它挂在「屏蔽播放」动作的尾巴上，
// 本地规则已经生效、播放该拦的照拦——这时再弹一个窗只会让「不喜欢」变成两步操作
// （票面口径：不阻塞、不弹窗，只留日志）。这条待办性可见的代价是：云端写失败要翻日志。

/**
 * 把一首**在线歌**顺带写进 QQ 云端「不喜欢」。
 *
 * 本地歌（`source` 不是 `tx`：下载/导入进来的文件、队列里的本地条目）与没有数字
 * songId 的对象直接跳过返回——向 QQ 送本地条目的 id 是错的。
 * 失败只 `console.log`（带 QQ 的码），绝不抛。
 */
export const addDislikedSongToCloud = async(musicInfo: LX.Music.MusicInfo): Promise<void> => {
  if (musicInfo?.source != 'tx') return
  const songId = Number(musicInfo.meta?.id ?? 0)
  if (!songId) return
  try {
    await music.tx.dislike.addDislikedSongs([songId])
  } catch (err: any) {
    // 未登录是常见态（本地规则照常拦播放，云端这条本来就无处可写），不打日志；
    // 其余失败留一行诊断（带 QQ 的码，不弹窗）。
    if (err?.message != 'QQ 音乐未登录') console.log('[user] 云端不喜欢写入失败（本地播放屏蔽已生效，不阻塞）', err?.message ?? err)
  }
}

/** 重新拉收藏专辑列表第一页（写操作后让「我的收藏」页跟着变）。 */
const reloadFavAlbums = async(): Promise<void> => {
  try {
    const res = await user().getFavAlbum(1, getPageSize(appSetting))
    setList(favAlbums, res.list as any)
    pagers.favAlbums = { page: 1, hasMore: res.hasMore === true }
  } catch (err) {
    console.log('[user] reload favAlbums', err)
  }
}

/** 重新拉收藏歌单列表第一页。 */
const reloadFavLists = async(): Promise<void> => {
  try {
    const res = await user().getFavSonglist(1, getPageSize(appSetting))
    setList(favLists, res.list as any)
    pagers.favLists = { page: 1, hasMore: res.hasMore === true }
  } catch (err) {
    console.log('[user] reload favLists', err)
  }
}
