import { flushPromises, shallowMount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import LocalLibraryView from './LocalLibraryView.vue'

// 库视图的取数与动作全走 ipc / player / 弹窗，这些重依赖在单测里换成桩——
// 本文件只验证「视图能完整挂载渲染」，桩值不会被断言消费。
vi.mock('@renderer/utils/ipc', () => ({
  getEnvParams: vi.fn(async() => ({ mediaDir: '/tmp/media-test' })),
  localLibraryGetAll: vi.fn(async() => []),
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
  reconcileLibrary: vi.fn(),
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
    ;(window as any).i18n = { t: (key: string) => key }
  })

  it('挂载后工具栏渲染完整（搜索框 + 分组胶囊 + 计数 + 两个动作钮）', async() => {
    const router = await makeRouter()
    const wrapper = shallowMount(LocalLibraryView, {
      global: {
        plugins: [router],
        mocks: { $t: (key: string) => key },
      },
    })
    await flushPromises()

    const toolbar = wrapper.find('[class*=toolbar]')
    expect(toolbar.exists()).toBe(true)
    // 分组胶囊八枚（不分组 + 七个维度）：任一绑定缺失导致渲染中断时这里会少于 8
    expect(wrapper.find('[class*=capsules]').findAll('button')).toHaveLength(8)
    wrapper.unmount()
  })
})
