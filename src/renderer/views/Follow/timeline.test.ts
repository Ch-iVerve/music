import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FeedTimeline from './components/FeedTimeline.vue'
import type * as PlayerCore from '@renderer/core/player'
import { FOLLOW_FEED_QUEUE_ID } from '@renderer/utils/queueIds'

/**
 * 时间线行上的交互（dom project）——**接线**用例，算法不在这一层：
 * 队列怎么装、点哪首从哪首开始是 `material/OnlineList/usePlay` 的实现（本页不改它，只传对参数）。
 *
 * 钉五件事：
 *   1. 点歌曲行 → 以**本页全部歌曲行**（按时间线顺序）为队列、从被点那首开始播；
 *   2. 专辑行**点了不播**（它的播放载荷是 null，不造假载荷）；点专辑名进专辑页；
 *   3. 点歌手名 = 跳歌手页（`/singer?mid=…`），**且不会顺带触发整行的播放**（`.stop`）；
 *   4. 行右键 → 在线歌曲表那套菜单（播放 / 稍后播放 / 添加到… / 复制链接…），菜单里点播放也播；
 *   5. 专辑行右键 → 打开专辑 / 复制专辑链接 / 在 QQ 音乐打开，点「打开专辑」进专辑页。
 *
 * 走真件：`usePlay`（只桩掉它的终点 `core/player.playMusicList`）、`useMenu` 的菜单构建、
 * `useMusicJump` 的跳转（`useRouter` 桩起来断言参数）。播放载荷按 `core/followFeed/diff.ts`
 * 落库的形状给（`toNewMusicInfo` 的 JSON）。
 */
const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  playMusicList: vi.fn(),
}))

vi.mock('@common/utils/vueRouter', () => ({
  useRouter: () => ({ push: mocks.push, replace: vi.fn(), back: vi.fn() }),
  useRoute: () => ({ path: '/follow', query: {} }),
}))
// 只换掉终点（真实现会灌临时列表 + 起播，要音频与一堆 store）；其余导出保持原样
vi.mock('@renderer/core/player', async(importOriginal) => ({
  ...await importOriginal<typeof PlayerCore>(),
  playMusicList: mocks.playMusicList,
}))
// 「我喜欢」的菜单项一构建就会 `loadFavState()`（真实现会去拉 QQ 云端的收藏 id 集合，
// 测试里必然「未登录」并打一行 console）——本文件不测它，桩掉保持测试安静、也不碰网络
vi.mock('@renderer/utils/compositions/useFavSong', () => ({
  default: () => ({
    canFav: () => true,
    favTitle: () => 'fav',
    toggleFav: vi.fn(),
    loadFavState: vi.fn(),
  }),
}))

/** `base-menu` 替身：真件 teleport 到 #root（jsdom 里没有那个锚点），这里渲染出项名与 action */
const BaseMenuStub = {
  name: 'MenuToolBar',
  props: {
    modelValue: { type: Boolean, default: false },
    menus: { type: Array, default: () => [] },
    xy: { type: Object, default: () => ({}) },
    itemName: { type: String, default: 'name' },
  },
  emits: ['update:modelValue', 'menu-click'],
  template: `<ul v-if="modelValue" class="menu-stub">
    <li v-for="menu in menus" :key="menu.action" :data-action="menu.action" @click="$emit('menu-click', menu)">{{ menu.name }}</li>
  </ul>`,
}

const $t = (key: string) => key

/** 播放载荷：`toNewMusicInfo` 的输出（新式歌曲对象） */
const musicOf = (songmid: string, name: string) => JSON.stringify({
  id: `tx_${songmid}`,
  name,
  singer: '歌手甲',
  source: 'tx',
  interval: '03:00',
  meta: { songId: songmid, albumMid: 'album-mid-1', qualitys: [], _qualitys: {} },
})

/** 一条条目（形状见 `common/types/follow_feed.d.ts`） */
const item = (over: Partial<LX.FollowFeed.Item>): LX.FollowFeed.Item => ({
  id: 1,
  kind: 'song',
  singerMid: 'mid-a',
  singerName: '歌手甲',
  itemId: 'tx_s1',
  name: '新歌一',
  albumMid: null,
  albumName: null,
  trackCount: null,
  publishTime: '2026-09-20',
  foundAt: 1758300000000,
  read: 1,
  music: musicOf('s1', '新歌一'),
  ...over,
})

/** 时间线：歌(1) → 专(2) → 歌(3)；可播队列应当是 [歌1, 歌3] */
const items = () => [
  item({ id: 1, name: '新歌一', itemId: 'tx_s1', music: musicOf('s1', '新歌一') }),
  item({
    id: 2,
    kind: 'album',
    itemId: 'album-mid-2',
    name: '专辑二',
    singerName: '歌手乙',
    singerMid: 'mid-b',
    albumMid: 'album-mid-2',
    albumName: '专辑二',
    trackCount: 12,
    publishTime: '2026-09-18',
    music: null,
  }),
  item({ id: 3, name: '新歌三', itemId: 'tx_s3', music: musicOf('s3', '新歌三') }),
]

