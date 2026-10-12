import { mount, RouterLinkStub } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
// 只为副作用：`createI18n()` 起的是 `@root/lang` 里那个单例，NavBar 的 `useI18n()` 读的正是它
import '@renderer/plugins/i18n'
import NavBar from '@renderer/components/layout/Aside/NavBar.vue'
import { followFeedState } from '@renderer/store/followFeed/state'
import { loadFollowFeedBadge } from '@renderer/store/followFeed/action'

/**
 * 「关注动态」的**左栏入口与角标**（工单 03，dom project）。
 *
 * 这一块跨在两个文件上（`NavBar.vue` 加入口与角标 + 路由给它 `meta.name`），所以用例挂在
 * `views/Follow/` 下——测试文件不写进 `components/layout/Aside/`（那是别的票的地盘）。
 * 钉三件事：
 *   1. 入口是「我的」组的**末位**，图标键、`aria-label` 与 `title` 都齐（图标键的硬规矩，§2.5.1）；
 *   2. 角标数字的映射：**0 不渲染**、99 以内显示原数、`> 99` 封顶 `99+`（左栏窄，三位数会把角标
 *      撑成横条），并且**跟着 store 变**（一轮检查结束后要能自己更新，不是只有挂载那一次）；
 *   3. 挂载时刷一次未读数（`loadFollowFeedBadge`）——左栏在每个页面都挂着，这是「进应用先刷一次」。
 *
 * 文案走**真 i18n**（`useI18n()` 是 script 里的调用，`global.mocks.$t` 到不了它），断言取
 * `window.i18n.t(...)` 的同一个函数——钉住 key 的同时不怕以后改文案。
 *
 * 数字映射在 `NavBar.vue` 里是命名导出的纯函数（`badgeLabel`），但 `*.vue` 的 shim 只声明了
 * default，TS 不认命名导入（`VirtualizedList.vue` 的 `debounce` 同理）——所以映射表从**渲染结果**
 * 上钉（0 不渲染 / 99 原样 / 100 与 1234 封顶），行为一样被钉死。
 */
const t = (key: string, params?: Record<string, string | number | boolean>) =>
  window.i18n.t(key as any, params)

vi.mock('@renderer/store/followFeed/action', () => ({
  loadFollowFeedBadge: vi.fn(),
}))

/** jsdom 没有 ResizeObserver（`useIconSize` 会用到）——桩成不触发回调的空壳即可 */
class FakeResizeObserver {
  observe() {}
  disconnect() {}
}

const mountNavBar = () => mount(NavBar, {
  global: {
    stubs: { RouterLink: RouterLinkStub },
    // 侧栏高亮读 `$route.meta.name`；这里随便给一个，入口断言不看高亮
    mocks: { $route: { meta: { name: 'Radar' } } },
  },
})

const mineGroupLinks = (wrapper: ReturnType<typeof mountNavBar>) =>
  wrapper.findAll('ul')[1].findAllComponents(RouterLinkStub)

/** 角标是左栏里唯一带 `badge` 类名的 span（CSS Modules 的类名可能带哈希，口径同 ListButtons.test.ts） */
const badgeEl = (wrapper: ReturnType<typeof mountNavBar>) =>
  wrapper.findAll('span').find(span => span.classes().some(name => name.includes('badge')))

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', FakeResizeObserver)
  followFeedState.unreadCount = 0
  vi.mocked(loadFollowFeedBadge).mockClear()
})

describe('关注动态：左栏入口', () => {
  it('入口在「我的」组末位，图标是 #icon-nav-follow，aria-label 与 title 同值', () => {
    const wrapper = mountNavBar()
    const links = mineGroupLinks(wrapper)
    const entry = links[links.length - 1]

    expect(entry.props('to')).toBe('/follow')
    expect(entry.attributes('aria-label')).toBe(t('follow'))
    expect(entry.attributes('title')).toBe(t('follow'))
    // 前面四项没被动过（我的音乐 / 我的收藏 / 我的歌单 / 我的下载）
    expect(links.slice(0, 4).map((link: any) => link.props('to')))
      .toEqual(['/user', '/favorites', '/playlists', '/download'])
    // `xlink:href` 在 xlink 命名空间里，`attributes()` 取不到，只能断言序列化结果
    expect(entry.find('svg use').element.outerHTML).toContain('#icon-nav-follow')
  })
})

describe('关注动态：左栏角标', () => {
  it('0 不渲染；99 以内显示原数；`> 99` 封顶 `99+`（且跟着 store 变）', async() => {
    const wrapper = mountNavBar()

    const cases: Array<[number, string | undefined]> = [
      [0, undefined],
      [1, '1'],
      [99, '99'],
      [100, '99+'],
      [1234, '99+'],
    ]
    for (const [count, expected] of cases) {
      followFeedState.unreadCount = count
      await nextTick()
      expect(badgeEl(wrapper)?.text(), `未读 ${count}`).toBe(expected)
    }
  })

  it('角标带 title（数字自己不自解释），数字与文案都取未读数', () => {
    followFeedState.unreadCount = 5
    const wrapper = mountNavBar()

    expect(badgeEl(wrapper)!.attributes('title')).toBe(t('follow__unread_badge', { count: 5 }))
  })

  it('挂载时刷一次未读数（只读这个数字，不读整份列表）', () => {
    mountNavBar()

    expect(loadFollowFeedBadge).toHaveBeenCalledTimes(1)
  })
})
