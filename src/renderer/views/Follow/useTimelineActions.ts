import { computed, reactive, ref } from '@common/utils/vueTools'
import { useRouter } from '@common/utils/vueRouter'
import { useI18n } from '@renderer/plugins/i18n'
import { assertApiSupport } from '@renderer/store/utils'
import usePlay from '@renderer/components/material/OnlineList/usePlay'
import useMenu from '@renderer/components/material/OnlineList/useMenu'
import useMusicActions from '@renderer/components/material/OnlineList/useMusicActions'
import useMusicAdd from '@renderer/components/material/OnlineList/useMusicAdd'
import useMusicDownload from '@renderer/components/material/OnlineList/useMusicDownload'
import useMusicJump from '@renderer/utils/compositions/useMusicJump'
import { FOLLOW_FEED_ALBUM_ID_PREFIX, FOLLOW_FEED_QUEUE_ID } from '@renderer/utils/queueIds'

/**
 * 时间线行上的交互（关注动态）：点歌行播放、点歌手名 / 专辑名跳转、行右键菜单。
 *
 * **一份都不新造**，全部接在既有那套上（写这一份的目的只是「把在线歌曲表的那条链装到一块
 * 只有两种行的列表上」，不是重写一套播放 / 菜单）：
 * - 播放：`material/OnlineList/usePlay`（「点行即播 + 队列身份」的正典）；队列 = **本页时间线里
 *   全部歌曲行**（按当前顺序），身份 `follow_feed__timeline`（自造稳定标识，同 `fav__songs`
 *   / `radar__recommend` 的做法——本页没有真实列表 id；字面量的家已收到
 *   `@renderer/utils/queueIds`，票 06 M3）。
 * - 菜单：`material/OnlineList/useMenu`（在线歌曲行的整套菜单：播放 / 下载 / 稍后播放 / 搜索 /
 *   我喜欢 / 添加到… / 跳转专辑 / 跳转歌手 / 复制链接 / 在 QQ 音乐打开 / 歌曲详情 / 不喜欢）。
 *   这几个 **deep import** 没有别的入口：仓库里它们就是「在线歌曲行的这一套」，
 *   抄一份进本页才是真的会漂。
 * - 跳转：`utils/compositions/useMusicJump`（点名字跳歌手 / 专辑、复制专辑链接、在 QQ 音乐打开）。
 *
 * 三条刻意的偏离（都有理由，见各自注释）：
 *   1. **点名字跳转不请求接口**：条目里就带着 `singerMid` / `albumMid`，在线列表那条
 *      `resolveSingers`（请求歌曲详情拿 multi-singer）在这里没有意义——本页每行只属于一位关注
 *      的歌手；
 *   2. **播放载荷来自 `item.music`**（新式歌曲对象的 JSON），不重新查接口；
 *   3. **专辑行点行 = 展开/收起**（2026-09-28 用户拍板：不出动态页就能听专辑）——展开区里
 *      每首歌单独播，队列 = 专辑内那批歌（载荷也在 `item.music`，是数组）；旧的专辑行
 *      （载荷缺失）退回「点专辑名进专辑页」。
 */

interface TimelineActionsProps {
  items: LX.FollowFeed.Item[]
}

/** 歌曲行 → 播放入参：载荷与「是哪一条」一起存，数组下标即队列下标 */
interface SongEntry {
  item: LX.FollowFeed.Item
  music: LX.Music.MusicInfoOnline
}

const noop = () => {}

