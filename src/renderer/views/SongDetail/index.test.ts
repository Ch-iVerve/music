import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { playMusicInfo } from '@renderer/store/player/state'
import Page from './index.vue'

/**
 * 歌曲详情页「打开播放详情页」入口的显隐（ui-polish-followups 工单 05）。
 *
 * 钉住三种状态下的**行为**（不是实现细节）：没在播 / 在播本页这首 / 在播另一首。
 * 第四种（在播的是本地文件）也补一条：本地歌曲的 `meta.songId` 是文件路径，不能被当成同一首。
 *
 * 取数链路全部 mock：真实的 `music.tx.songDetail` 要打 QQ 接口，本测试只关心「详情回来后入口显不显示」。
 * `setShowPlayerDetail` 也 mock —— 真身从 `store/player/action` → `core/player`，本测试不需要播放器。
 * 子组件用桩：工具栏 / 在线列表 / MV 弹窗 / 歌手选择菜单都与本票无关，别让它们把不在范围内的失败带进来。
 */
const mocks = vi.hoisted(() => {
  /** 路由要用**可变且响应式**的对象：有一条用例专门验「同路由换 mid 要重新取数」（工厂里再套 reactive） */
  const route: { query: { mid: string, source: string } } = { query: { mid: 'abc', source: 'tx' } }
  return {
    push: vi.fn(),
    back: vi.fn(),
    replace: vi.fn(),
    setShowPlayerDetail: vi.fn(),
    getDetail: vi.fn(),
    getProducer: vi.fn(),
    getSheetMusic: vi.fn(),
    dialog: vi.fn(),
    route,
  }
})

vi.mock('@common/utils/vueRouter', async() => {
  // 直接在裸对象上改属性不会触发 watch（没有经过代理的 set 陷阱），所以工厂里换成响应式代理，
  // 用例通过 mocks.route 改动即可驱动组件重取数。
  const { reactive } = await import('vue')
  mocks.route = reactive(mocks.route)
  return {
    useRoute: () => mocks.route,
    useRouter: () => ({ push: mocks.push, back: mocks.back, replace: mocks.replace }),
  }
})
vi.mock('@renderer/store/player/action', () => ({ setShowPlayerDetail: mocks.setShowPlayerDetail }))
vi.mock('@renderer/components/material/OnlineList/usePlay', () => ({ default: () => ({ handlePlayMusic: vi.fn() }) }))
vi.mock('@renderer/plugins/Dialog', () => ({ dialog: mocks.dialog }))
// 文案断言用 i18n 的 key（`$t` 桩直通 key）：钉的是「哪一条文案」，措辞改了不会误伤
vi.mock('@renderer/plugins/i18n', () => ({ i18nPlugin: { install() {} }, useI18n: () => (key: string) => key }))
vi.mock('@renderer/utils/musicSdk', () => ({
  default: {
    tx: {
      songDetail: {
        getDetail: mocks.getDetail,
        getSimilarSongs: vi.fn(async() => []),
        getOtherVersions: vi.fn(async() => []),
        getRelatedPlaylists: vi.fn(async() => []),
        getRelatedMv: vi.fn(async() => []),
        getProducer: mocks.getProducer,
        getSheetMusic: mocks.getSheetMusic,
      },
      getAlbumDetailPageUrl: () => '',
    },
  },
}))

const ENTRY_TEXT = 'song_detail__open_play_detail'
const PRODUCER_TITLE = 'song_detail__producers'
const SHEET_TITLE = 'song_detail__sheets'

/** 曲谱弹窗的桩：**只验父组件递给它哪一条、有没有收起**（弹窗自身的渲染不在本文件范围）。
 *  真组件的 `sheet` 是非空 prop（父组件 `v-if` 兜，见票 04），桩里照此写。 */
const SheetMusicModalStub = {
  name: 'SheetMusicModal',
  props: ['show', 'sheet'],
  template: '<div v-if="show" class="sheet-modal">{{ sheet.name }}</div>',
}

const stubs = {
  'common-toolbar-actions': { template: '<div><slot /></div>' },
  'base-btn': { template: '<button><slot /></button>' },
  'material-online-list': { template: '<div />' },
  'mv-player-modal': { template: '<div />' },
  'base-menu': { template: '<div />' },
  'sheet-music-modal': SheetMusicModalStub,
}

