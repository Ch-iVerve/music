import { flushPromises, shallowMount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import LocalListsPanel from './LocalListsPanel.vue'
import { userLists } from '@renderer/store/list/state'

// 左栏那条链会 import `@renderer/event`，而那个模块**顶层**直接 `registerEvents()`（拉快捷键配置）：
// 单测里 ipc 桩返回 undefined，收场是一个未处理的 rejection（Vitest 会把它算成整个 run 的错误）。
// 本用例只关心面板写 query，把这条副作用链换掉。
vi.mock('@renderer/event', () => ({ clearDownKeys: () => {}, registerEvents: () => {} }))

/**
 * 「我的歌单 → 本地歌单」面板写 query 的回归用例（工单 02）。
 *
 * 真机症状（2026-09-25 验收，2/2 命中）：在 `#/playlists?cloud=125` 上点「本地歌单」tab，
 * URL 变成 `?cloud=125&id=tx_…`——**`tab` 键没了**，随后 `tabFromQuery` 按残留的 `cloud`
 * 把 tab 判回云端，看起来就是「点本地歌单又弹回云端」。
 *
 * 根因在**写入时机**上：`base-tab` 的 `v-model` 是同步的（点下去 `tab` 立刻变 local，面板
 * 随即挂载），而 `router.replace` 是异步的——面板挂载时读到的 `route.query` 里**还没有
 * `tab`**（只有 `cloud=125`）。这个用例就是把这个瞬间固定下来：router 的当前 query 只有
 * `cloud`（= 切 tab 的导航还没落地），挂载 tab='local' 的面板，断言写回的 query 必须带上
 * `tab`。修之前这里拿不到 `tab`（正是真机那条 URL），修之后必须在。
 */

/** 本地列表的选中项由一个真实存在的自建列表兜底（`userLists[0]`），否则面板不写 id */
const LIST_ID = 'tx_local_1'
/** 票 03 起面板的**默认选中项**是「全部本地音乐」固定节点（不再是第一个自建列表） */
const DEFAULT_ID = 'local_library'

const makeRouter = async(query: string): Promise<Router> => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/playlists', component: defineComponent({ render: () => h('div') }) }],
  })
  await router.push(`/playlists${query}`)
  await router.isReady()
  return router
}

const mountPanel = (router: Router) => shallowMount(LocalListsPanel, {
  props: { tab: 'local' },
  global: {
    plugins: [router],
    mocks: { $t: (key: string) => key },
  },
})

describe('本地面板写 id 时必须带上 tab（工单 02）', () => {
  beforeEach(() => {
    userLists.splice(0, userLists.length, { id: LIST_ID, name: '测试列表' } as any)
  })

  it('面板挂载时 route.query 里还没有 tab（切 tab 的导航未落地）→ 写回的 query 必须补上 tab', async() => {
    const router = await makeRouter('?cloud=125')
    mountPanel(router)
    await flushPromises()

    // 修之前这里只有 { cloud: '125', id: LIST_ID }，tab 丢了 → 被判回云端
    expect(router.currentRoute.value.query.tab).toBe('local')
    // 票 03 起无 id（或 id 不是本地列表）时默认落到「全部本地音乐」节点
    expect(router.currentRoute.value.query.id).toBe(DEFAULT_ID)
    // 云端 tab 的选中项不丢（切回去时还在原位）
    expect(router.currentRoute.value.query.cloud).toBe('125')
  })

  it('route.query 里已有 tab 时照旧（不回归）：tab 保持、id 补上、另一个 tab 的参数保留', async() => {
    const router = await makeRouter('?tab=local&cloud=125')
    mountPanel(router)
    await flushPromises()

    expect(router.currentRoute.value.query.tab).toBe('local')
    expect(router.currentRoute.value.query.id).toBe(DEFAULT_ID)
    expect(router.currentRoute.value.query.cloud).toBe('125')
  })

  it('route.query 里已有 id 时面板不再写 query（tab 原地不动）', async() => {
    const router = await makeRouter('?id=tx_from_link&tab=local')
    mountPanel(router)
    await flushPromises()

    expect(router.currentRoute.value.query.id).toBe('tx_from_link')
    expect(router.currentRoute.value.query.tab).toBe('local')
  })
})