export const useTimelineActions = (props: TimelineActionsProps) => {
  const router = useRouter()
  const t = useI18n()

  /**
   * 可播的歌（按时间线顺序）——它同时是**播放队列**与「行 → 队列下标」的映射表。
   * 载荷是 `JSON.parse(item.music)`（`core/followFeed/diff.ts` 里存的 `toNewMusicInfo` 输出）；
   * 解析失败就当这一行不可播，不让一条脏数据把整页打崩（正常不会发生：只有歌曲行带载荷）。
   */
  const songEntries = computed<SongEntry[]>(() => {
    const entries: SongEntry[] = []
    for (const item of props.items) {
      if (item.kind !== 'song' || !item.music) continue
      try {
        entries.push({ item, music: JSON.parse(item.music) })
      } catch (err) {
        console.log('[followFeed] bad music payload', item.id, err)
      }
    }
    return entries
  })

  /** 这一行在播放队列里的下标；`-1` = 不可播（专辑行 / 载荷缺失） */
  const songIndexOf = (item: LX.FollowFeed.Item): number =>
    songEntries.value.findIndex(entry => entry.item.id === item.id)

  // 时间线没有多选，但这几个组合式函数的签名都要它（空数组 = 走单条分支）
  const selectedList = ref<LX.Music.MusicInfoOnline[]>([])

  /**
   * 交给那几个组合式函数的 props：`list` 用 getter 读**实时值**。
   * 它们的实现都是 `props.list[index]`，传一次快照（`{ list: songEntries.value.map(...) }`）会在
   * 条目更新后拿到旧数组——getter 让「点的时候取当前值」，也省掉一份要跟着同步的状态。
   */
  const playProps: { list: LX.Music.MusicInfoOnline[], listId: string } = {
    get list() {
      return songEntries.value.map(entry => entry.music)
    },
    listId: FOLLOW_FEED_QUEUE_ID,
  }

  // ── 播放（`usePlay` 那条链：点行即播 + 队列身份 + 失效曲拦截）──────────────────
  const { handlePlayMusic, handlePlayMusicLater } = usePlay({
    selectedList,
    props: playProps,
    removeAllSelect: noop,
    emit: noop,
  })

  // ── 专辑展开（点专辑行 = 展开/收起；展开区点歌即播）────────────────────────────

  /**
   * 当前展开的专辑行；`null` = 全部收起。同时只允许展开一张（再点另一张就切过去），
   * 多张同时展开会让「页面有多长」变得难预期。
   */
  const expandedAlbumId = ref<number | null>(null)

  /**
   * 专辑行 `music` 里存的**本簇歌曲数组**（`diff.ts` 写入的 `toNewMusicInfo` 输出数组）。
   * 旧数据（专辑行 `music == null`）解析不出东西 → 返回空数组，展开钮不渲染，
   * 点专辑名进专辑页的旧路还在。解析失败同样当空处理，不让脏数据打崩页面。
   */
  const albumSongsOf = (item: LX.FollowFeed.Item): LX.Music.MusicInfoOnline[] => {
    if (item.kind !== 'album' || !item.music) return []
    try {
      const parsed: unknown = JSON.parse(item.music)
      return Array.isArray(parsed) ? parsed as LX.Music.MusicInfoOnline[] : []
    } catch (err) {
      console.log('[followFeed] bad album payload', item.id, err)
      return []
    }
  }

  const isAlbumExpanded = (item: LX.FollowFeed.Item): boolean => expandedAlbumId.value === item.id

  const toggleAlbum = (item: LX.FollowFeed.Item) => {
    expandedAlbumId.value = isAlbumExpanded(item) ? null : item.id
  }

  /**
   * 展开区的播放队列：**当前展开专辑**的那批歌。`usePlay` 的 `queueId` 每次点击时读
   * `props.listId`（getter 传入），所以切到另一张专辑时队列身份跟着换。
   */
  const albumPlayProps = {
    get list() {
      const album = props.items.find(item => item.id === expandedAlbumId.value)
      return album ? albumSongsOf(album) : []
    },
    get listId() {
      return `${FOLLOW_FEED_ALBUM_ID_PREFIX}${expandedAlbumId.value ?? 'none'}`
    },
  }
  const { handlePlayMusic: handleAlbumSongPlay } = usePlay({
    selectedList,
    props: albumPlayProps,
    removeAllSelect: noop,
    emit: noop,
  })

  /** 展开区里点一首歌 = 从这首开始播，队列 = 这张专辑展开区里的全部歌 */
  const handleAlbumSongClick = (item: LX.FollowFeed.Item, songIndex: number) => {
    if (expandedAlbumId.value !== item.id) return
    void handleAlbumSongPlay(songIndex, true)
  }

  const { jumpToSingerList, copyAlbumLink, openAlbumInQqMusic } = useMusicJump()

  /**
   * 点歌手名（行上）与菜单里的「跳转至歌手页面」共用：**条目里就有 mid**，不请求接口。
   * 走 `useMusicJump` 的入口（一位歌手 = 直接进页面），不自己拼 `router.push`。
   */
  const jumpToSinger = (item: LX.FollowFeed.Item, event?: MouseEvent) => {
    if (!item.singerMid) return
    jumpToSingerList([{ mid: item.singerMid, name: item.singerName }], event)
  }

  /**
   * 点专辑名（专辑行）/ 菜单里的「跳转至专辑页面」。
   * `useMusicJump` 的 `jumpToAlbum` 要一个歌曲对象（它从 `meta.albumMid` 取 mid），专辑行没有——
   * 所以这里直接把条目上的 `albumMid` 交给路由，写法与 `useMusicJump.ts:22` 的 `toAlbum` 一致。
   */
  const jumpToAlbumRow = (item: LX.FollowFeed.Item) => {
    if (!item.albumMid) return
    void router.push({ path: '/album', query: { mid: item.albumMid } })
  }

  /**
   * 点行：歌曲行 = 从这首开始播（队列 = 本页全部歌曲行）；专辑行 = **展开/收起**
   * （2026-09-28 用户拍板：不出动态页听专辑——展开区里每首歌单独播，见 `handleAlbumSongClick`）。
   * 专辑行没带载荷的旧数据无歌可展，点了不动作（专辑名进专辑页的旧路仍在）。
   */
  const handleRowClick = (item: LX.FollowFeed.Item) => {
    if (item.kind === 'album') {
      if (albumSongsOf(item).length) toggleAlbum(item)
      return
    }
    const index = songIndexOf(item)
    // 载荷坏掉的行：不播，也不报错（行上没有可播的东西）
    if (index < 0) return
    void handlePlayMusic(index, true)
  }

  // ── 菜单（歌曲行用在线列表那套；专辑行只有三项）────────────────────────────────
  const { isShowListAdd, selectedAddMusicInfo, handleShowMusicAddModal } = useMusicAdd({ selectedList, props: playProps })
  const { isShowDownload, selectedDownloadMusicInfo, handleShowDownloadModal } = useMusicDownload({ selectedList, props: playProps })

  const {
    handleSearch,
    handleOpenMusicDetail,
    handleDislikeMusic,
    handleJumpAlbum,
    handleCopyLink,
    handleOpenInQqMusic,
  } = useMusicActions({ props: playProps })

  /** 当前右键的那一行在队列里的下标（`useMenu.showMenu` 不记 index，得宿主自己记——同 OnlineList） */
  const rightClickSongIndex = ref(-1)
  const rightClickAlbum = ref<LX.FollowFeed.Item | null>(null)
  const albumMenuLocation = reactive({ x: 0, y: 0 })
  const isShowAlbumMenu = ref(false)

  const {
    menus,
    menuLocation,
    isShowItemMenu,
    showMenu,
    menuClick,
  } = useMenu({
    props: playProps,
    assertApiSupport,
    emit: noop,

    handleShowDownloadModal,
    handlePlayMusic,
    // 与 OnlineList 同款：`useMenu` 只传 index，`single` 走 `usePlay` 的默认（本页没有多选）
    handlePlayMusicLater,
    handleSearch,

    handleShowMusicAddModal,
    handleOpenMusicDetail,
    handleDislikeMusic,

    handleJumpAlbum,
    // 菜单里的「跳转至歌手页面」同样用条目自带的 mid 直跳（见文件头第 1 条）
    handleJumpSinger: (index: number) => {
      const entry = songEntries.value[index]
      if (entry) jumpToSinger(entry.item)
    },
    handleCopyLink,
    handleOpenInQqMusic,
  })

  // 专辑行的菜单只有三项：打开专辑 + 复制专辑链接 + 在 QQ 音乐打开（后两条是 `useMusicJump` 现成的）
  const albumMenus = computed(() => [
    { name: t('list__jump_album'), action: 'open' },
    { name: t('album__copy_link'), action: 'copy' },
    { name: t('list__open_in_qq'), action: 'openInQq' },
  ])

  /**
   * 行右键：歌曲行 → 在线歌曲表那套菜单；专辑行 → 上面三项。
   * 两个菜单互斥（右键另一行时先把另一个关掉，免得两个同时挂着）。
   */
  const showRowMenu = (event: MouseEvent, item: LX.FollowFeed.Item) => {
    if (item.kind === 'album') {
      isShowItemMenu.value = false
      rightClickAlbum.value = item
      albumMenuLocation.x = event.pageX
      albumMenuLocation.y = event.pageY
      isShowAlbumMenu.value = true
      return
    }
    const index = songIndexOf(item)
    if (index < 0) return
    isShowAlbumMenu.value = false
    rightClickSongIndex.value = index
    showMenu(event, playProps.list[index])
  }

  const handleSongMenuClick = (action: { action?: string } | null) => {
    const index = rightClickSongIndex.value
    rightClickSongIndex.value = -1
    // 第三参是行菜单的位置：多位歌手的「选择歌手」菜单要出现在同一个位置（同 OnlineList）
    menuClick(action, index, menuLocation)
  }

  const handleAlbumMenuClick = (menu: { action?: string } | null) => {
    const item = rightClickAlbum.value
    isShowAlbumMenu.value = false
    if (!menu?.action || !item) return
    switch (menu.action) {
      case 'open':
        jumpToAlbumRow(item)
        break
      case 'copy':
        if (item.albumMid) copyAlbumLink(item.albumMid)
        break
      case 'openInQq':
        if (item.albumMid) openAlbumInQqMusic(item.albumMid)
        break
    }
  }

  return {
    // 播放
    handleRowClick,
    // 专辑展开（点专辑行 = 展开/收起；展开区点歌即播）
    isAlbumExpanded,
    toggleAlbum,
    albumSongsOf,
    handleAlbumSongClick,
    // 跳转
    jumpToSinger,
    jumpToAlbumRow,
    // 歌曲行菜单（在线列表那套）
    menus,
    menuLocation,
    isShowItemMenu,
    showRowMenu,
    handleSongMenuClick,
    // 专辑行菜单
    albumMenus,
    albumMenuLocation,
    isShowAlbumMenu,
    handleAlbumMenuClick,
    // 菜单里「添加到…」「下载」用的单条弹窗
    isShowListAdd,
    selectedAddMusicInfo,
    isShowDownload,
    selectedDownloadMusicInfo,
  }
}