const txMusic = (songId: string): LX.Music.MusicInfoOnline => ({
  id: `tx_${songId}`,
  name: '歌名',
  singer: '歌手',
  source: 'tx',
  interval: '03:00',
  meta: { songId, albumName: '专辑', qualitys: [], _qualitys: {}, strMediaMid: '' },
})

const localMusic = (filePath: string): LX.Music.MusicInfoLocal => ({
  id: `local_${filePath}`,
  name: '本地歌',
  singer: '歌手',
  source: 'local',
  interval: '03:00',
  meta: { songId: filePath, albumName: '', filePath, ext: 'mp3' },
})

const mountPage = () => mount(Page, {
  global: { stubs, mocks: { $t: (key: string) => key } },
})
/** 详情是异步取回来的，入口的显隐要看它落地之后的渲染结果 */
const mountDetailPage = async() => {
  const wrapper = mountPage()
  await flushPromises()
  return wrapper
}

/** 两个 describe 共用的起点：没在播 + 同一条详情 + 制作人/曲谱两个新块没有资料 */
beforeEach(() => {
  // 用例间会串：每个用例都从「什么都没在播」起步
  playMusicInfo.musicInfo = null
  mocks.route.query.mid = 'abc'
  vi.clearAllMocks()
  mocks.getProducer.mockResolvedValue([])
  mocks.getSheetMusic.mockResolvedValue([])
  mocks.getDetail.mockResolvedValue({
    // songmid 才是 mid（本页身份）；trackRaw.id = 0 → 四个关联块不再发请求，本用例组不关心它们
    track: { songmid: 'abc', name: '歌名', singer: '歌手', albumMid: '', albumName: '', img: '', interval: '03:00' },
    trackRaw: { singer: [{ mid: 's1', name: '歌手' }], id: 0, type: 0 },
    desc: '',
    info: { company: '', genre: '', lan: '', pubTime: '' },
  })
})

/** 某个块的文本：按块的标题找 `<section>`（页面级 `wrapper.text()` 会串进别的块的 `no_item`） */
const sectionText = (wrapper: { findAll: (s: string) => Array<{ text: () => string }> }, title: string) =>
  wrapper.findAll('section').find(node => node.text().includes(title))?.text() ?? ''

const SHEET_ITEM = {
  id: 'score1',
  name: '晴天钢琴谱',
  subName: '',
  instrument: '钢琴',
  scoreType: '五线谱',
  cover: 'https://img/cover.png',
  images: ['https://img/1.jpg', 'https://img/2.jpg'],
  pageCount: 2,
}

