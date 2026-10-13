import { flushPromises, shallowMount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { LIST_IDS } from '@common/constants'
import LocalLibraryView from './LocalLibraryView.vue'

// 库视图的取数与动作全走 ipc / player / 弹窗，这些重依赖在单测里换成桩——
// 取数桩要能数调用次数（自动刷新那条用例），所以用 hoisted 提出来。
const mocks = vi.hoisted(() => ({
  localLibraryGetAll: vi.fn(async() => []),
}))

vi.mock('@renderer/utils/ipc', () => ({
  getEnvParams: vi.fn(async() => ({ mediaDir: '/tmp/media-test' })),
  localLibraryGetAll: mocks.localLibraryGetAll,
  localLibraryRemove: vi.fn(async() => {}),
  showSelectDialog: vi.fn(async() => ({ canceled: true })),
}))
vi.mock('@renderer/core/player/action', () => ({ playMusicList: vi.fn() }))
vi.mock('@renderer/store/player/action', () => ({ addTempPlayList: vi.fn() }))
vi.mock('@renderer/store/setting', () => ({
  appSetting: { 'download.fileNameTemplate': '', 'list.actionButtonsVisible': true },
}))
vi.mock('@renderer/plugins/Dialog', () => ({ dialog: { confirm: vi.fn(async() => true) } }))
vi.mock('@common/utils/electron', () => ({ clipboardWriteText: vi.fn() }))
vi.mock('@renderer/utils', () => ({ formatMusicName: vi.fn(() => '') }))
vi.mock('@renderer/core/localLibrary', () => ({
  autoCleanJunk: vi.fn(async() => 0),
  buildLocalEntry: vi.fn(() => ({})),
  deleteOrphanFiles: vi.fn(async() => 0),
  importFolderToNewList: vi.fn(),
  useLocalImportState: () => ({ visible: { value: false }, finished: { value: null } }),
}))
vi.mock('@renderer/core/localLibrary/covers', () => ({ revokeCoverUrls: vi.fn() }))
vi.mock('@renderer/core/localLibrary/availability', () => ({
  checkAvailability: vi.fn(),
  isMediaPathMissing: vi.fn(() => false),
}))

const makeRouter = async(): Promise<Router> => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/playlists', component: defineComponent({ render: () => h('div') }) }],
  })
  await router.push('/playlists?tab=local')
  await router.isReady()
  return router
}

/**
 * 库视图挂载回归（真机回归 2026-10-10）：模板里引用了模块作用域的 `LIST_IDS`（Vue 模板只认
 * setup 返回值），渲染时抛 `Cannot read properties of undefined`，整个「全部本地音乐」视图
 * 白屏（左栏还在、右栏全空）。修法是经 setup 返回 `libraryListId`；本用例把
 * 「模板引用的绑定必须真的存在」钉住——挂载即渲染工具栏，引用不存在时这里直接抛。
 */
describe('LocalLibraryView 挂载', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.localLibraryGetAll.mockResolvedValue([])
    ;(window as any).i18n = { t: (key: string) => key }
  })

  const mountView = async() => {
    const router = await makeRouter()
    return shallowMount(LocalLibraryView, {
      global: {
        plugins: [router],
        mocks: { $t: (key: string) => key },
      },
    })
  }

  it('挂载后工具栏渲染完整（搜索框 + 分组胶囊 + 计数 + 导入钮）', async() => {
    const wrapper = await mountView()
    await flushPromises()

    const toolbar = wrapper.find('[class*=toolbar]')
    expect(toolbar.exists()).toBe(true)
    // 分组胶囊九枚（不分组 + 七个 tag 维度 + 来源）：任一绑定缺失导致渲染中断时这里会少于 9
    expect(wrapper.find('[class*=capsules]').findAll('button')).toHaveLength(9)
    wrapper.unmount()
  })

  /**
   * 页面自动刷新（2026-10-13 用户口径）：去掉手动「重扫描」入口后，库内容的任何变化都要
   * 自己落到页面上。信号是既有广播 `myListUpdate`——带 LOCAL_LIBRARY 的那条重拉，
   * 别的列表 id 不打扰本页。
   */
  it('myListUpdate 带 LOCAL_LIBRARY → 自动重拉库；别的列表 id 不重拉', async() => {
    const wrapper = await mountView()
    await flushPromises()
    expect(mocks.localLibraryGetAll).toHaveBeenCalledTimes(1)

    // `window.app_event` 的类型只声明具名动作（`myListUpdate(ids)` 这类），`emit` 是总线实现细节；
    // dom setup 的桩总线两种都支持，这里用 emit 直接模拟一次广播
    ;(window.app_event as any).emit('myListUpdate', [LIST_IDS.TEMP])
    await flushPromises()
    expect(mocks.localLibraryGetAll).toHaveBeenCalledTimes(1)

    ;(window.app_event as any).emit('myListUpdate', [LIST_IDS.LOCAL_LIBRARY])
    await flushPromises()
    expect(mocks.localLibraryGetAll).toHaveBeenCalledTimes(2)

    wrapper.unmount()
  })

  it('卸载后摘掉监听：再广播不重拉（切走页面不留回调）', async() => {
    const wrapper = await mountView()
    await flushPromises()
    wrapper.unmount()

    ;(window.app_event as any).emit('myListUpdate', [LIST_IDS.LOCAL_LIBRARY])
    await flushPromises()

    expect(mocks.localLibraryGetAll).toHaveBeenCalledTimes(1)
  })
})
