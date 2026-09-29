import { computed, nextTick, ref, shallowRef, watch, type Ref } from '@common/utils/vueTools'
import { useRoute, useRouter } from '@common/utils/vueRouter'
import { createdLists, isInited, isLoading, labels as userLabels } from '@renderer/store/user/state'
import { status } from '@renderer/store/qqAuth/state'
import { createCloudList, initUserCenter, reloadCreatedLists, removeCloudList, uploadListCover } from '@renderer/store/user/action'
import { dialog } from '@renderer/plugins/Dialog'
import { useI18n } from '@renderer/plugins/i18n'
import type { PlaylistCard } from '@renderer/store/user/state'
import { type TabId, withTab } from '../../tabs'
import { resolveCloudSelection } from './cloudSelection'

/** 「我喜欢」在「我的收藏」页里，不在这里重复（与原来的注释同口径）。 */
const I_LIKE_DIR_ID = '201'

/**
 * 我的歌单 →「QQ 音乐·歌单」tab 左栏的取数（工单 09）。
 *
 * 与原 `PlaylistRail.vue` 的云端半段一致：只放开已实现的能力（建 / 删），重命名、排序、
 * 导入导出不出现——点了没反应比没有更糟。加歌 / 删歌 / 刷新在右栏的 `CloudListPane`。
 *
 * 取数分两档（2026-09-29 用户报障：列表区整场会话不刷新）：会话没整包初始化过走
 * `initUserCenter`（列表在里面）；初始化过就只重拉列表（`reloadCreatedLists`）——云端自建
 * 歌单是**多端可变**的数据（手机 / 网页都能建、删），整包那份被 `isInited` 会话级守卫挡着，
 * 不重拉的话本应用直到重启都看不到别端的改动。整包正在飞（isLoading）就交给在飞那轮，
 * 不并发补拉。登录信号到达再整包 force 一轮（照 Favorites 各面板的 watch）。
 * 选中项写在 `route.query.cloud`（dirId），保留其它键——**`tab` 要显式带**（工单 02：
 * 归一可能发生在「切 tab 的导航还没落地」的窗口里，靠 `{ ...route.query }` 保留会把 tab 写丢）。
 */
