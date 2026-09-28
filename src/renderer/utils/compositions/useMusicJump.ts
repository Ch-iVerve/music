import { ref, shallowReactive } from '@common/utils/vueTools'
import { useRouter } from '@common/utils/vueRouter'
import { clipboardWriteText, openUrl } from '@common/utils/electron'
import { toOldMusicInfo } from '@common/utils/tools'
import { setShowPlayerDetail } from '@renderer/store/player/action'
import { canJumpToAlbum, canJumpToSinger, canShareMusic, getAlbumMid, getSongMid, resolveSingers, type JumpSinger } from '@common/utils/musicLink'
import music from '@renderer/utils/musicSdk'
import { dialog } from '@renderer/plugins/Dialog'
import { useI18n } from '@renderer/plugins/i18n'

/**
 * 「歌曲跳转 / 分享」的共用行为（ui-polish 工单 02）：在线歌曲表与本地列表歌曲表共用这一份，
 * 免得两处各写一套判定与跳转。纯判定与歌手解析在 `@common/utils/musicLink`（那里有单测）。
 *
 * 用到的既有能力，别另找：
 * - 链接：歌曲用 `tx.getMusicDetailPageUrl`（原有），专辑用 `tx.getAlbumDetailPageUrl`（本票新补）
 * - 外链：`@common/utils/electron` 的 `openUrl`（与「我的歌单」页的「歌单详情页」同一套）
 * - 多位歌手让用户挑：仓库既有的 `base-menu`，不自造弹窗
 * - 「歌曲详情」进**本仓**的 `/songDetail`（`toSongDetail`，工单 03）：三个列表共用，不再开 QQ 网页
 */
