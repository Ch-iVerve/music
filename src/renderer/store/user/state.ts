import { reactive, ref, shallowReactive } from '@common/utils/vueTools'
import { getPageSize } from '@common/settings/pageSize'
import { appSetting } from '@renderer/store/setting'

/**
 * 账号中心（我的音乐，M4）的渲染侧状态。
 *
 * 结构照仓库惯例：`state.ts` 只放状态与接口，取数在 `action.ts`。
 * 列表用 `shallowReactive` 防深度代理（§2.10 的响应式纪律），歌曲列表另有
 * `markRawList` 处理。
 */

export interface UserProfile {
  name: string
  avatar: string
  bigAvatar: string
  isSinger: boolean
  fans: number
  follow: number
  friends: number
  visitor: number
}

export interface VipInfo {
  canRenew: boolean
  hires: boolean
  dolby: boolean
  maxSongNum: number
  maxDirNum: number
}

/** 歌单/专辑卡片（对齐 store/songList 的 ListInfoItem，便于复用卡片组件）。 */
export interface PlaylistCard {
  id: string
  /** QQ 歌单目录 id（「我喜欢」= 201）；收藏歌单没有这个字段。 */
  dirId?: string
  /** 专辑的**数字 albumId**（只有收藏专辑有；`id` 是 mid，取消收藏写接口要数字 id）。 */
  albumId?: string
  name: string
  img: string
  author: string
  total?: string
  time?: string
  desc: string | null
  source: LX.OnlineSource
}

export interface FollowSinger {
  id: string
  name: string
  img: string
  desc: string
  fans: number
  source: LX.OnlineSource
}

/**
 * 基因条目（偏好歌手 / 偏好曲风）。
 *
 * ⚠️ **歌手的 `id` 是数字 singer_id，不是 mid**（`Base.Id`，实测），所以点它跳歌手页
 * 必须再转一次（`music.tx.user.resolveSingerMid`，路径见 `views/userCenter/useGeneSingerJump.ts`）。
 */
export interface GeneItem {
  id: string
  name: string
  img: string
  slogan: string
}

/** 「名字 + 说明」型富条目（音乐年龄 / 律动 / 时间偏好 …）。 */
export interface GeneTextItem {
  name: string
  desc: string
}

/** 乐状态某一维：`key` 是接口给的维度标识（渲染层拿它查维度文案）。 */
export interface GeneStatusItem {
  key: string
  name: string
  score: number
  delta: number
}

/** BPM 区间（`BPM.MaxScore/MinScore`）。 */
export interface GeneBpm {
  max: number
  min: number
}

/** 近 6 个月的每月听歌数（`ListeningReport.Report[].Month/Num`）。 */
export interface GeneReportItem {
  month: string
  num: number
}

/** AI 解读卡片（`DeepseekInterpretation.Cards[].Title/Content`）。 */
export interface GeneAiCard {
  title: string
  content: string
}

/** 代表色：`color` 只在能直接当 CSS 色值时才有（数字色值这种落空）。 */
export interface GeneColor {
  name: string
  color: string
}

/**
 * 听歌基因（`GetProfileReport` 的归一化形状，整形在 `musicSdk/tx/utils/gene.js`）。
 * 富内容一律可空（接口某天不给 / 形状变了就落空），视图按空值整块不渲染。
 */
export interface MusicGeneState {
  nick: string
  avatar: string
  mainDescription: string
  singers: GeneItem[]
  genres: GeneItem[]
  personality: GeneTextItem | null
  personalityTags: string[]
  status: GeneStatusItem[]
  ages: GeneTextItem[]
  bpm: GeneBpm | null
  grooving: GeneTextItem | null
  timePreference: GeneTextItem | null
  characterColor: GeneColor | null
  report: GeneReportItem[]
  aiCards: GeneAiCard[]
  aiTags: string[]
}

export const profile = reactive<UserProfile>({
  name: '',
  avatar: '',
  bigAvatar: '',
  isSinger: false,
  fans: 0,
  follow: 0,
  friends: 0,
  visitor: 0,
})

export const vip = reactive<VipInfo>({
  canRenew: false,
  hires: false,
  dolby: false,
  maxSongNum: 0,
  maxDirNum: 0,
})

/**
 * 听歌基因（工单 10 起「我的音乐」页只做这一块）。
 *
 * 初值必须**把每个键都写出来**：`initUserCenter` 是 `Object.assign(musicGene, 取数结果)`
 * 覆盖式写入，键缺失的字段会保留上一份数据（刷新后显示旧值）。
 */
