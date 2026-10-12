import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import type * as listAction from '@renderer/store/list/action'
import ListButtons from '@renderer/components/material/ListButtons.vue'
import { qualityList } from '@renderer/store'
import { appSetting } from '@renderer/store/setting'
import { favSongIds, favSongIdsLoaded, favSongs } from '@renderer/store/user/state'
import ListMusicTable from './index.vue'

/**
 * 本地歌曲表行内的「我喜欢」键（ui-polish-3 工单 06 留下的补齐 —— 票 06 当时把
 * `ListMusicTable/index.vue` 列在「遗留」里：它被工单 08 占着，所以行内键只加到了在线表）。
 *
 * 键本身的**行为**（文案随状态变、本地文件不渲染、点击只 emit `fav`）在
 * `material/ListButtons.test.ts` 里钉过；这里钉的是**本地表的接线**，也就是这次补的三处：
 *   1. 行内真的出现这颗心（接 `:music-info="item" fav-btn`）；
 *   2. 一挂载就把收藏态拉回来（`loadFavState`），已在我喜欢里的歌直接显示「取消喜欢」；
 *   3. 点它走**票 06 的共用入口**（`useFavSong` → `toggleFavSongToCloud` → `likeSong`），
 *      写成功后同一个键立刻变状态（store 里就地更新，不必重挂载）。
 * 外加与在线表口径一致的那一条：本地文件（没有 QQ 歌曲 ID）那一行**不显示**心形。
 *
 * 只把最外层 SDK 与「从主进程读本地列表的歌曲」换成桩，其余（store、收藏态、文案）都是真的。
 */

const { likeSong, unlikeSong, getFavSongIds, getListMusics } = vi.hoisted(() => ({
  likeSong: vi.fn(),
  unlikeSong: vi.fn(),
  getFavSongIds: vi.fn(),
  getListMusics: vi.fn(),
}))

// `sources` 是「来源显示名」那张表要遍历的（store/index.ts 的 sourceNames），空数组即可
vi.mock('@renderer/utils/musicSdk', () => ({
  default: { sources: [], tx: { songList: { likeSong, unlikeSong }, user: { getFavSongIds } } },
}))

// 本地列表的歌曲是走 IPC 从主进程库读的（测试环境没人应答）——只换这一个读接口，
// 其余导出保持真的（这条导入链上的模块会静态引用它们，缺导出就是找不到导出）
vi.mock('@renderer/store/list/action', async(importOriginal) => ({
  ...await importOriginal<typeof listAction>(),
  getListMusics,
}))

// 本用例不碰路由（跳转在 `useMusicJump` 里），桩掉免得每次挂载刷一屏 router 注入告警
vi.mock('@common/utils/vueRouter', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useRoute: () => ({ path: '/playlists', query: {} }),
}))

/** 列表组件桩：照 `base-virtualized-list` 的插槽契约逐行渲染（同 OnlineList 的用例） */
const VirtualizedListStub = defineComponent({
  name: 'BaseVirtualizedList',
  props: {
    list: { type: Array, default: () => [] },
    itemHeight: { type: Number, default: 40 },
    keyName: { type: String, default: 'id' },
  },
  setup(props, { slots }) {
    return () => h('div', { class: 'v-list' }, (props.list as any[]).map((item: any, index: number) =>
      h('div', { key: item.id }, slots.default?.({ item, index }))))
  },
  methods: {
    scrollTo() {},
    getScrollTop() { return 0 },
  },
})

/** 在线歌曲：QQ 的 songId/songType 在 meta 里（`store/user/action.ts` 的写接口要它们） */
const txSong = (id: string) => ({
  id: `tx_${id}`,
  name: `歌${id}`,
  singer: '歌手',
  source: 'tx',
  interval: '03:00',
  meta: { albumName: '专辑', id, songType: 0 },
}) as any

const localSong = {
  id: 'local_1',
  name: '本地文件',
  singer: '歌手',
  source: 'local',
  interval: '03:00',
  meta: { albumName: '' },
} as any

const mountTable = (list: any[]) => {
  getListMusics.mockResolvedValue(list)
  return mount(ListMusicTable, {
    props: { listId: 'user_1' },
    global: {
      mocks: { $t: (key: string) => key },
      // 行内键用**真件**：这颗心出不出现、文案是什么，正是本用例要看的
      components: { 'material-list-buttons': ListButtons },
      stubs: {
        'base-virtualized-list': VirtualizedListStub,
        'base-menu': true,
        'common-list-add-modal': true,
        'common-list-add-multiple-modal': true,
        'common-download-modal': true,
        'common-download-multiple-modal': true,
        'search-list': true,
        'music-sort-modal': true,
      },
    },
  })
}

/** 行内那颗心：按两个可能的状态文案找，不猜它在按钮行里的位置 */
const heartIn = (row: any) => row.findAll('button')
  .find((btn: any) => ['list_add__cloud_fav', 'list__unlove'].includes(btn.attributes('aria-label')))

// CSS Modules 的类名带哈希（`_favOn_7af6e4`），只断言「带上了这个状态类」（同 ListButtons 的用例）
const hasFavOn = (row: any) =>
  heartIn(row).find('svg').classes().some((name: string) => name.includes('favOn'))

/** 行内那颗下载键（`$t` 是桩，键名即 aria-label/title） */
const downloadIn = (row: any) => row.findAll('button')
  .find((btn: any) => btn.attributes('aria-label') === 'list__download')
/** 行内那颗播放键（`ListButtons` 的 playBtn 默认开，本地文件也该能播） */
const playIn = (row: any) => row.findAll('button')
  .find((btn: any) => btn.attributes('aria-label') === 'list__play')

