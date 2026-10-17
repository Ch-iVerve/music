import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
// 仓库的 SFC 类型 shim（`declare module '*.vue'`）只声明 default export，命名导出只有运行时存在，
// 所以 tsc 在这行会报 TS2614；`clearOwnPendingComments` 确实由 index.vue 命名导出（会话级待定集合
// 的清理口，见那边的注释）。shim 将来若支持命名导出，这个 @ts-expect-error 会变成多余指令，届时删掉。
// @ts-expect-error 见上
import MusicComment, { clearOwnPendingComments } from './index.vue'

/**
 * 发表/删除评论（真机验收票 03 的界面落点）。
 *
 * **背景（真机实测，2026-09-26）**：`AddComment` 返回 code=0 之后，自己那条要过一段时间才会
 * 进**公开**列表（h5 `cmd=8`，晴天上实测 2 小时仍未进、总数也不 +1），但新式通道
 * `CommentRead/GetNewCommentList` + `SelfSeeEnable: 1` **1 秒内**就能读到（`IsSelf=1`）。
 * 所以发表成功后除了重拉公开列表，还要把「公开列表里还没有的自己那条」并到顶部显示。
 *
 * **钉住的行为**：
 *   1. 发表成功 → 切到「最新评论」、重拉第 1 页，并把刚发的那条（来自 `getSelfComment`）
 *      显示在列表顶部，带「删除」入口（`canDelete` 靠 userId === 凭证的 encryptUin 放行）；
 *   2. 公开列表里已经有同一条 → 不重复插入，且**不再**去问「自己的评论」通道（待定集合已摘掉）；
 *   3. 删除成功后重拉，那一行消失；删除失败弹对话框（用户主动操作不能只落在提示行上）；
 *   4. 发表失败 → 文案是失败原因，**不**插入任何假行。
 *
 * 只测本组件：数据层（`music.tx.comment.*`）、凭证 IPC、`toOldMusicInfo` 与全局组件都桩掉。
 * 断言用 i18n key（措辞改了不误伤）；`comment-floor` **不桩**——「那条上有没有删除按钮」
 * 正是本票要钉的东西。
 */
const mocks = vi.hoisted(() => ({
  getComment: vi.fn(),
  getHotComment: vi.fn(),
  createComment: vi.fn(),
  getSelfComment: vi.fn(),
  deleteComment: vi.fn(),
  confirm: vi.fn(),
  dialog: vi.fn(),
}))

vi.mock('@renderer/utils/musicSdk', () => ({
  default: {
    tx: {
      comment: {
        getComment: mocks.getComment,
        getHotComment: mocks.getHotComment,
        createComment: mocks.createComment,
        getSelfComment: mocks.getSelfComment,
        deleteComment: mocks.deleteComment,
      },
    },
  },
}))
vi.mock('@renderer/utils/ipc', () => ({
  getQQCredential: vi.fn().mockResolvedValue({ encryptUin: 'euin-1' }),
}))
vi.mock('@renderer/utils', () => ({
  toOldMusicInfo: (info: unknown) => info,
}))

const stubs = {
  'base-input': { template: '<input>' },
  'base-btn': { template: '<button><slot /></button>' },
  'material-pagination': { template: '<div />' },
}

const MUSIC_INFO = { id: '1', source: 'tx', name: '晴天', singer: '周杰伦' }
/** 刚发布的那条在「自己的评论」通道里的样子（字段名已由数据层整形过）。 */
const OWN_PENDING = {
  id: 'seq-1_cm-1',
  rootId: 'seq-1',
  cmId: 'cm-1',
  text: '[zcode-verify] from test',
  timeStr: '2026-09-26 00:20:00',
  userName: 'me',
  avatar: 'avatar.png',
  userId: 'euin-1',
  likedCount: 0,
  reply: [],
}
const PUBLIC_ITEM = {
  id: 'root_cm-9',
  rootId: 'root',
  cmId: 'cm-9',
  text: '别人的评论',
  timeStr: '2026-09-26 00:10:00',
  userName: 'someone',
  avatar: 'avatar.png',
  userId: 'euin-9',
  likedCount: 0,
  reply: [],
}