describe('views/SongDetail/index.vue 的制作人块与曲谱块', () => {
  it('制作人：有数据时渲染职责分组与姓名，`演唱` 组不在块里重抄（头部已有歌手名）', async() => {
    mocks.getProducer.mockResolvedValue([
      { title: '演唱', producers: [{ name: '周杰伦', icon: '', singerMid: 's1' }] },
      { title: '编曲', producers: [{ name: '钟兴民', icon: 'https://img/1.jpg', singerMid: '' }] },
    ])
    const wrapper = await mountDetailPage()

    expect(wrapper.text()).toContain(PRODUCER_TITLE)
    expect(wrapper.text()).toContain('编曲')
    expect(wrapper.text()).toContain('钟兴民')
    // 组标题 `演唱` 只可能来自这一块（头部那行是歌手名 `歌手`），所以整页文本都不该出现它
    expect(wrapper.text()).not.toContain('演唱')
    wrapper.unmount()
  })

  it('制作人：没有数据时整块不渲染（连标题都不出现，不留空标题占位）', async() => {
    mocks.getProducer.mockResolvedValue([])
    const wrapper = await mountDetailPage()

    expect(wrapper.text()).not.toContain(PRODUCER_TITLE)
    wrapper.unmount()
  })

  it('制作人：接口失败只清空、不落文案（这块没有空态），也不拖累其它块', async() => {
    mocks.getProducer.mockRejectedValue(new Error('boom'))
    const wrapper = await mountDetailPage()

    expect(wrapper.text()).not.toContain(PRODUCER_TITLE)
    // 详情块照常渲染（失败是这一块自己的事）
    expect(wrapper.text()).toContain('song_detail__info')
    wrapper.unmount()
  })

  it('曲谱：有数据时卡片带名称与乐器，点卡片把这一条递给弹窗，关闭后弹窗收起', async() => {
    mocks.getSheetMusic.mockResolvedValue([SHEET_ITEM])
    const wrapper = await mountDetailPage()

    expect(wrapper.text()).toContain(SHEET_TITLE)
    expect(wrapper.text()).toContain('晴天钢琴谱')
    expect(wrapper.text()).toContain('钢琴')
    // 没点之前弹窗是收起的（桩里的 `.sheet-modal` 只在 show 为真时渲染）
    expect(wrapper.find('.sheet-modal').exists()).toBe(false)

    const card = wrapper.findAll('li').find(node => node.text().includes('晴天钢琴谱'))
    await card!.trigger('click')
    expect(wrapper.find('.sheet-modal').text()).toBe('晴天钢琴谱')

    await wrapper.findComponent(SheetMusicModalStub).vm.$emit('close')
    expect(wrapper.find('.sheet-modal').exists()).toBe(false)
    wrapper.unmount()
  })

  it('曲谱：没有曲谱时整块不渲染（标题与 no_item 都不出现）——票 03 的判据', async() => {
    mocks.getSheetMusic.mockResolvedValue([])
    const wrapper = await mountDetailPage()

    expect(sectionText(wrapper, SHEET_TITLE)).toBe('')
    expect(wrapper.text()).not.toContain(SHEET_TITLE)
    expect(wrapper.find('.sheet-modal').exists()).toBe(false)
    wrapper.unmount()
  })

  it('曲谱：接口失败落失败文案（不是空态，也不能整块静默消失），页面其它块照常', async() => {
    mocks.getSheetMusic.mockRejectedValue(new Error('boom'))
    const wrapper = await mountDetailPage()

    // 失败必须可见：标题 + 原因都在，且不能被伪装成「没有曲谱」
    const sheet = sectionText(wrapper, SHEET_TITLE)
    expect(sheet).toContain(SHEET_TITLE)
    expect(sheet).toContain('list__load_failed')
    expect(sheet).not.toContain('no_item')
    expect(wrapper.text()).toContain('song_detail__info')
    wrapper.unmount()
  })
})

describe('views/SongDetail/index.vue 的「打开播放详情页」入口', () => {
  it('什么都没在播时，入口不出现', async() => {
    const wrapper = await mountDetailPage()

    expect(wrapper.text()).not.toContain(ENTRY_TEXT)
    wrapper.unmount()
  })

  it('在播的是本页这首时入口出现，点开打开播放详情', async() => {
    playMusicInfo.musicInfo = txMusic('abc')
    const wrapper = await mountDetailPage()

    // 页面里可点的 `<p>` 不止它一个（歌手名也是），所以按文案取本入口
    const entry = wrapper.findAll('p').find(node => node.text() === ENTRY_TEXT)
    expect(entry).toBeTruthy()

    await entry!.trigger('click')
    expect(mocks.setShowPlayerDetail).toHaveBeenCalledWith(true)
    wrapper.unmount()
  })

  it('在播的是另一首时入口也不出现（点开看到的是别人，文案会骗人）', async() => {
    playMusicInfo.musicInfo = txMusic('other')
    const wrapper = await mountDetailPage()

    expect(wrapper.text()).not.toContain(ENTRY_TEXT)
    wrapper.unmount()
  })

  it('在播的是本地文件时入口不出现（本地 meta.songId 是文件路径，不是同一首）', async() => {
    playMusicInfo.musicInfo = localMusic('/music/abc.mp3')
    const wrapper = await mountDetailPage()

    expect(wrapper.text()).not.toContain(ENTRY_TEXT)
    wrapper.unmount()
  })

  it('同路由换 mid 会重新取数（否则 URL 换了、页面还是上一首）', async() => {
    // 2026-09-25 真机验收抓到的 bug：`/songDetail?mid=A` → `?mid=B` 是同组件复用，
    // setup 只跑一次，原来的 `if (mid.value) void load(mid.value)` 不会重取数。
    // 期望值来自「URL 与内容必须一致」这条用户可见契约。
    await mountDetailPage()
    expect(mocks.getDetail).toHaveBeenCalledWith('abc')

    mocks.getDetail.mockClear()
    mocks.route.query.mid = 'def'
    await flushPromises()
    expect(mocks.getDetail).toHaveBeenCalledWith('def')
  })
})