export const musicGene = reactive<MusicGeneState>({
  nick: '',
  avatar: '',
  mainDescription: '',
  singers: [],
  genres: [],
  personality: null,
  personalityTags: [],
  status: [],
  ages: [],
  bpm: null,
  grooving: null,
  timePreference: null,
  characterColor: null,
  report: [],
  aiCards: [],
  aiTags: [],
})

/**
 * 我喜欢：分页拉取（QQ 的 dirid=201 目录）。
 *
 * ⚠️ 这个接口按 `song_begin = num * (page - 1)` 取（`tx/user.js` 的 `getFavSong`）：页长设得比
 * 50 大时，万一服务端按更小的页长截断，翻页会**跳过中间没拿到的歌**（同一 caveat 见
 * `tx/user.js` 的 `getFavSongIds` 注释，那里的全量拉取因此固定用 50）。实测 50 正常；
 * 用户反馈「我喜欢漏歌」时先看「设置 → 我的音乐 → 列表分页条数」是不是调大了。
 */
export const favSongs = reactive<{
  list: LX.Music.MusicInfoOnline[]
  total: number
  page: number
  limit: number
  noItemLabel: string
}>({
  list: [],
  total: 0,
  page: 1,
  // 首帧占位；真正每页拉多少条在取数时现读设置 `list.pageSize`（见 action.ts）
  limit: getPageSize(appSetting),
  noItemLabel: '',
})

export const createdLists = shallowReactive<PlaylistCard[]>([])
export const favLists = shallowReactive<PlaylistCard[]>([])
export const favAlbums = shallowReactive<PlaylistCard[]>([])
export const followSingers = shallowReactive<FollowSinger[]>([])

/**
 * 「收藏 / 取消收藏」要用的**收藏全量 id 集合**（工单 08）。
 *
 * 两个读接口都没有「按 id 查是否收藏」的形态（见 `tx/user.js` 的 getFavAlbumIds 注释），
 * 只能把整份收藏拉回来在本地比对；拉一次缓存住，写操作后再刷一次。
 * album 存 mid（专辑页手里的是 mid），playlist 存 tid。
 */
export const favAlbumIds = shallowReactive<string[]>([])
export const favPlaylistIds = shallowReactive<string[]>([])

/**
 * 「我喜欢」的全量**歌曲 id 集合**（QQ 数字 songId 的字符串形态）——给「这一首喜欢了没」用。
 *
 * 同一套路（工单 08）：`getFavSong` 没有按 id 单查的形态，只能拉全量在本地比对。
 * `favSongs` 那份是**分页展示用**的（页长见 `list.pageSize`），不能拿它当收藏态判据。
 * 加载成功才置 `favSongIdsLoaded`（未登录拉不动，下次用到还要再试）。
 */
export const favSongIds = shallowReactive<string[]>([])
export const favSongIdsLoaded = ref(false)

/**
 * 「我的歌单」页里选中的**云端自建歌单**的歌曲（工单 06）。
 * 与 `favSongs`（我喜欢，dirId=201）分开存：两者来源不同、翻页参数也不同。
 */
export const cloudListSongs = reactive<{
  list: LX.Music.MusicInfoOnline[]
  total: number
  page: number
  limit: number
  noItemLabel: string
  /**
   * 当前这份数据属于哪个歌单——存的是**歌单 tid**（`PlaylistCard.id`），不是 dirId。
   * ⚠️ 读歌走 tid（`CgiGetDiss` 的 `disstid`）、写歌走 dirId，两者不能混（本轮踩过：
   * 写完后拿 dirId 去比 tid，判定为「不是当前歌单」→ 不刷新、不清理）。
   */
  listTid: string
}>({
  list: [],
  total: 0,
  page: 1,
  // 首帧占位；真正每页拉多少条在取数时现读设置 `list.pageSize`（见 action.ts）
  limit: getPageSize(appSetting),
  noItemLabel: '',
  listTid: '',
})

/** 各区块的加载/失败文案（§2.11 的三段式：loading → 数据 → 失败文案）。 */
export const labels = reactive<Record<'profile' | 'musicGene' | 'favSongs' | 'createdLists' | 'favLists' | 'favAlbums' | 'followSingers', string>>({
  profile: '',
  musicGene: '',
  favSongs: '',
  createdLists: '',
  favLists: '',
  favAlbums: '',
  followSingers: '',
})

export const isInited = ref(false)
export const isLoading = ref(false)

/** 分页游标（收藏歌单 161 条、收藏专辑 445 条这种量级，要能"加载更多"）。 */
export const pagers = reactive({
  favLists: { page: 1, hasMore: false },
  favAlbums: { page: 1, hasMore: false },
  followSingers: { page: 1, hasMore: false },
})
