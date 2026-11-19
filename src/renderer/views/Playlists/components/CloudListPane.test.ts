import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import CloudListPane from './CloudListPane.vue'
import { cloudListSongs, createdLists } from '@renderer/store/user/state'

/**
 * 云端自建歌单面板的「刷新」按钮 —— 回归用例（ui-polish-3 工单 04）。
 *
 * 真机症状（用户 2026-09-24）：「QQ音乐歌单」面板的刷新按钮有问题——点下去**歌单反而变空**，
 * 只剩一句空态文案。根因是标识混用：读歌要**歌单 tid**（`CgiGetDiss` 的 `disstid`），
 * 按钮当时把 **dirId** 当 tid 传了（`createdLists` 卡片上的 `id` 才是 tid）。
 *
 * 这个用例走真链路（组件点击 → store action → SDK 调用 → 状态写回），只把最外层的 SDK 换成桩，
 * 桩按服务端的实测行为（读 tid、写 dirId）：
 * `disstid` 传 dirId 时服务端返回 0 首歌，实现层把它当「读不到」抛错。
 *
 * 2026-09-26 追加：「加载更多」**失败**时的展示（failure 落在 store 的 noItemLabel，
 * 而 `material-online-list` 的 `no-item` 同时是列表容器的显隐开关——原样透传会把已加载的
 * 整页藏掉；契约是数据还在时 no-item 给空串、失败文案走独立提示位）。
 */

const { getListDetailByCgi } = vi.hoisted(() => ({ getListDetailByCgi: vi.fn() }))

vi.mock('@renderer/utils/musicSdk', () => ({
  default: { tx: { songList: { getListDetailByCgi } } },
}))

/** 真机上的数字形态：dirId 是小数字、tid 是大数字（别按大小猜，见 qq-music-native.md 实测）。 */
const DIR_ID = '126'
const TID = '9782527408'
/** 服务端给的总数（比第一页多，好让「加载更多」出现）。 */
const TOTAL = 5

/** SDK 内部流通的「老式歌曲对象」（`tx/utils/song.js` 的 `createSong` 形状）。 */
const makeSongs = (num: number, offset = 0) => Array.from({ length: num }, (_, i) => ({
  singer: `歌手${offset + i}`,
  name: `歌${offset + i}`,
  albumName: '专辑',
  albumId: `albmid${offset + i}`,
  albumMid: `albmid${offset + i}`,
  source: 'tx',
  interval: '03:00',
  songId: 1000 + offset + i,
  songType: 0,
  strMediaMid: `media${offset + i}`,
  songmid: `mid${offset + i}`,
  img: '',
  lrc: null,
  otherSource: null,
  types: [{ type: '320k', size: '1.0M' }],
  _types: { '320k': { size: '1.0M' } },
  typeUrl: {},
}))

const card = {
  id: TID,
  dirId: DIR_ID,
  name: '我的歌单',
  img: '',
  author: '我',
  total: '3',
  time: '',
  desc: null,
  source: 'tx',
}

/** 列表组件桩：显式声明 `noItem`（它是显隐开关，本文件要断言面板传下去的值）。 */
const OnlineListStub = {
  name: 'MaterialOnlineList',
  props: ['list', 'noItem', 'page', 'limit', 'total', 'listId'],
  template: '<div class="online-list" />',
}

const mountPane = () => mount(CloudListPane, {
  props: { dirId: DIR_ID },
  global: {
    mocks: { $t: (key: string) => key },
    stubs: {
      // 列表组件与弹窗与本次行为无关，桩掉；两个按钮按下标找不值得，按文案找更稳
      'material-online-list': OnlineListStub,
      // 声明 disabled 并显式绑到原生属性：不声明的话它走 attrs 透传，`attributes('disabled')` 读不出真假
      'base-btn': {
        template: '<button type="button" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
        props: ['disabled'],
        emits: ['click'],
      },
      'add-songs-modal': true,
    },
  },
})

/** 面板里那个「刷新」按钮（文案经 `$t` 桩后就是 key 本身）。 */
const findRefreshBtn = (wrapper: ReturnType<typeof mountPane>) =>
  wrapper.findAll('button').find(btn => btn.text() === 'user_center__refresh')!

/** 失败文案断言取 i18n 的实际值（store 写的是真文案；本文件的 `$t` 桩只影响模板里的 key） */
const loadFailedText = () => window.i18n.t('list__load_failed' as any)

