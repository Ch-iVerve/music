import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import useCloudLists from './useCloudLists'
import { createdLists, isInited, isLoading, labels } from '@renderer/store/user/state'
import { status } from '@renderer/store/qqAuth/state'

/**
 * 云端自建歌单**左栏**的取数时机（2026-09-29 用户报障：列表区整场会话不刷新）。
 *
 * 旧实现只有挂载时一发 `initUserCenter()`，被 `isInited` 会话级守卫挡着——云端自建歌单是
 * 多端可变的数据（手机 / 网页都能建、删），本应用直到重启都看不到别端的改动；登录时若停在
 * 本页，`resetUserCenter` 清掉的列表也不会再拉（Favorites 各面板都有登录 watch，这里没有）。
 *
 * 钉住的契约（与 Favorites 面板同款）：
 *   1. 会话还没整包初始化（或整包正在飞）→ 走 `initUserCenter`（列表在里面）；
 *   2. 已初始化 → 只重拉列表（`reloadCreatedLists`，不受 isInited 约束）；
 *   3. 登录信号到达 → 整包 force 重拉；登出信号 → 不动（resetUserCenter 已清空）。
 *
 * 路由与动作全部 mock：本测试只关心**调了哪个动作**，不关心请求与渲染。
 */
const mocks = vi.hoisted(() => ({
  initUserCenter: vi.fn(),
  reloadCreatedLists: vi.fn(),
  createCloudList: vi.fn(),
  removeCloudList: vi.fn(),
  uploadListCover: vi.fn(),
  replace: vi.fn(),
}))

vi.mock('@renderer/store/user/action', () => ({
  initUserCenter: mocks.initUserCenter,
  reloadCreatedLists: mocks.reloadCreatedLists,
  createCloudList: mocks.createCloudList,
  removeCloudList: mocks.removeCloudList,
  uploadListCover: mocks.uploadListCover,
}))
vi.mock('@common/utils/vueRouter', () => ({
  useRouter: () => ({ replace: mocks.replace }),
  useRoute: () => ({ path: '/playlists', query: { tab: 'cloud' } }),
}))
vi.mock('@renderer/plugins/i18n', () => ({ useI18n: () => (key: string) => key }))
vi.mock('@renderer/plugins/Dialog', () => ({ dialog: Object.assign(vi.fn(), { confirm: vi.fn() }) }))

const mountHook = () => useCloudLists({ cloudDirId: ref(''), tab: ref('cloud') })

beforeEach(() => {
  vi.clearAllMocks()
  createdLists.splice(0, createdLists.length)
  isInited.value = false
  isLoading.value = false
  labels.createdLists = ''
  status.isLogin = false
})

describe('views/Playlists useCloudLists 的取数时机', () => {
  it('会话已初始化 → 只重拉列表（initUserCenter 会被会话守卫挡住，调了也白调）', () => {
    isInited.value = true

    mountHook()

    expect(mocks.reloadCreatedLists).toHaveBeenCalledTimes(1)
    expect(mocks.initUserCenter).not.toHaveBeenCalled()
  })

  it('首次进入（未初始化）→ 走整包 initUserCenter，不单独重拉', () => {
    mountHook()

    expect(mocks.initUserCenter).toHaveBeenCalledTimes(1)
    expect(mocks.initUserCenter).toHaveBeenCalledWith()
    expect(mocks.reloadCreatedLists).not.toHaveBeenCalled()
  })

  it('整包正在飞（isLoading）→ 交给在飞的那一轮，不并发补拉', () => {
    isInited.value = true
    isLoading.value = true

    mountHook()

    expect(mocks.initUserCenter).toHaveBeenCalledTimes(1)
    expect(mocks.reloadCreatedLists).not.toHaveBeenCalled()
  })

  it('登录信号到达 → 整包 force 重拉（resetUserCenter 已清掉会话缓存）', async() => {
    mountHook()

    status.isLogin = true
    await Promise.resolve()

    expect(mocks.initUserCenter).toHaveBeenCalledWith(true)
  })

  it('登出信号 → 不动作（数据由 resetUserCenter 清空）', async() => {
    status.isLogin = true
    mountHook()
    mocks.initUserCenter.mockClear()

    status.isLogin = false
    await Promise.resolve()

    expect(mocks.initUserCenter).not.toHaveBeenCalled()
  })
})
