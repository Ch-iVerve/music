import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import MusicComment from './index.vue'

/**
 * 切歌时评论区必须跟着换歌（2026-09-26 复核的缺陷 4）。
 *
 * 真机症状：打开评论区后自动切到下一首，面板里还是**上一首**的列表 / 标题 / 计数。
 * 根因：`PlayDetail/index.vue:40` 给本组件挂的是 `v-if="visibled"`（跟着播放详情页的开关走，
 * 不跟歌走），自动切歌不重建组件，而组件只 watch `show` → 换歌什么也不做。
 *
 * 两条钉子：
 *   1. `show` 为真时换歌 → 按新歌重跑取数（标题、计数、列表都换过去）；
 *   2. 上一首那次请求**后到**时不许把新歌的数据盖掉（评论请求是这条链上最慢的一环，
 *      连按两下「下一首」就能撞上）。
 *
 * 数据层用桩（同 `index.test.ts`）：`music.tx.comment.getComment` / `getHotComment`，
 * `toOldMusicInfo` 与凭证 IPC 都替身掉。文案断言用 i18n key，措辞改了不误伤。
 */
const mocks = vi.hoisted(() => ({
  getComment: vi.fn(),
  getHotComment: vi.fn(),
}))

vi.mock('@renderer/utils/musicSdk', () => ({
  default: {
    tx: {
      comment: {
        getComment: mocks.getComment,
        getHotComment: mocks.getHotComment,
      },
    },
  },
}))
vi.mock('@renderer/utils/ipc', () => ({
  getQQCredential: vi.fn().mockResolvedValue(null),
}))
vi.mock('@renderer/utils', () => ({
  toOldMusicInfo: (info: unknown) => info,
}))

const stubs = {
  'base-input': { template: '<input>' },
  'base-btn': { template: '<button><slot /></button>' },
  'material-pagination': { template: '<div />' },
}
const i18nMocks = {
  $t: (key: string, params?: { name?: string }) => (params?.name ? `${key}|${params.name}` : key),
}

const SONG_A = { id: '1', source: 'tx', name: 'A', singer: '歌手A' }
const SONG_B = { id: '2', source: 'tx', name: 'B', singer: '歌手B' }

const commentPage = (total: number) => ({ comments: [], total, maxPage: 1, page: 1, limit: 20 })

let host: HTMLDivElement

const mountComment = (musicInfo: Record<string, unknown>) => {
  const wrapper = mount(MusicComment, {
    props: { show: false, musicInfo },
    global: { stubs, mocks: i18nMocks },
  })
  host.appendChild(wrapper.element)
  return wrapper
}

/** 打开评论区（show false → true 触发一次取数）并等请求落地 */
const openComment = async(musicInfo: Record<string, unknown>) => {
  const wrapper = mountComment(musicInfo)
  await wrapper.setProps({ show: true })
  await flushPromises()
  return wrapper
}

/** 标题行文本（含歌名与计数） */
const titleText = (wrapper: ReturnType<typeof mountComment>) => wrapper.get('h3').text()

/** 卸载收尾（同 `index.test.ts`：组件已加固，卸载即撤 setWidth 的两级定时器） */
const closeComment = (wrapper: ReturnType<typeof mountComment>) => {
  wrapper.unmount()
}

beforeAll(() => {
  // jsdom 没实现 Element.scrollTo，而列表刷新后组件会用它把滚动位置归零
  ;(Element.prototype as any).scrollTo = () => {}
})

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  mocks.getComment.mockResolvedValue(commentPage(1))
  mocks.getHotComment.mockResolvedValue(commentPage(1))
})

afterEach(() => {
  mocks.getComment.mockReset()
  mocks.getHotComment.mockReset()
  document.body.innerHTML = ''
})

describe('MusicComment：切歌跟着换评论', () => {
  it('show 为真时换 musicInfo → 按新歌重跑取数，标题与计数都换过去', async() => {
    mocks.getComment.mockImplementation(async(info: { name: string }) => commentPage(info.name === 'A' ? 111 : 222))

    const wrapper = await openComment(SONG_A)
    expect(titleText(wrapper)).toBe('comment__title|A(111)')

    await wrapper.setProps({ musicInfo: SONG_B })
    await flushPromises()

    // 新歌取数过一次（加上开面板那次，共两次），且标题 / 计数都是新歌的
    expect(mocks.getComment).toHaveBeenCalledTimes(2)
    expect(mocks.getComment.mock.calls[1][0]).toMatchObject({ name: 'B' })
    expect(titleText(wrapper)).toBe('comment__title|B(222)')

    closeComment(wrapper)
  })

  it('show 为假时换歌不取数（面板关着的换歌不该白发请求）', async() => {
    const wrapper = mountComment(SONG_A)
    await wrapper.setProps({ musicInfo: SONG_B })
    await flushPromises()

    expect(mocks.getComment).not.toHaveBeenCalled()

    closeComment(wrapper)
  })

  it('上一首的响应后到时不覆盖新歌的数据', async() => {
    let resolveOld: (value: unknown) => void = () => {}
    mocks.getComment.mockImplementation(async(info: { name: string }) => {
      if (info.name === 'A') return new Promise(resolve => { resolveOld = resolve })
      return commentPage(222)
    })

    const wrapper = await openComment(SONG_A)
    // 上一首的请求还挂着，就切到 B（B 的响应立刻到）
    await wrapper.setProps({ musicInfo: SONG_B })
    await flushPromises()
    expect(titleText(wrapper)).toBe('comment__title|B(222)')

    // 旧请求这时才回来：不许把新歌的标题 / 计数（或列表）盖回去
    resolveOld(commentPage(111))
    await flushPromises()

    expect(titleText(wrapper)).toBe('comment__title|B(222)')

    closeComment(wrapper)
  })
})