const mountTimeline = (list = items()) => mount(FeedTimeline, {
  props: { items: list, freshIds: [] },
  global: {
    stubs: { 'base-menu': BaseMenuStub, 'common-list-add-modal': true, 'common-download-modal': true },
    mocks: { $t },
  },
})

/** 点一行（`contextmenu` 打开菜单是右键，别和左键搞混） */
const rightClick = async(wrapper: ReturnType<typeof mountTimeline>, index: number) => {
  await wrapper.findAll('li')[index].trigger('contextmenu')
  await flushPromises()
}

enableAutoUnmount(afterEach)

beforeEach(() => {
  vi.clearAllMocks()
  mocks.playMusicList.mockResolvedValue(undefined)
})

describe('关注动态：时间线的行交互', () => {
  it('点歌曲行：队列 = 本页全部歌曲行（按顺序），从被点那首开始', async() => {
    const wrapper = mountTimeline()
    const rows = wrapper.findAll('li')

    await rows[0].trigger('click')
    expect(mocks.playMusicList).toHaveBeenCalledTimes(1)
    expect(mocks.playMusicList).toHaveBeenCalledWith(FOLLOW_FEED_QUEUE_ID, [
      expect.objectContaining({ id: 'tx_s1' }),
      expect.objectContaining({ id: 'tx_s3' }),
    ], 0)

    // 第三行（队列里的第 2 首）——专辑行不占队列位置
    mocks.playMusicList.mockClear()
    await wrapper.findAll('li')[2].trigger('click')
    expect(mocks.playMusicList).toHaveBeenCalledWith(FOLLOW_FEED_QUEUE_ID, [
      expect.objectContaining({ id: 'tx_s1' }),
      expect.objectContaining({ id: 'tx_s3' }),
    ], 1)
  })

  it('专辑行：点行不播（播放走展开区），点专辑名进专辑页', async() => {
    const wrapper = mountTimeline()
    const albumRow = wrapper.findAll('li')[1]

    await albumRow.trigger('click')
    expect(mocks.playMusicList).not.toHaveBeenCalled()

    await albumRow.find('[aria-label="专辑二"]').trigger('click')
    expect(mocks.push).toHaveBeenCalledWith({ path: '/album', query: { mid: 'album-mid-2' } })
    expect(mocks.playMusicList).not.toHaveBeenCalled()
  })

  it('专辑行带歌曲载荷：点行展开出本簇歌曲，点一首 = 以专辑为队列从那首播（不出页）', async() => {
    const albumSongs = [
      { id: 'tx_alb_song1', name: '专辑歌一', singer: '歌手乙', source: 'tx', interval: '03:00', meta: { songId: 'a1', albumMid: 'album-mid-2', qualitys: [], _qualitys: {} } },
      { id: 'tx_alb_song2', name: '专辑歌二', singer: '歌手乙', source: 'tx', interval: '03:00', meta: { songId: 'a2', albumMid: 'album-mid-2', qualitys: [], _qualitys: {} } },
    ]
    const list = [
      item({ id: 1, name: '新歌一', itemId: 'tx_s1', music: musicOf('s1', '新歌一') }),
      item({
        id: 2,
        kind: 'album',
        itemId: 'album-mid-2',
        name: '专辑二',
        singerName: '歌手乙',
        singerMid: 'mid-b',
        albumMid: 'album-mid-2',
        albumName: '专辑二',
        trackCount: 2,
        publishTime: '2026-09-18',
        music: JSON.stringify(albumSongs),
      }),
    ]
    const wrapper = mountTimeline(list)
    const albumRow = wrapper.findAll('li')[1]

    // 点行 = 展开：本簇两首都渲染出来（时间线里的歌曲行不会混进来）
    expect(wrapper.find('ul').findAll('li').length).toBeLessThan(3)
    await albumRow.trigger('click')
    const songRows = albumRow.findAll('li')
    expect(songRows).toHaveLength(2)
    expect(songRows[0].text()).toContain('专辑歌一')

    // 点展开区第一首：队列 = 专辑内歌曲（listId 带专辑行 id），从那首开始
    await songRows[0].trigger('click')
    expect(mocks.playMusicList).toHaveBeenCalledTimes(1)
    expect(mocks.playMusicList.mock.calls[0][0]).toBe('follow_feed__album_2')
    expect(mocks.playMusicList.mock.calls[0][1]).toHaveLength(2)
    expect(mocks.playMusicList.mock.calls[0][2]).toBe(0)
  })

  it('点歌手名进歌手页（用条目自带的 mid，不请求接口），且不顺带播整行', async() => {
    const wrapper = mountTimeline()
    const songRow = wrapper.findAll('li')[0]

    await songRow.find('[aria-label="歌手甲"]').trigger('click')

    expect(mocks.push).toHaveBeenCalledWith({ path: '/singer', query: { mid: 'mid-a' } })
    // `.stop` 的意义：点名字是跳转，不该把整行的「播放」也带出来
    expect(mocks.playMusicList).not.toHaveBeenCalled()
  })

  it('歌曲行右键：出行菜单（在线歌曲表那套），菜单里点播放也以本页歌曲行为队列', async() => {
    const wrapper = mountTimeline()
    await rightClick(wrapper, 2)

    const actions = wrapper.findAll('.menu-stub [data-action]').map(item => item.attributes('data-action'))
    // 工单要求的几项都在（播放 / 我喜欢 / 稍后播放 / 添加到… / 复制链接）
    expect(actions).toEqual(expect.arrayContaining(['play', 'fav', 'playLater', 'addTo', 'copyLink']))
    // 专辑行没有的项（跳转专辑）在歌曲行上要有——它就是在线歌曲表那一套
    expect(actions).toContain('jumpAlbum')

    await wrapper.find('.menu-stub [data-action="play"]').trigger('click')
    expect(mocks.playMusicList).toHaveBeenCalledWith(FOLLOW_FEED_QUEUE_ID, [
      expect.objectContaining({ id: 'tx_s1' }),
      expect.objectContaining({ id: 'tx_s3' }),
    ], 1)
  })

  it('专辑行右键：菜单是专辑那三项，点「打开专辑」进专辑页', async() => {
    const wrapper = mountTimeline()
    await rightClick(wrapper, 1)

    const actions = wrapper.findAll('.menu-stub [data-action]').map(item => item.attributes('data-action'))
    expect(actions).toEqual(['open', 'copy', 'openInQq'])
    // 歌曲表那套菜单没被带出来（两个菜单互斥）
    expect(actions).not.toContain('play')

    await wrapper.find('.menu-stub [data-action="open"]').trigger('click')
    expect(mocks.push).toHaveBeenCalledWith({ path: '/album', query: { mid: 'album-mid-2' } })
  })
})