export default () => {
  const router = useRouter()
  const t = useI18n()

  // 播放详情页是盖在路由之上的全屏覆盖层（z-index 10）：不先收起来，push 只是把页面换在
  // 底下，用户看到的是「歌手页/专辑页被播放页盖住」（2026-09-28 报）。收在这三处原语里而不是
  // 各调用方：它们是所有真实 push 的必经点（多歌手菜单挑完也走 toSinger），而弹菜单、弹失败
  // 提示这些不 push 的路径就不该收——菜单还要弹在详情页上。守卫不通过的路径同样不收。
  // 详情页本来就关着时（歌曲表 / 列表页等入口）再收一次是幂等的，无害。
  const toAlbum = (mid: string) => {
    setShowPlayerDetail(false)
    router.push({ path: '/album', query: { mid } })
  }
  const toSinger = (mid: string) => {
    setShowPlayerDetail(false)
    router.push({ path: '/singer', query: { mid } })
  }

  /**
   * 「歌曲详情」：进本仓的歌曲详情页 `/songDetail`（**不是 QQ 网页**）。
   *
   * 在线歌曲表、本地列表歌曲表、下载列表三处的同名菜单项（`list__source_detail`）都走这里：
   * 这三处原来各写一套，于是漂移出「一处进本仓页面、一处开 QQ 网页」（ui-polish-followups 工单 03）。
   *
   * 判据：mid 取 `meta.songId`（新式模型里它存的才是 songmid，见 `@common/utils/tools` 的 toOldMusicInfo /
   * toNewMusicInfo），本地文件那里存的是**文件路径**——没有在线 mid 就什么都不做，
   * 菜单项由同一判据（`getMusicDetailPageUrl` 对 local 不存在）隐藏（见两个 useMenu 的 sourceDetail）。
   */
  const toSongDetail = (minfo: LX.Music.MusicInfo | null | undefined) => {
    if (!minfo || minfo.source == 'local') return
    const mid = minfo.meta?.songId
    if (!mid) return
    setShowPlayerDetail(false)
    router.push({ path: '/songDetail', query: { source: minfo.source, mid } })
  }

  // 歌曲详情的适配器：`track_info.singer[]` 每位都带 mid 与 name（见 qq-music-native.md §5.10）
  const fetchSingers = (mid: string) => music.tx.songDetail.getDetail(mid).then(detail => detail.trackRaw?.singer)

  // 歌曲的网页链接用数据层原有的生成器（本地源没有这一项，取不到就是空串）
  const musicWebUrl = (minfo: LX.Music.MusicInfo) => {
    const sdk = (music as Record<string, any>)[minfo.source] as { getMusicDetailPageUrl?: (info: any) => string } | undefined
    return sdk?.getMusicDetailPageUrl?.(toOldMusicInfo(minfo)) ?? ''
  }
  const albumWebUrl = (albumMid: string) => music.tx.getAlbumDetailPageUrl(albumMid)

  // ── 多位歌手时让用户挑（用 base-menu，位置贴在触发点）───────────────────────
  // 这几项平铺返回：模板里要直接绑 `v-model` / `:xy` / `:menus`，嵌套在对象里的 ref 不会被自动解包
  //
  // ⚠️ 调用方渲染 base-menu 时，**打开菜单的那次点击必须 `@click.stop`**（工单 23）：
  // base-menu 的「点空白收起」挂在 document 上，而 Chromium 在每个监听器返回后都会跑一次
  // microtask checkpoint —— Vue 的 watcher 正好是微任务，菜单就是在那次 checkpoint 里打开的，
  // 于是**同一次点击**会紧接着冒泡到 document，把刚开的菜单立刻关掉。
  // 第一次点常常看不出来（`resolveSingers` 还在等网络，打开发生在事件派发之后），
  // 命中 `singerCache` 之后就变成「弹出一次、之后再点弹不出来」（2026-09-24 真机报的）。
  // 真浏览器里量到的派发顺序：`触发元素监听 → microtask → document 监听`（两个歌曲表本来就是这么写的）。
  const isShowSingerPicker = ref(false)
  const singerPickerXy = shallowReactive({ x: 0, y: 0 })
  const singerPickerSingers = ref<JumpSinger[]>([])

  /**
   * 触发菜单的事件；只需要传坐标时也可以给一个等价的伪事件——这里唯一读的字段就是 `pageX`/`pageY`。
   * 菜单那套 `{x, y}` 坐标不直接进这里：调用方的 `handleJumpSinger` 包装会先映射成 `pageX`/`pageY`
   * （歌曲表两处：`OnlineList/useMusicActions.js:78`、`ListMusicTable/useMusicActions.js:39`）；
   * 雷达的跳转按钮复用同一个包装，所以也是同一条路（`RadarCarousel.vue:463-465`）。
   */
  type PickerTrigger = { pageX?: number, pageY?: number, currentTarget?: EventTarget | null } | undefined

  /**
   * 菜单落点（工单 05）。鼠标点击直接用它的事件坐标；**键盘激活（Tab 到按钮按 Enter/空格）时
   * Chromium 给的 pageX/pageY 都是 0**，照抄会算出 `(-rootOffset, -rootOffset)`，
   * 被 `#root { overflow: hidden }` 裁得完全看不见（表现仍是「点了没反应」）。
   * 拿不到坐标时退回触发元素的矩形（`rect` 是视口坐标，页内不滚动时与 pageX/pageY 同值）：
   * 1. 事件自己的 `currentTarget`（只有同步调用才有值——本函数在 `jumpToSinger` 的 await 之后才跑）；
   * 2. 没有元素信息时用 `document.activeElement`——键盘激活时它正是那个按钮，这条能救回歌曲表 / 雷达的菜单链路。
   */
  const resolvePickerXy = (event?: PickerTrigger) => {
    const x = event?.pageX ?? 0
    const y = event?.pageY ?? 0
    if (x || y) return { x, y }
    const active = document.activeElement
    const el = (event?.currentTarget ?? (active && active != document.body && active != document.documentElement ? active : null)) as Element | null
    const rect = el?.getBoundingClientRect?.()
    // 元素没有尺寸（未渲染 / 已卸载）时保持 0：位置由 useMenuLocation 夹回容器内可见处
    if (!rect || (!rect.width && !rect.height)) return { x, y }
    // 贴触发元素的下沿展开；出界由 useMenuLocation 的翻转/夹取处理
    return { x: rect.left, y: rect.bottom }
  }
  const showSingerPicker = (singers: JumpSinger[], event?: PickerTrigger) => {
    const xy = resolvePickerXy(event)
    singerPickerSingers.value = singers
    singerPickerXy.x = xy.x
    singerPickerXy.y = xy.y
    isShowSingerPicker.value = true
  }
  const singerPickerMenus = () => {
    const menus: Array<{ name: string, action: string, disabled?: boolean }> = [
      // 菜单本身没有标题栏，用一条禁用的首项当标题（不新造弹窗组件）
      { name: t('list__pick_singer'), action: 'title', disabled: true },
    ]
    for (const singer of singerPickerSingers.value) {
      menus.push({ name: singer.name || singer.mid, action: singer.mid })
    }
    return menus
  }
  const handleSingerPickerClick = (item: { action?: string } | null) => {
    isShowSingerPicker.value = false
    if (!item || item.action == 'title') return
    toSinger(item.action!)
  }

  // ── 跳转 ──────────────────────────────────────────────────────────────
  const jumpToAlbum = (minfo: LX.Music.MusicInfo) => {
    const mid = getAlbumMid(minfo)
    // 菜单项与可点样式都按 canJumpToAlbum 关掉了，这里是兜底
    if (!mid) return
    toAlbum(mid)
  }

  /**
   * 已经拿到歌手列表时的跳转：一位直接进，多位弹菜单让用户挑。
   * （歌曲详情页手里就有 `track_info.singer[]`，不必再取一次详情。）
   */
  const jumpToSingerList = (singers: JumpSinger[], event?: PickerTrigger) => {
    if (!singers.length) return
    if (singers.length == 1) {
      toSinger(singers[0].mid)
      return
    }
    showSingerPicker(singers, event)
  }

  const jumpToSinger = async(minfo: LX.Music.MusicInfo, event?: PickerTrigger) => {
    const singers = await resolveSingers(minfo, fetchSingers)
    if (!singers.length) {
      // 取不到歌手 id 时明确提示：不静默、也不退化成「按名字搜」（同名会跳错人）
      void dialog({
        message: t('list__jump_failed', { name: minfo?.name ?? '' }),
        confirmButtonText: t('ok'),
      })
      return
    }
    jumpToSingerList(singers, event)
  }

  // ── 分享（QQ 网页链接，给人用；与本应用的深链不是一回事）────────────────
  const copyMusicLink = (minfo: LX.Music.MusicInfo) => {
    const url = musicWebUrl(minfo)
    if (url) clipboardWriteText(url)
  }
  const openMusicInQqMusic = (minfo: LX.Music.MusicInfo) => {
    const url = musicWebUrl(minfo)
    if (url) void openUrl(url)
  }
  const copyAlbumLink = (albumMid: string) => {
    if (albumMid) clipboardWriteText(albumWebUrl(albumMid))
  }
  const openAlbumInQqMusic = (albumMid: string) => {
    if (albumMid) void openUrl(albumWebUrl(albumMid))
  }

  /**
   * 名称可点：点歌手名 / 专辑名直接跳。
   *
   * 两道守卫：
   * 1. **不可跳就什么都不做**（本地文件没有在线 mid——不做点了弹错误提示的项）；
   * 2. **已经选中了文本就说明用户在复制**，这时不跳。
   * 代价（可接受）：单击一次已经落下光标再拖选时首次点击会跳走——想复制就用按下即拖的一手势。
   */
  const hasTextSelection = () => (window.getSelection()?.toString() ?? '').length > 0
  const handleSingerNameClick = (minfo: LX.Music.MusicInfo, event?: MouseEvent) => {
    if (!canJumpToSinger(minfo) || hasTextSelection()) return
    void jumpToSinger(minfo, event)
  }
  // 专辑这里也保留 event 形参：模板里统一传 `$event`，签名一致省得两处写法不同
  const handleAlbumNameClick = (minfo: LX.Music.MusicInfo, _event?: MouseEvent) => {
    if (!canJumpToAlbum(minfo) || hasTextSelection()) return
    jumpToAlbum(minfo)
  }

  return {
    canJumpToAlbum,
    canJumpToSinger,
    canShareMusic,
    getAlbumMid,
    getSongMid,
    jumpToAlbum,
    jumpToSinger,
    jumpToSingerList,
    toSongDetail,
    copyMusicLink,
    openMusicInQqMusic,
    copyAlbumLink,
    openAlbumInQqMusic,
    handleSingerNameClick,
    handleAlbumNameClick,
    isShowSingerPicker,
    singerPickerXy,
    singerPickerMenus,
    handleSingerPickerClick,
  }
}