describe('CloudListPane 取歌的标识与刷新（工单 04）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getListDetailByCgi.mockImplementation(async(id: string, page = 1) => {
      // 「拿 dirId 读恒返回 0 首」——实现层对空列表抛错（tx/songList.js 的 getListDetailByCgi）
      if (String(id) !== TID) throw new Error('歌单为空或不可读')
      const list = makeSongs(page === 1 ? 3 : 2, page === 1 ? 0 : 3)
      return { list, page, limit: 3, total: TOTAL, source: 'tx', info: { name: '我的歌单', img: '', desc: null, author: '', play_count: '' } }
    })
    createdLists.splice(0, createdLists.length, card as any)
    cloudListSongs.list.splice(0, cloudListSongs.list.length)
    cloudListSongs.total = 0
    cloudListSongs.page = 1
    cloudListSongs.noItemLabel = ''
    cloudListSongs.listTid = ''
  })

  it('点刷新按 tid 取数，且不清空已加载的歌（真机上列表被清空就是这个）', async() => {
    const wrapper = mountPane()
    // 挂载时已取过一页（经 card.id = tid），先确认前置状态正常
    await flushPromises()
    expect(cloudListSongs.list).toHaveLength(3)

    await findRefreshBtn(wrapper).trigger('click')
    await flushPromises()

    expect(getListDetailByCgi).toHaveBeenLastCalledWith(TID, 1, expect.any(Number))
    expect(cloudListSongs.list).toHaveLength(3)
    // 空态文案是「重置成空列表」的可见症状，一并钉住
    expect(cloudListSongs.noItemLabel).toBe('')
  })

  it('刷新后 listTid 仍是 tid：写歌后的自动刷新靠它判断「正在看的就是这个歌单」', async() => {
    const wrapper = mountPane()
    await flushPromises()

    await findRefreshBtn(wrapper).trigger('click')
    await flushPromises()

    // dirId 混进来会让 addSongsToCloudList / removeSongsFromCloudList 里的比对永远失败
    expect(cloudListSongs.listTid).toBe(TID)
  })

  it('取数期间刷新按钮禁用（防连点并发，也是加载态的唯一可见反馈）', async() => {
    let release: () => void = () => {}
    const wrapper = mountPane()
    // 先让挂载时那一页正常返回，再让后续请求挂住（否则按钮从头到尾都是禁用态，测不出联动）
    await flushPromises()
    getListDetailByCgi.mockImplementation(async() => new Promise(resolve => {
      release = () => { resolve({ list: makeSongs(3), page: 1, limit: 3, total: 3, source: 'tx', info: {} }) }
    }))
    expect(findRefreshBtn(wrapper).attributes('disabled')).toBeUndefined()

    await findRefreshBtn(wrapper).trigger('click')
    await flushPromises()
    expect(findRefreshBtn(wrapper).attributes('disabled')).toBeDefined()

    release()
    await flushPromises()
    expect(findRefreshBtn(wrapper).attributes('disabled')).toBeUndefined()
  })

  it('「加载更多」也按 tid 取下一页（同一个 dirId 混用的另一处，一起钉住）', async() => {
    const wrapper = mountPane()
    await flushPromises()
    // 总数 5 > 本页 3 → 「加载更多」按钮出现
    const moreBtn = wrapper.findAll('button').find(btn => btn.text() === 'user_center__load_more')!
    expect(moreBtn).toBeTruthy()

    await moreBtn.trigger('click')
    await flushPromises()

    expect(getListDetailByCgi).toHaveBeenLastCalledWith(TID, 2, expect.any(Number))
    expect(cloudListSongs.list).toHaveLength(5)
    expect(cloudListSongs.page).toBe(2)
  })
})

describe('CloudListPane 的「加载更多」失败（2026-09-26 追加）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getListDetailByCgi.mockImplementation(async(id: string, page = 1) => {
      if (String(id) !== TID) throw new Error('歌单为空或不可读')
      const list = makeSongs(page === 1 ? 3 : 2, page === 1 ? 0 : 3)
      return { list, page, limit: 3, total: TOTAL, source: 'tx', info: {} }
    })
    createdLists.splice(0, createdLists.length, card as any)
    cloudListSongs.list.splice(0, cloudListSongs.list.length)
    cloudListSongs.total = 0
    cloudListSongs.page = 1
    cloudListSongs.noItemLabel = ''
    cloudListSongs.listTid = ''
  })

  /** 面板里那个「加载更多」按钮（总数 5 > 本页 3 时出现）。 */
  const findMoreBtn = (wrapper: ReturnType<typeof mountPane>) =>
    wrapper.findAll('button').find(btn => btn.text() === 'user_center__load_more')!

  it('已有歌曲不被藏掉（no-item 保持空串），失败文案走列表下方的独立提示位', async() => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const wrapper = mountPane()
    await flushPromises()
    expect(cloudListSongs.list).toHaveLength(3)

    getListDetailByCgi.mockRejectedValueOnce(new Error('网络错误'))
    await findMoreBtn(wrapper).trigger('click')
    await flushPromises()

    // store 侧：失败只提示，不清空已加载的数据
    expect(cloudListSongs.noItemLabel).toBe(loadFailedText())
    expect(cloudListSongs.list).toHaveLength(3)
    // 视图侧：no-item 是 material-online-list 的显隐开关，数据还在时必须给空串
    const listStub = wrapper.findComponent(OnlineListStub)
    expect(listStub.props('noItem')).toBe('')
    expect(listStub.props('list')).toHaveLength(3)
    // 失败文案仍可读（独立提示位）
    expect(wrapper.text()).toContain(loadFailedText())
    log.mockRestore()
    wrapper.unmount()
  })

  it('失败后再点一次成功：提示位清掉、新一页正常追加', async() => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const wrapper = mountPane()
    await flushPromises()

    getListDetailByCgi.mockRejectedValueOnce(new Error('网络错误'))
    await findMoreBtn(wrapper).trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain(loadFailedText())

    await findMoreBtn(wrapper).trigger('click')
    await flushPromises()

    expect(cloudListSongs.list).toHaveLength(5)
    expect(wrapper.text()).not.toContain(loadFailedText())
    log.mockRestore()
    wrapper.unmount()
  })
})
