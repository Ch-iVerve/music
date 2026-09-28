import { beforeEach, describe, expect, it, vi } from 'vitest'
import useMusicJump from './useMusicJump'

/**
 * `useMusicJump.toSongDetail`（ui-polish-followups 工单 03）。
 *
 * 三个列表的同名菜单项（`list__source_detail`）现在共用这一个入口，所以这里钉住的就是三处共用的判据：
 * 在线歌曲进**本仓**的 `/songDetail`（带 source 与 mid），本地文件与「没有在线 mid」的行什么都不做。
 * 原来三处各写一套，于是漂移成「一处进本仓页面、一处开 QQ 网页」（用户报的就是这个）。
 *
 * 路由与外部依赖全部 mock：本测试只关心跳转参数，不关心页面渲染与请求。
 */
const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  setShowPlayerDetail: vi.fn(),
}))

vi.mock('@common/utils/vueRouter', () => ({ useRouter: () => ({ push: mocks.push }) }))
vi.mock('@renderer/store/player/action', () => ({ setShowPlayerDetail: mocks.setShowPlayerDetail }))
vi.mock('@common/utils/electron', () => ({ openUrl: vi.fn(), clipboardWriteText: vi.fn() }))
vi.mock('@renderer/plugins/Dialog', () => ({ dialog: vi.fn() }))
vi.mock('@renderer/plugins/i18n', () => ({ useI18n: () => (key: string) => key }))
vi.mock('@renderer/utils/musicSdk', () => ({
  default: {
    tx: {
      getMusicDetailPageUrl: () => 'https://y.qq.com/n/yqq/song/x.html',
      getAlbumDetailPageUrl: () => '',
    },
  },
}))

const txMusic = (songId: string | number): LX.Music.MusicInfoOnline => ({
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

describe('utils/compositions/useMusicJump 的歌曲详情跳转', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('在线歌曲：进本仓 /songDetail，mid 取 meta.songId（不是网页链接）', () => {
    const { toSongDetail } = useMusicJump()

    toSongDetail(txMusic('001Qu4J42yg8uu'))

    expect(mocks.push).toHaveBeenCalledWith({
      path: '/songDetail',
      query: { source: 'tx', mid: '001Qu4J42yg8uu' },
    })
  })

  it('本地文件：不跳（meta.songId 是文件路径，没有在线 mid）', () => {
    const { toSongDetail } = useMusicJump()

    toSongDetail(localMusic('/music/song.mp3'))

    expect(mocks.push).not.toHaveBeenCalled()
  })

  it('取不到 mid（空串）与空对象：都不跳，而不是跳进一个进不去的页面', () => {
    const { toSongDetail } = useMusicJump()

    toSongDetail({ ...txMusic(''), meta: { ...txMusic('').meta, songId: '' } })
    toSongDetail(null)

    expect(mocks.push).not.toHaveBeenCalled()
  })
})

/**
 * 跳转前收播放详情页（2026-09-28 报的 bug）：播放详情页是盖在路由之上的全屏覆盖层，
 * 不先收起来，push 只是把歌手页/专辑页换在底下、被播放页盖住。收法钉在三个跳转原语里
 * （所有真实 push 的必经点），所以这里钉住的是原语行为：会 push 的路径先收，不 push 的
 * 路径（本地文件、多歌手弹菜单）不收——菜单还得弹在详情页上。
 */
describe('utils/compositions/useMusicJump 的跳转前收播放详情页', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('歌手页 / 专辑页 / 歌曲详情：先收详情页，再 push', () => {
    // toSinger/toAlbum 是内部原语，从公开入口走：单歌手走 jumpToSingerList，专辑走 jumpToAlbum
    const { jumpToSingerList, jumpToAlbum, toSongDetail } = useMusicJump()

    jumpToSingerList([{ mid: 'a1b2', name: '甲' }])
    jumpToAlbum({ ...txMusic('001Qu4J42yg8uu'), meta: { ...txMusic('001Qu4J42yg8uu').meta, albumMid: 'c3d4' } })
    toSongDetail(txMusic('001Qu4J42yg8uu'))

    expect(mocks.setShowPlayerDetail).toHaveBeenCalledTimes(3)
    expect(mocks.setShowPlayerDetail).toHaveBeenNthCalledWith(1, false)
    expect(mocks.setShowPlayerDetail).toHaveBeenNthCalledWith(2, false)
    expect(mocks.setShowPlayerDetail).toHaveBeenNthCalledWith(3, false)
    // 收的动作必须发生在每次 push 之前，否则就是「换了页但被盖住」的原样
    const pushOrder = mocks.push.mock.invocationCallOrder
    const hideOrder = mocks.setShowPlayerDetail.mock.invocationCallOrder
    expect(hideOrder[0]).toBeLessThan(pushOrder[0])
    expect(hideOrder[1]).toBeLessThan(pushOrder[1])
    expect(hideOrder[2]).toBeLessThan(pushOrder[2])
  })

  it('守卫不通过（本地文件）：不跳也不收——详情页还得停在原地弹失败提示', () => {
    const { toSongDetail } = useMusicJump()

    toSongDetail(localMusic('/music/song.mp3'))

    expect(mocks.push).not.toHaveBeenCalled()
    expect(mocks.setShowPlayerDetail).not.toHaveBeenCalled()
  })

  it('多歌手：弹选择菜单不跳不收；挑中某位才收详情页并进歌手页', () => {
    const { jumpToSingerList, isShowSingerPicker, handleSingerPickerClick } = useMusicJump()

    jumpToSingerList([{ mid: 's1', name: '甲' }, { mid: 's2', name: '乙' }])

    expect(isShowSingerPicker.value).toBe(true)
    expect(mocks.push).not.toHaveBeenCalled()
    expect(mocks.setShowPlayerDetail).not.toHaveBeenCalled()

    handleSingerPickerClick({ action: 's2' })

    expect(isShowSingerPicker.value).toBe(false)
    expect(mocks.push).toHaveBeenCalledWith({ path: '/singer', query: { mid: 's2' } })
    expect(mocks.setShowPlayerDetail).toHaveBeenCalledWith(false)
    expect(mocks.setShowPlayerDetail.mock.invocationCallOrder[0]).toBeLessThan(mocks.push.mock.invocationCallOrder[0])
  })
})