let host: HTMLDivElement
/** `mounted` 的 setWidth 会读 `parentNode.clientWidth`；别用 VTU 的 attachTo（Vue 3.3 不支持）。 */
const mountComment = () => {
  const wrapper = mount(MusicComment, {
    props: { show: false, musicInfo: MUSIC_INFO },
    global: {
      stubs,
      mocks: {
        $t: (key: string) => key,
        // 应用里是全局注册的对话框：`this.$dialog({...})` 与 `this.$dialog.confirm({...})` 两种用法
        $dialog: Object.assign(mocks.dialog, { confirm: mocks.confirm }),
      },
    },
  })
  host.appendChild(wrapper.element)
  return wrapper
}

const openComment = async() => {
  const wrapper = mountComment()
  await wrapper.setProps({ show: true })
  await flushPromises()
  return wrapper
}

/** 卸载收尾。组件已加固（卸载即撤 setWidth 的两级定时器），不必再等它们跑完。 */
const closeComment = (wrapper: ReturnType<typeof mountComment>) => {
  wrapper.unmount()
}

/** 「最新评论」tab 里渲染出来的行数（`comment-floor` 的真实渲染）。 */
const rowTexts = (wrapper: ReturnType<typeof mountComment>) =>
  wrapper.findAll('li').map(li => li.text())

beforeAll(() => {
  ;(Element.prototype as any).scrollTo = () => {}
})

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  // 「刚发表、还没公开的评论」现在是**模块级**的会话状态（真正的「本次会话」语义，见 index.vue），
  // 用例之间必须隔离，否则上一条用例留下的 pending 会并进下一条的列表
  clearOwnPendingComments()
  mocks.getComment.mockResolvedValue({ comments: [PUBLIC_ITEM], total: 230665, maxPage: 1, page: 1, limit: 20 })
  mocks.getHotComment.mockResolvedValue({ comments: [], total: 0, maxPage: 1, page: 1, limit: 20 })
  mocks.createComment.mockResolvedValue({ source: 'tx', id: 'cm-1', floor: 339355 })
  mocks.getSelfComment.mockResolvedValue([OWN_PENDING])
  mocks.deleteComment.mockResolvedValue(true)
  mocks.confirm.mockResolvedValue(true)
})

afterEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset()
  document.body.innerHTML = ''
})

