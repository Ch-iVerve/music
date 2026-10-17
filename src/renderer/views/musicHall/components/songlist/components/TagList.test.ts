import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { tags } from '@renderer/store/songList/state'
import TagList from './TagList.vue'

/**
 * 歌单广场标签下拉取数失败的可读文案（票 03b 同类的体验面）。
 *
 * `getTags(source)` 失败后下拉原来永远空白——用户看不出是「加载失败」还是「本来就没标签」。
 * 这里钉住失败态会落 `list__load_failed`（复用既有 key，不自造），且失败被收口。
 */

const { getTags } = vi.hoisted(() => ({ getTags: vi.fn() }))

vi.mock('@renderer/store/songList/action', () => ({
  getTags,
  setTags: vi.fn(),
}))
vi.mock('@renderer/plugins/i18n', () => ({ useI18n: () => (key: string) => key }))
vi.mock('@common/utils/vueRouter', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useRoute: () => ({ path: '/musicHall', query: {} }),
}))

const trackUnhandledRejection = () => {
  const reasons: unknown[] = []
  const listener = (reason: unknown) => { reasons.push(reason) }
  process.on('unhandledRejection', listener)
  return {
    reasons,
    stop: () => { process.off('unhandledRejection', listener) },
  }
}

const settle = async() => { await new Promise(resolve => setTimeout(resolve, 0)) }

/** 等过组件挂载时排的那个 50ms 定时器（见 TagList.vue 的 setTagPopupWidth） */
const waitPopupTimer = async() => { await new Promise(resolve => setTimeout(resolve, 80)) }

const mountTagList = () => mount(TagList, {
  props: { source: 'tx', tagId: '' },
  global: { mocks: { $t: (key: string) => key } },
})

const tagInfo = {
  source: 'tx',
  hotTag: [],
  tags: [{ name: '流派', list: [{ id: '1', name: '流行', parent_id: '', parent_name: '流派', source: 'tx' }] }],
}

describe('songlist/TagList 取标签失败的可读文案', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete (tags as Record<string, unknown>).tx
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('getTags 失败 → 下拉显示 list__load_failed，且无未处理 rejection', async() => {
    getTags.mockRejectedValue(new Error('标签接口挂了'))
    const unhandled = trackUnhandledRejection()

    const wrapper = mountTagList()
    await settle()
    unhandled.stop()

    expect(wrapper.text()).toContain('list__load_failed')
    expect(unhandled.reasons).toEqual([])
    wrapper.unmount()
  })

  it('正常返回不回归：渲染标签分组、不显示失败文案', async() => {
    getTags.mockResolvedValue(tagInfo)
    const unhandled = trackUnhandledRejection()

    const wrapper = mountTagList()
    await settle()
    unhandled.stop()

    expect(wrapper.text()).toContain('流行')
    expect(wrapper.text()).not.toContain('list__load_failed')
    expect(unhandled.reasons).toEqual([])
    wrapper.unmount()
  })
})

/**
 * `setTagPopupWidth` 排的那个 50ms 定时器：**生命周期与判空都要钉住**。
 *
 * jsdom 里没有 `#view`（它是真实应用的根容器，`App.vue` 才有），所以「定时器漏到卸载之后」
 * 这条竞态在测试里就变成真异常：回调读 `document.getElementById('view').clientWidth` 直接
 * 抛 TypeError。CI（2026-09-28 的 verify）红过一次——本地单跑时 jsdom 环境拆除快于 50ms，
 * 定时器被连带清掉，于是**同一份代码时红时绿**。
 */
describe('songlist/TagList 的取宽定时器', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete (tags as Record<string, unknown>).tx
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('卸载后定时器被取消：#view 不存在也不许漏出未捕获异常', async() => {
    getTags.mockResolvedValue(tagInfo)
    const errors: unknown[] = []
    const onError = (ev: ErrorEvent) => { errors.push(ev.error ?? ev.message) }
    window.addEventListener('error', onError)

    const wrapper = mountTagList()
    await settle()
    wrapper.unmount()
    await waitPopupTimer()

    window.removeEventListener('error', onError)
    expect(errors).toEqual([])
  })

  it('#view 在时仍按它算宽高（别为了消异常把定时器整个删掉）', async() => {
    getTags.mockResolvedValue(tagInfo)
    vi.spyOn(document, 'getElementById').mockImplementation((id: string) =>
      id === 'view' ? { clientWidth: 1000, clientHeight: 800 } as unknown as HTMLElement : null)

    const wrapper = mountTagList()
    await settle()
    await waitPopupTimer()

    // 类名被 CSS module 哈希过，按既有惯例用子串选区
    const popupStyle = (wrapper.get('[class*="popup"]').element as HTMLElement).style
    wrapper.unmount()
    expect(popupStyle.width).toBe('960px')
    expect(popupStyle.maxHeight).toBe('520px')
  })
})