export default ({ cloudDirId, tab }: { cloudDirId: Ref<string>, tab: Ref<TabId> }) => {
  const router = useRouter()
  const route = useRoute()
  const t = useI18n()

  if (isInited.value && !isLoading.value) {
    void reloadCreatedLists()
  } else {
    void initUserCenter()
  }

  // 登录信号到达就整包重拉（照 Favorites 各面板的 watch）：登录成功会 resetUserCenter 清掉
  // 会话缓存，此时正停在本页的话不重拉就一直是空态。登出信号不动——数据已由清空兜底
  watch(() => status.isLogin, (isLogin) => {
    if (isLogin) void initUserCenter(true)
  })

  const cloudLists = computed(() => createdLists.filter(item => item.dirId !== I_LIKE_DIR_ID))
  const cloudListsLabel = computed(() => userLabels.createdLists || t('no_item'))

  /**
   * 选中项归一：`cloud` 缺失、或指向已不存在的歌单（老链接 / 刚被删掉）时落到第一组；
   * 一组都没有就清掉参数（右栏显示空态提示）。**不能省**——删掉正在看的那个歌单后
   * 右栏会停在已经不存在的 dirId 上。
   */
  const handleSelect = (dirId: string) => {
    if (dirId === cloudDirId.value) return
    void router.replace({
      path: route.path,
      query: withTab(route.query, tab.value, { cloud: dirId || undefined }),
    })
  }

  /**
   * 归一必须等**列表真的到手**才跑：冷启动直接进 `?cloud=<dirId>` 时 `createdLists` 还是空的，
   * 照着「列表里没有就归一」跑会把用户要的那一个抹掉（改成第一组甚至清空）。
   * 判据两条：`initUserCenter` 跑完（`isInited`），且 createdLists 那次请求成功（label 被清空；
   * 失败会留文案，此时不动 query——右栏自己会显示失败原因）。
   */
  const isListsLoaded = () => isInited.value && userLabels.createdLists === ''

  watch([cloudLists, cloudDirId, isInited], ([lists, dirId]) => {
    const next = resolveCloudSelection(lists, dirId, isListsLoaded())
    if (next != null) handleSelect(next)
  }, { immediate: true })

  // ── 新建云端歌单（可带自定义封面）──────────────────────────────────────
  const isShowNewCloudList = ref(false)
  const isNewCloudListLeave = ref(false)

  /**
   * 待上传的封面：`{ file, url }`，`url` 是本地预览的 blob 地址（选中后行内显示缩略图）。
   *
   * 为什么封面只能在"新建时"给：改**已有**歌单封面的端点（`EditPlaylist`）2026-09-26 实测
   * 不可用（四个参数名 + 老版 web 完整载荷全是 `code: 1101`、回显 `dirId: 0`），证据见
   * `tx/songList.js` 的 `createList` 注释。不选封面 = 完全走原来那条路径（零行为变化）。
   *
   * ⚠️ 用 `shallowRef`：`File` 进了深层响应式会被包成 Proxy，交给 `arrayBuffer()` 不划算；
   * 而且我们只关心"换没换"，不需要观察 File 内部。
   */
  const newListCover = shallowRef(null as { file: File, url: string } | null)

  const clearNewListCover = () => {
    if (newListCover.value) URL.revokeObjectURL(newListCover.value.url)
    newListCover.value = null
  }

  /**
   * 选完图（SFC 的隐藏 `<input type="file">` 触发）。
   *
   * 选完立刻把名字输入行打开（原来要靠点「+」），用户的下一步就是起名 → 回车。
   * 输入行里会显示缩略图，所以"这张图会当封面"是看得见的。
   */
  const handleCoverPicked = (event: Event) => {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    // 清掉 value：同一个文件连选两次也要能再触发 change（浏览器同值不派发）
    input.value = ''
    if (file == null) return
    clearNewListCover()
    newListCover.value = { file, url: URL.createObjectURL(file) }
    // 打开名字输入行；焦点由 SFC 的 `@after-enter` 给（那里是 DOM 的事，见 CloudRail.vue）
    isShowNewCloudList.value = true
  }

  /** 缩略图点击 = 去掉封面（回到"不带封面建歌单"）。 */
  const handleCoverRemove = () => {
    clearNewListCover()
  }

  const handleCreateCloudList = async(event: Event) => {
    const target = event.target as HTMLInputElement
    if (target.readOnly) return
    const name = target.value.trim()
    target.readOnly = true
    if (!name) {
      isShowNewCloudList.value = false
      // 名字空 = 用户放弃这次新建，选好的封面也一起丢掉（否则会粘到下一次"+"上）
      clearNewListCover()
      return
    }
    try {
      // 有封面就先直传拿地址，再带着它建歌单：**上传失败就不建**——
      // 建出一个没有封面的歌单比让用户重试一次更糟（用户要的是"带封面新建"）
      const cover = newListCover.value
      const dirPicUrl = cover ? await uploadListCover(cover.file) : undefined
      await createCloudList(name, dirPicUrl)
    } catch (err: any) {
      void dialog({ message: err?.message || String(err), type: 'error' })
    }
    clearNewListCover()
    isNewCloudListLeave.value = true
    void nextTick(() => { isShowNewCloudList.value = false })
  }

  // ── 右键删除云端歌单 ──────────────────────────────────────────────────
  const cloudMenus = [{ name: t('playlists__cloud_remove'), action: 'remove' }]
  const isShowCloudMenu = ref(false)
  const cloudMenuLocation = ref({ x: 0, y: 0 })
  const rightClickCloudItem = ref(null as PlaylistCard | null)
  const handleCloudItemRigthClick = (event: MouseEvent, item: PlaylistCard) => {
    event.preventDefault()
    rightClickCloudItem.value = item
    cloudMenuLocation.value = { x: event.clientX, y: event.clientY }
    isShowCloudMenu.value = true
  }
  // ⚠️ base-menu 的 menu-click 传的是**整个菜单项对象**（仓库既有写法都是取 `action.action`，
  // 见 components/material/OnlineList/useMenu.js:105），不是 action 字符串
  const handleCloudMenuClick = (menuItem: { action?: string }) => {
    const item = rightClickCloudItem.value
    rightClickCloudItem.value = null
    if (menuItem?.action !== 'remove' || item == null) return
    void dialog.confirm({
      message: t('playlists__cloud_remove_tip', { name: item.name }),
      confirmButtonText: t('lists__remove_tip_button'),
    }).then(async(isRemove) => {
      if (!isRemove) return
      try {
        await removeCloudList(item)
        // 删掉的正是当前选中的那个 → 归一 watcher 会把选中项挪到剩下的第一组
      } catch (err: any) {
        void dialog({ message: err?.message || String(err), type: 'error' })
      }
    })
  }

  return {
    cloudLists,
    cloudListsLabel,
    handleSelect,
    isShowNewCloudList,
    isNewCloudListLeave,
    newListCover,
    handleCoverPicked,
    handleCoverRemove,
    handleCreateCloudList,
    cloudMenus,
    isShowCloudMenu,
    cloudMenuLocation,
    handleCloudItemRigthClick,
    handleCloudMenuClick,
  }
}
