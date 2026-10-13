import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FavAlbumsPanel from './FavAlbumsPanel.vue'

/**
 * 我的收藏 →「专辑」tab 卡片上的**取消收藏键**（票 06 E3）—— dom project。
 *
 * 钉三件事：
 *   1. 每张卡都挂着那颗粒（`aria-label` / `title` 同取 `fav__cancel`，§2.5.1 规则 11）；
 *   2. 点了**先二次确认**：取消 → 一个写请求都不发；
 *   3. 确认 → 交 `removeFavAlbumFromList`（写云端 + 就地移卡在 store 层，那边有自己的用例）；
 *      它抛错时弹 dialog 报错（不静默）。
 *
 * store / 取数整个换成桩（同 `FollowSingersPanel.followSinger.test.ts` 的口径）。
 */

const mocks = vi.hoisted(() => ({
  initUserCenter: vi.fn(),
  loadMoreFavAlbums: vi.fn(),
  removeFavAlbumFromList: vi.fn(),
  confirm: vi.fn(),
  dialog: vi.fn(),
}))

const store = vi.hoisted(() => ({
  favAlbums: [] as any[],
  labels: { favAlbums: '' },
  pagers: { favAlbums: { page: 1, hasMore: false } },
}))

vi.mock('@renderer/store/user/state', async() => {
  const { shallowReactive } = await import('vue')
  return {
    favAlbums: shallowReactive(store.favAlbums),
    labels: store.labels,
    pagers: store.pagers,
  }
})
vi.mock('@renderer/store/user/action', () => ({
  initUserCenter: mocks.initUserCenter,
  loadMoreFavAlbums: mocks.loadMoreFavAlbums,
  removeFavAlbumFromList: mocks.removeFavAlbumFromList,
  moreErrorLabelOf: () => '',
}))
vi.mock('@renderer/plugins/Dialog', () => ({ dialog: Object.assign(mocks.dialog, { confirm: mocks.confirm }) }))
vi.mock('@renderer/store/qqAuth/state', () => ({ status: { isLogin: false } }))
vi.mock('@common/utils/vueRouter', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useRoute: () => ({ name: 'favorites', query: {} }),
}))

enableAutoUnmount(afterEach)

const album = (id: string, albumId: string, name: string) => ({
  id,
  albumId,
  name,
  img: '',
  author: '歌手',
  desc: null,
  source: 'tx',
})

const mountPanel = () => mount(FavAlbumsPanel, {
  global: {
    stubs: { 'svg-icon': true, 'base-btn': true },
    mocks: { $t: (key: string) => key },
  },
})

const unfavBtn = (wrapper: ReturnType<typeof mountPanel>) =>
  wrapper.findAll('button').find(node => node.attributes('aria-label') === 'fav__cancel')

beforeEach(() => {
  vi.clearAllMocks()
  store.favAlbums.splice(0, store.favAlbums.length, album('mid-1', '111', '专辑甲'), album('mid-2', '222', '专辑乙'))
  mocks.confirm.mockResolvedValue(true)
})

describe('我的收藏 → 专辑 tab 的卡片取消收藏', () => {
  it('每张卡都带取消收藏键，无障碍名与悬停提示同取 fav__cancel', () => {
    const wrapper = mountPanel()

    const buttons = wrapper.findAll('button').filter(node => node.attributes('aria-label') === 'fav__cancel')
    expect(buttons).toHaveLength(2)
    expect(buttons[0].attributes('title')).toBe('fav__cancel')
  })

  it('点键先二次确认；用户取消 → 不发写请求', async() => {
    mocks.confirm.mockResolvedValue(false)
    const wrapper = mountPanel()

    await unfavBtn(wrapper)!.trigger('click')
    await flushPromises()

    expect(mocks.confirm).toHaveBeenCalledTimes(1)
    expect(mocks.removeFavAlbumFromList).not.toHaveBeenCalled()
    expect(mocks.dialog).not.toHaveBeenCalled()
  })

  it('确认 → 交 removeFavAlbumFromList（整张卡对象：写要 albumId、移卡要 mid）', async() => {
    const wrapper = mountPanel()

    await unfavBtn(wrapper)!.trigger('click')
    await flushPromises()

    expect(mocks.removeFavAlbumFromList).toHaveBeenCalledWith(expect.objectContaining({ id: 'mid-1', albumId: '111' }))
  })

  it('取消收藏失败 → 弹 dialog 报错（不静默）', async() => {
    mocks.removeFavAlbumFromList.mockRejectedValue(new Error('取消收藏失败，请稍后再试'))
    const wrapper = mountPanel()

    await unfavBtn(wrapper)!.trigger('click')
    await flushPromises()

    expect(mocks.dialog).toHaveBeenCalledWith({ message: '取消收藏失败，请稍后再试', type: 'error' })
  })
})