describe('关注动态：时间线的结构（2026-09-27 视觉重做）', () => {
  it('按发布周分组（周一为起点）：同周归一组、跨周分组、组内保持原有顺序（不重排）', () => {
    // 2026-09-20（周日）与 09-18（周五）同属 09.14–09.20 周；08-30 属 08.24–08.30 周
    const list = [
      item({ id: 1, name: '九月歌一', publishTime: '2026-09-20' }),
      item({ id: 2, kind: 'album', itemId: 'album-mid-2', name: '九月专', albumMid: 'album-mid-2', albumName: '九月专', trackCount: 3, publishTime: '2026-09-18', music: null }),
      item({ id: 3, name: '八月歌', publishTime: '2026-08-30' }),
    ]
    const wrapper = mountTimeline(list)

    expect(wrapper.findAll('h3')).toHaveLength(2)
    // 条目按发布时间倒序进来，分组只是相邻归拢，顺序不变
    const names = wrapper.findAll('li').map(node => node.text())
    expect(names[0]).toContain('九月歌一')
    expect(names[1]).toContain('九月专')
    expect(names[2]).toContain('八月歌')
  })

  it('封面按 albumMid 拼 QQ 音乐静态图 URL；没有 mid 的行不渲染 img（画底色占位，不是破损图标）', () => {
    const wrapper = mountTimeline()
    const covers = wrapper.findAll('img')
    expect(covers).toHaveLength(1)
    expect(covers[0].attributes('src')).toBe('https://y.gtimg.cn/music/photo_new/T002R300x300M000album-mid-2.jpg')
    // 歌行（albumMid 为 null）渲染占位块
    const placeholders = wrapper.findAll('li').filter(row => !row.find('img').exists())
    expect(placeholders).toHaveLength(2)
  })

  it('「本次新增」的表达收在时间轴节点上：fresh 行节点亮主色并带 title，已读行空心', () => {
    const wrapper = mount(FeedTimeline, {
      props: { items: items(), freshIds: [3] },
      global: {
        stubs: { 'base-menu': BaseMenuStub, 'common-list-add-modal': true, 'common-download-modal': true },
        mocks: { $t },
      },
    })

    // CSS modules 会给类名加 hash 后缀，按子串匹配
    const dots = wrapper.findAll('li').map(node => node.find('span'))
    expect(dots[0].classes().some(name => name.includes('dotFresh'))).toBe(false)
    expect(dots[2].classes().some(name => name.includes('dotFresh'))).toBe(true)
    expect(dots[2].attributes('title')).toBe('follow__fresh')
    expect(dots[0].attributes('title')).toBe('')
  })
})