describe('发表评论', () => {
  it('发表成功后切到「最新评论」、重拉第 1 页，并把还没公开的自己那条显示在顶部（带删除入口）', async() => {
    const wrapper = await openComment()
    wrapper.vm.composerText = '[zcode-verify] from test'

    await wrapper.vm.handlePublish()
    await flushPromises()

    expect(mocks.createComment).toHaveBeenCalledWith(MUSIC_INFO, '[zcode-verify] from test', undefined)
    expect(wrapper.vm.tabActiveId).toBe('new')
    // 重拉的是第 1 页（公开列表）
    expect(mocks.getComment.mock.calls.at(-1)?.[1]).toBe(1)
    // 那条只在「自己的评论」通道里 —— 顶部多一行，且带「仅自己可见」标记与删除按钮
    const texts = rowTexts(wrapper)
    expect(texts.length).toBe(2)
    expect(texts[0]).toContain('[zcode-verify] from test')
    expect(texts[0]).toContain('comment__pending_own')
    expect(texts[0]).toContain('comment__delete')
    // 别人的评论不给删除按钮
    expect(texts[1]).not.toContain('comment__delete')
    expect(texts[1]).not.toContain('comment__pending_own')

    closeComment(wrapper)
  })

  it('公开列表里已经有同一条 → 不重复插入，且不再去问「自己的评论」通道', async() => {
    const wrapper = await openComment()
    wrapper.vm.composerText = '[zcode-verify] from test'
    // 服务端这次已经把那条放出来了：公开列表的第 1 页里就有它
    mocks.getComment.mockResolvedValue({
      comments: [PUBLIC_ITEM, { ...OWN_PENDING, userId: 'euin-1' }],
      total: 230666,
      maxPage: 1,
      page: 1,
      limit: 20,
    })

    await wrapper.vm.handlePublish()
    await flushPromises()
    expect(rowTexts(wrapper).length).toBe(2)

    // 再刷新一次：待定集合已摘掉，不该再为它多发一次「自己的评论」请求
    mocks.getSelfComment.mockClear()
    await wrapper.vm.handleGetNewComment(wrapper.vm.currentMusicInfo, 1, 20)
    await flushPromises()
    expect(mocks.getSelfComment).not.toHaveBeenCalled()
    expect(rowTexts(wrapper).length).toBe(2)

    closeComment(wrapper)
  })

  it('点删除 → 二次确认后调用删除接口并重拉，那一行消失', async() => {
    const wrapper = await openComment()
    wrapper.vm.composerText = '[zcode-verify] from test'
    await wrapper.vm.handlePublish()
    await flushPromises()

    // 删完服务端不再返回它，公开列表里也没有
    mocks.getSelfComment.mockResolvedValue([])
    await wrapper.vm.handleDelete(wrapper.vm.newComment.list[0])
    await flushPromises()

    expect(mocks.confirm).toHaveBeenCalled()
    expect(mocks.deleteComment).toHaveBeenCalledWith('cm-1')
    expect(rowTexts(wrapper).length).toBe(1)
    expect(rowTexts(wrapper)[0]).not.toContain('[zcode-verify] from test')

    closeComment(wrapper)
  })

  it('发表失败 → 提示行给失败原因，不插入假行', async() => {
    const wrapper = await openComment()
    wrapper.vm.composerText = '[zcode-verify] from test'
    mocks.createComment.mockRejectedValue(new Error('发表评论失败'))
    const before = mocks.getComment.mock.calls.length

    await wrapper.vm.handlePublish()
    await flushPromises()

    expect(wrapper.vm.composerTip).toBe('发表评论失败')
    expect(rowTexts(wrapper).length).toBe(1)
    // 失败不重拉（只有打开面板那一次）
    expect(mocks.getComment.mock.calls.length).toBe(before)
    // 输入框内容保留，用户不用重打
    expect(wrapper.vm.composerText).toBe('[zcode-verify] from test')

    closeComment(wrapper)
  })
})

/**
 * 「发完看不到」的**回归路径**（2026-09-26 审查）：待定集合必须是**会话级**（模块级）的。
 *
 * `PlayDetail/index.vue` 给本组件挂的是 `v-if="visibled"`——关掉播放详情再打开就是一次
 * 卸载重挂。集合若挂在组件 data 上，重挂后就是空的；而服务端还没把刚发的那条放进公开列表
 * （票 03 真机实测：晴天上 2 小时仍未进），于是「刚发的那条」又不显示了。
 */
describe('发表评论的待定集合跨卸载重挂（会话级）', () => {
  it('关掉播放详情再打开 → 刚发表、还没公开的那条仍会并到列表顶部', async() => {
    const first = await openComment()
    first.vm.composerText = '[zcode-verify] from test'
    await first.vm.handlePublish()
    await flushPromises()
    expect(rowTexts(first).length).toBe(2)

    closeComment(first)

    // 重挂（模拟关掉播放详情再打开）：公开列表里仍然没有那条，待定集合要还在
    mocks.getSelfComment.mockClear()
    const second = await openComment()
    await flushPromises()

    expect(rowTexts(second).length).toBe(2)
    expect(rowTexts(second)[0]).toContain('[zcode-verify] from test')
    expect(rowTexts(second)[0]).toContain('comment__pending_own')
    expect(mocks.getSelfComment).toHaveBeenCalled()

    closeComment(second)
  })
})
