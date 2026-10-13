import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FavListsPanel from './FavListsPanel.vue'

/**
 * 我的收藏 →「歌单」tab 卡片上的**取消收藏键**（票 06 E3）—— dom project。
 *
 * 这张卡走的是共用件 `SongCardGrid` 的 `item-action` 插槽（网格本身在搜索 / 乐馆也在用，
 * 不能把按钮写死在里面）。所以这里除了按钮行为，还顺带钉住「插槽把每一行的 item 传进来了」
 * ——传错行是这类插槽最容易出的错。
 */

const mocks = vi.hoisted(() => ({
  initUserCenter: vi.fn(),
  loadMoreFavLists: vi.fn(),
  removeFavListFromList: vi.fn(),
  confirm: vi.fn(),
  dialog: vi.fn(),
}))

const store = vi.hoisted(() => ({
  favLists: [] as any[],
  labels: { favLists: '' },
  pagers: { favLists: { page: 1, hasMore: false } },
}))

vi.mock('@renderer/store/user/state', async() => {
  const { shallowReactive } = await import('vue')
  return {
    favLists: shallowReactive(store.favLists),
    labels: store.labels,
    pagers: store.pagers,
  }
})
vi.mock('@renderer/store/user/action', () => ({
  initUserCenter: mocks.initUserCenter,
  loadMoreFavLists: mocks.loadMoreFavLists,
  removeFavListFromList: mocks.removeFavListFromList,
  moreErrorLabelOf: () => '',
  noItemLabelOf: () => '',
}))
vi.mock('@renderer/plugins/Dialog', () => ({ dialog: Object.assign(mocks.dialog, { confirm: mocks.confirm }) }))
vi.mock('@renderer/store/qqAuth/state', () => ({ status: { isLogin: false } }))
vi.mock('@common/utils/vueRouter', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useRoute: () => ({ name: 'favorites', query: {} }),
}))

enableAutoUnmount(afterEach)

const list = (id: string, name: string) => ({
  id,
  name,
  img: '',
  author: '分享者',
  total: '10',
  time: '',
  desc: null,
  source: 'tx',
})

const mountPanel = () => mount(FavListsPanel, {
  global: {
    stubs: { 'svg-icon': true, 'base-btn': true, 'material-pagination': true },
    mocks: { $t: (key: string) => key },
  },
})

const unfavBtn = (wrapper: ReturnType<typeof mountPanel>) =>
  wrapper.findAll('button').find(node => node.attributes('aria-label') === 'fav__cancel')

beforeEach(() => {
  vi.clearAllMocks()
  store.favLists.splice(0, store.favLists.length, list('1001', '歌单甲'), list('1002', '歌单乙'))
  mocks.confirm.mockResolvedValue(true)
})

describe('我的收藏 → 歌单 tab 的卡片取消收藏', () => {
  it('每张卡都从插槽拿到取消收藏键；点第一张传出去的是第一张的 item（不是别行）', async() => {
    const wrapper = mountPanel()

    const buttons = wrapper.findAll('button').filter(node => node.attributes('aria-label') === 'fav__cancel')
    expect(buttons).toHaveLength(2)

    await buttons[0].trigger('click')
    await flushPromises()

    expect(mocks.removeFavListFromList).toHaveBeenCalledWith(expect.objectContaining({ id: '1001' }))
  })

  it('用户取消确认 → 不发写请求', async() => {
    mocks.confirm.mockResolvedValue(false)
    const wrapper = mountPanel()

    await unfavBtn(wrapper)!.trigger('click')
    await flushPromises()

    expect(mocks.confirm).toHaveBeenCalledTimes(1)
    expect(mocks.removeFavListFromList).not.toHaveBeenCalled()
  })

  it('取消收藏失败 → 弹 dialog 报错（不静默）', async() => {
    mocks.removeFavListFromList.mockRejectedValue(new Error('取消收藏失败，请稍后再试'))
    const wrapper = mountPanel()

    await unfavBtn(wrapper)!.trigger('click')
    await flushPromises()

    expect(mocks.dialog).toHaveBeenCalledWith({ message: '取消收藏失败，请稍后再试', type: 'error' })
  })
})