let mountedWrappers: Array<ReturnType<typeof mountTable>> = []

beforeEach(() => {
  vi.clearAllMocks()
  favSongIds.splice(0, favSongIds.length)
  favSongIdsLoaded.value = false
  // total 归零：收藏成功后会「列表已加载才刷新」，这里不需要那次刷新
  favSongs.total = 0
  appSetting['list.actionButtonsVisible'] = true
  getFavSongIds.mockResolvedValue([])
  likeSong.mockResolvedValue(true)
  unlikeSong.mockResolvedValue(true)
})

afterEach(() => {
  while (mountedWrappers.length) mountedWrappers.pop()!.unmount()
  mountedWrappers = []
  // 还原成 `defaultSetting` 里的默认值，别把这次改动漏给同文件之后的用例
  appSetting['list.actionButtonsVisible'] = false
  qualityList.value = {}
})

describe('components/common/ListMusicTable 行内的「我喜欢」键', () => {
  it('tx 歌曲那一行有心形键：点一下走共用入口，写成功后同一个键就地变状态', async() => {
    const wrapper = mountTable([txSong('1')])
    mountedWrappers.push(wrapper)
    await flushPromises()

    const row = wrapper.findAll('.list-item')[0]
    expect(heartIn(row)).toBeTruthy()
    expect(heartIn(row).attributes('title')).toBe('list_add__cloud_fav')
    expect(hasFavOn(row)).toBe(false)

    await heartIn(row).trigger('click')
    await flushPromises()

    // 走的是票 06 的共用入口（songId/songType 从 meta 取），只写一个方向
    expect(likeSong).toHaveBeenCalledTimes(1)
    expect(likeSong).toHaveBeenCalledWith([{ songId: 1, songType: 0 }])
    expect(unlikeSong).not.toHaveBeenCalled()
    // 收藏成功后就地更新 store → 同一个键立刻变「取消喜欢」+ 上主色，不用等重挂载 / 重拉
    expect(heartIn(row).attributes('title')).toBe('list__unlove')
    expect(hasFavOn(row)).toBe(true)
  })

  it('一挂载就把收藏态拉回来：已在我喜欢里 → 直接显示「取消喜欢」（状态是逐首的）', async() => {
    getFavSongIds.mockResolvedValue(['1'])
    const wrapper = mountTable([txSong('1'), txSong('2')])
    mountedWrappers.push(wrapper)
    await flushPromises()

    const rows = wrapper.findAll('.list-item')
    expect(heartIn(rows[0]).attributes('title')).toBe('list__unlove')
    expect(heartIn(rows[1]).attributes('title')).toBe('list_add__cloud_fav')
  })

  it('本地文件（没有 QQ 歌曲 ID）那一行不显示心形键（与在线表口径一致）', async() => {
    const wrapper = mountTable([localSong, txSong('1')])
    mountedWrappers.push(wrapper)
    await flushPromises()

    const rows = wrapper.findAll('.list-item')
    expect(heartIn(rows[0])).toBeUndefined()
    expect(heartIn(rows[1])).toBeTruthy()
  })

  it('没开「显示操作按钮」时行内没有心形键，也不白拉一次收藏态', async() => {
    appSetting['list.actionButtonsVisible'] = false
    const wrapper = mountTable([txSong('1')])
    mountedWrappers.push(wrapper)
    await flushPromises()

    expect(wrapper.findAll('button')).toHaveLength(0)
    expect(getFavSongIds).not.toHaveBeenCalled()
  })
})

/**
 * 行内**下载键**的可用性组合（ui-polish-followups 票 17 接缝 3 的行内那一半）。
 *
 * 契约：`index.vue:71` 的 `:download-btn="assertApiSupport(item.source) && item.source != 'local'"`
 * ——**两个条件都要**。容易漏的是第二个：`assertApiSupport('local')` 的真实返回值是 `true`
 * （`store/utils.ts` 里 `source == 'local' || qualityList[source] != null`，那是给「能不能播」用的），
 * 只判它会给本地文件开出一个点了没意义的下载键。同一表达式在右键菜单那侧由
 * `useMenu.test.ts` 钉。
 *
 * 期望值来源：`ListButtons.vue` 的 `v-if="downloadBtn && appSetting['download.enable']"`
 * （默认关，用例显式打开）与 `store/utils.ts` 的判据；「源声明了音质档位」用
 * `qualityList.value = { tx: ['128k'] }` 造（与 `store/utils.test.ts` 同一手法）。
 */
describe('components/common/ListMusicTable 行内下载键的可用性（本地 vs 在线）', () => {
  /** 源声明了音质档位（`assertApiSupport` 的判据是 `qualityList[source] != null`，空数组也算支持） */
  const DECLARED_QUALITYS: LX.QualityList = { tx: ['128k'] }

  it('在线 tx 歌曲 + 源声明了音质档位 → 有下载键', async() => {
    qualityList.value = DECLARED_QUALITYS

    const wrapper = mountTable([txSong('1')])
    mountedWrappers.push(wrapper)
    await flushPromises()

    expect(downloadIn(wrapper.findAll('.list-item')[0])).toBeTruthy()
  })

  it('本地文件 → 没有下载键（即使源「支持」；对照同一行的播放键在）', async() => {
    qualityList.value = DECLARED_QUALITYS

    const wrapper = mountTable([localSong])
    mountedWrappers.push(wrapper)
    await flushPromises()

    const row = wrapper.findAll('.list-item')[0]
    expect(downloadIn(row)).toBeUndefined()
    // 对照：这一排按钮真的渲染了（否则「没有下载键」可能只是整排没出来）
    expect(playIn(row)).toBeTruthy()
  })
})
