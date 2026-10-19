import { markRawList, reactive, ref } from '@common/utils/vueTools'
import { getPageSize } from '@common/settings/pageSize'
import { deduplicationList, toNewMusicInfo } from '@renderer/utils'
import music from '@renderer/utils/musicSdk'
import { appSetting } from '@renderer/store/setting'

/**
 * 专辑页（M5）取数：详情 + **整张专辑的全部歌曲**（2026-10-19 起不再分页：用户要求
 * 歌曲全部铺在页面里、不要内部滚动）。
 *
 * 三个注意点：
 *   1. 🔴 **歌曲必须过 `toNewMusicInfo`**：数据层给的是老式平铺对象，UI 侧要新式 meta 模型
 *      （AGENTS §2.10）。`material-online-list` 会读 `item.meta._qualitys`，漏转换是渲染期报错。
 *   2. **歌曲列表原地改（splice）不换数组**：`usePlay` 把 `props.list` 的数组引用存下来了
 *      （`components/material/OnlineList/usePlay.ts:22`），换新数组会让双击播放拿到旧数组。
 *   3. **详情与歌曲各自兜自己的失败**：两者都失败通常是「专辑不存在」（同一张专辑的详情与
 *      歌曲列表都查不到），但只挂一个时不该把另一个也藏起来。
 */

const t = (key: string) => window.i18n.t(key as any)

export interface AlbumDetail {
  id: string
  mid: string
  name: string
  transName: string
  img: string
  singer: string
  singers: Array<{ id: string, mid: string, name: string, img: string }>
  publishDate: string
  language: string
  albumType: string
  genre: string
  desc: string
  company: string
}

const emptyDetail = (): AlbumDetail => ({
  id: '',
  mid: '',
  name: '',
  transName: '',
  img: '',
  singer: '',
  singers: [],
  publishDate: '',
  language: '',
  albumType: '',
  genre: '',
  desc: '',
  company: '',
})

const detail = reactive<AlbumDetail>(emptyDetail())

const songs = reactive<{
  list: LX.Music.MusicInfoOnline[]
  total: number
  page: number
  limit: number
  noItemLabel: string
}>({
  list: [],
  total: 0,
  page: 1,
  // 首帧占位；真正每页拉多少条在取数时现读设置 `list.pageSize`（见 loadSongs，改完下次进页生效）
  limit: getPageSize(appSetting),
  noItemLabel: '',
})

/** 头部区块的文案（加载中/失败/不存在）；有值时页面不渲染歌曲列表，避免同一句话显示两遍。 */
const headerLabel = ref('')

// 请求键：等详情与歌曲回来后再对一次，防止快速切专辑时旧结果覆盖新结果
let detailKey = ''
let songKey = ''

/**
 * 失败文案。数据层不导出错误码，只能认 message（与 M4 的 `store/user/action.ts` 同一套判据）；
 * 文案本身来自数据层文件头，改动数据层时这里要一起看。
 */
const errorLabel = (err: any) => {
  if (err?.message === 'QQ 音乐未登录') return t('user_center__need_login')
  if (err?.message === '专辑不存在或已下架') return t('album__not_found')
  return t('list__load_failed')
}

/** 老式平铺对象 → 新式模型 + 去重 + markRaw（列表不进深度代理，§2.10）。 */
const toOnlineSongs = (list: any[]): LX.Music.MusicInfoOnline[] => {
  const next = deduplicationList(list.map(item => toNewMusicInfo(item)) as LX.Music.MusicInfoOnline[])
  return markRawList(next)
}

const clearSongs = () => {
  songs.list.splice(0, songs.list.length)
  songs.total = 0
  songs.page = 1
  songs.limit = getPageSize(appSetting)
}

const loadDetail = async(id: string) => {
  const key = `album__${id}`
  detailKey = key
  headerLabel.value = t('list__loading')
  try {
    const res = await music.tx.album.getAlbumDetail(id)
    if (detailKey !== key) return
    Object.assign(detail, emptyDetail(), res ?? {})
    headerLabel.value = ''
  } catch (err: any) {
    if (detailKey !== key) return
    console.log('[album] detail', err)
    Object.assign(detail, emptyDetail())
    headerLabel.value = errorLabel(err)
  }
}

/** 一页拉多少条（内部翻页用，不是界面分页）：接口按 num 返回，取 100 减少往返次数。 */
const FETCH_PAGE_SIZE = 100

/**
 * 拉**整张专辑**的歌曲（2026-10-19 用户要求：专辑歌曲不分页、全部铺在页面里）。
 *
 * 接口只按 `begin/num` 分页返回，所以这里按 100 条一页循环到 `totalNum` 为止；
 * 单次失败不清空已拿到的部分——直接抛给外层报错（与原来单页失败的处理一致）。
 */
const fetchAllSongs = async(id: string) => {
  let list: any[] = []
  let total = 0
  for (let page = 1; page <= 50; page++) {
    const res = await music.tx.album.getAlbumSongs(id, page, FETCH_PAGE_SIZE)
    const chunk = res?.list ?? []
    total = Number(res?.total ?? chunk.length)
    list = list.concat(chunk)
    // 拿够了、或这一页没数据（接口提前到底）就停——后者防 total 虚高时死循环
    if (list.length >= total || chunk.length === 0) break
  }
  return { list, total: total || list.length }
}

const loadSongs = async(id: string) => {
  const key = `album_songs__${id}`
  songKey = key
  songs.noItemLabel = t('list__loading')
  try {
    const res = await fetchAllSongs(id)
    if (songKey !== key) return
    const list = toOnlineSongs(res.list)
    songs.list.splice(0, songs.list.length, ...list)
    songs.total = res.total
    songs.page = 1
    songs.limit = list.length || res.total
    songs.noItemLabel = list.length ? '' : t('no_item')
  } catch (err: any) {
    if (songKey !== key) return
    console.log('[album] songs', err)
    clearSongs()
    songs.noItemLabel = errorLabel(err)
  }
}

/** 进入/切换专辑：详情与整张专辑歌曲并发（各自 try/catch，失败不影响对方）。 */
const initAlbum = async(value: unknown) => {
  const id = String(value ?? '').trim()
  if (!id) {
    // 路由没带 mid：不发请求，直接给「不存在」文案（数据层对空 id 会抛"缺少专辑 id"）
    Object.assign(detail, emptyDetail())
    clearSongs()
    headerLabel.value = t('album__not_found')
    songs.noItemLabel = t('album__not_found')
    return
  }
  await Promise.all([loadDetail(id), loadSongs(id)])
}

/** `getPageSize` 现在只被 clearSongs 用（保留设置口径；本项目已不分页）。 */

export default () => {
  return {
    detail,
    songs,
    headerLabel,
    initAlbum,
  }
}
