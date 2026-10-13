import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { nextTick } from '@common/utils/vueTools'
import { playMusicInfo } from '@renderer/store/player/state'
import usePlayingSongMenu from './usePlayingSongMenu'

/**
 * 播放栏封面的右键菜单（2026-09-28）：替代上游「右击封面跳歌曲所在列表」那一下——
 * 用户报「莫名其妙的跳转」，要的是本仓统一的歌曲右键菜单。
 *
 * 这里只钉**接线**：右键时哪些项出现 / 灰掉（判据全部来自歌曲表那份：`useFavSong` /
 * `useMusicJump` / `assertApiSupport` / `hasDislike`），以及点下去把活儿派给谁。
 * 各依赖自身的正确性在它们自己的用例里（`useMusicJump.test.ts`、`store/utils.test.ts` 等）。
 * 「定位到所在列表」不在菜单里：那是 ControlBtns 准星键的活（工单 08），删跳转不等于删功能。
 *
 * `playMusicInfo` 用真 store（dom setup 里 `window.lxData` 齐备，同 ControlBtns.test.ts），
 * 其余外沿（路由 / 剪贴板 / 弹窗 / 音乐源 / 收藏 / 跳转 / 不喜欢）全桩掉。
 */
const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  clipboardWriteText: vi.fn(),
  openUrl: vi.fn(),
  confirm: vi.fn(),
  toggleFav: vi.fn(),
  loadFavState: vi.fn(),
  canFav: vi.fn(),
  favTitle: vi.fn(),
  assertApiSupport: vi.fn(),
  hasDislike: vi.fn(),
  addDislikeWithCloud: vi.fn(),
  playNext: vi.fn(),
  canJumpToAlbum: vi.fn(),
  canJumpToSinger: vi.fn(),
  canShareMusic: vi.fn(),
  jumpToAlbum: vi.fn(),
  jumpToSinger: vi.fn(),
  toSongDetail: vi.fn(),
  copyMusicLink: vi.fn(),
  openMusicInQqMusic: vi.fn(),
  handleSingerPickerClick: vi.fn(),
}))

vi.mock('@common/utils/vueRouter', () => ({ useRouter: () => ({ push: mocks.push }) }))
vi.mock('@common/utils/electron', () => ({
  clipboardWriteText: mocks.clipboardWriteText,
  openUrl: mocks.openUrl,
}))
vi.mock('@renderer/plugins/Dialog', () => ({ dialog: Object.assign(vi.fn(), { confirm: mocks.confirm }) }))
vi.mock('@renderer/plugins/i18n', () => ({ useI18n: () => (key: string) => key }))
// 菜单「歌曲详情」的显隐判据就是「源有没有 getMusicDetailPageUrl」：给 tx 有、local 没有（真实形状）
vi.mock('@renderer/utils/musicSdk', () => ({
  default: { tx: { getMusicDetailPageUrl: () => 'https://y.qq.com/n/yqq/song/x.html' } },
}))
vi.mock('@renderer/store/utils', () => ({ assertApiSupport: mocks.assertApiSupport }))
vi.mock('@renderer/core/dislikeList', () => ({ hasDislike: mocks.hasDislike, addDislikeWithCloud: mocks.addDislikeWithCloud }))
vi.mock('@renderer/core/player', () => ({ playNext: mocks.playNext }))
vi.mock('@renderer/utils/compositions/useFavSong', () => ({
  default: () => ({
    canFav: mocks.canFav,
    favTitle: mocks.favTitle,
    toggleFav: mocks.toggleFav,
    loadFavState: mocks.loadFavState,
  }),
}))
vi.mock('@renderer/utils/compositions/useMusicJump', () => ({
  default: () => ({
    canJumpToAlbum: mocks.canJumpToAlbum,
    canJumpToSinger: mocks.canJumpToSinger,
    canShareMusic: mocks.canShareMusic,
    jumpToAlbum: mocks.jumpToAlbum,
    jumpToSinger: mocks.jumpToSinger,
    toSongDetail: mocks.toSongDetail,
    copyMusicLink: mocks.copyMusicLink,
    openMusicInQqMusic: mocks.openMusicInQqMusic,
    // picker 那几个本文件只透传，不碰（多位歌手的挑选在 useMusicJump.test.ts 里钉）
    isShowSingerPicker: false,
    singerPickerXy: { x: 0, y: 0 },
    singerPickerMenus: () => [],
    handleSingerPickerClick: mocks.handleSingerPickerClick,
  }),
}))

const txMusic = (): any => ({
  id: 'tx_001',
  name: '歌名',
  singer: '歌手',
  source: 'tx',
  interval: '03:00',
  meta: { songId: 1, albumName: '专辑', qualitys: [], _qualitys: {}, strMediaMid: '' },
})

const localMusic = (): any => ({
  id: 'local_a',
  name: '本地歌',
  singer: '歌手',
  source: 'local',
  interval: '03:00',
  meta: { songId: '/music/a.mp3', albumName: '', filePath: '/music/a.mp3', ext: 'mp3' },
})

/** 可见菜单项的 action 序列（`hide` 是渲染层的 `v-show` 判据，同 base-menu） */
const visibleActions = (menus: any[]) => menus.filter(item => !item.hide).map(item => item.action)
const itemOf = (menus: any[], action: string) => menus.find(item => item.action == action)

describe('usePlayingSongMenu 的菜单项（当前播放这一首）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    playMusicInfo.musicInfo = null
    mocks.canFav.mockReturnValue(true)
    mocks.favTitle.mockReturnValue('list_add__cloud_fav')
    mocks.assertApiSupport.mockReturnValue(true)
    mocks.hasDislike.mockReturnValue(false)
    mocks.canJumpToAlbum.mockReturnValue(true)
    mocks.canJumpToSinger.mockReturnValue(true)
    mocks.canShareMusic.mockReturnValue(true)
  })

  it('在线歌：按歌曲表的顺序出现，收藏/下载/详情/跳转/分享都在', () => {
    playMusicInfo.musicInfo = txMusic()
    const { menus, showMenu, isShowSongMenu, menuLocation } = usePlayingSongMenu()

    showMenu({ pageX: 12, pageY: 34 })

    expect(isShowSongMenu.value).toBe(true)
    expect(menuLocation).toMatchObject({ x: 12, y: 34 })
    expect(visibleActions(menus.value)).toEqual([
      'fav', 'addTo', 'download', 'copyName', 'sourceDetail',
      'jumpAlbum', 'jumpSinger', 'copyLink', 'openInQq', 'search', 'dislike',
    ])
    expect(itemOf(menus.value, 'download')?.disabled).toBe(false)
    // 收藏态在 showMenu 时拉一次（同歌曲表的 showMenu）
    expect(mocks.loadFavState).toHaveBeenCalled()
  })

  it('本地文件：在线相关的项不出现，下载灰掉（assertApiSupport 为 true 也挡，判据含 != local）', () => {
    playMusicInfo.musicInfo = localMusic()
    mocks.canFav.mockReturnValue(false)
    mocks.canJumpToAlbum.mockReturnValue(false)
    mocks.canJumpToSinger.mockReturnValue(false)
    mocks.canShareMusic.mockReturnValue(false)
    const { menus, showMenu } = usePlayingSongMenu()

    showMenu({ pageX: 0, pageY: 0 })

    expect(visibleActions(menus.value)).toEqual(['addTo', 'download', 'copyName', 'search', 'dislike'])
    expect(itemOf(menus.value, 'download')?.disabled).toBe(true)
  })

  it('没有歌在播：右键不弹菜单（什么都不做）', () => {
    const { showMenu, isShowSongMenu } = usePlayingSongMenu()

    showMenu({ pageX: 0, pageY: 0 })

    expect(isShowSongMenu.value).toBe(false)
  })

  it('已在「不喜欢」里：dislike 项灰掉（同歌曲表）', () => {
    playMusicInfo.musicInfo = txMusic()
    mocks.hasDislike.mockReturnValue(true)
    const { menus, showMenu } = usePlayingSongMenu()

    showMenu({ pageX: 0, pageY: 0 })

    expect(itemOf(menus.value, 'dislike')?.disabled).toBe(true)
  })

  it('下载列表在播（progress 包装）：取里面的歌，菜单照常出', () => {
    playMusicInfo.musicInfo = {
      id: 'dl_1',
      progress: 0.5,
      metadata: { musicInfo: txMusic() },
    } as any
    const { menus, showMenu } = usePlayingSongMenu()

    showMenu({ pageX: 0, pageY: 0 })

    expect(visibleActions(menus.value)).toContain('fav')
    expect(visibleActions(menus.value)).toContain('sourceDetail')
  })
})

describe('usePlayingSongMenu 点下去派给谁', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    playMusicInfo.musicInfo = txMusic()
    mocks.canFav.mockReturnValue(true)
    mocks.favTitle.mockReturnValue('list_add__cloud_fav')
    mocks.assertApiSupport.mockReturnValue(true)
    mocks.hasDislike.mockReturnValue(false)
    mocks.canJumpToAlbum.mockReturnValue(true)
    mocks.canJumpToSinger.mockReturnValue(true)
    mocks.canShareMusic.mockReturnValue(true)
  })

  it('每次点击都先收起菜单', () => {
    const { showMenu, menuClick, isShowSongMenu } = usePlayingSongMenu()
    showMenu({ pageX: 0, pageY: 0 })

    menuClick({ action: 'copyName' })

    expect(isShowSongMenu.value).toBe(false)
  })

  it('fav → toggleFav（当前这一首）', () => {
    const { showMenu, menuClick } = usePlayingSongMenu()
    showMenu({ pageX: 0, pageY: 0 })

    menuClick({ action: 'fav' })

    expect(mocks.toggleFav).toHaveBeenCalledWith(playMusicInfo.musicInfo)
  })

  it('addTo / download → 开对应弹窗（下一拍开，让菜单先收）', async() => {
    const { showMenu, menuClick, isShowAddMusicTo, isShowDownload } = usePlayingSongMenu()
    showMenu({ pageX: 0, pageY: 0 })

    menuClick({ action: 'addTo' })
    menuClick({ action: 'download' })
    await nextTick()

    expect(isShowAddMusicTo.value).toBe(true)
    expect(isShowDownload.value).toBe(true)
  })

  it('copyName → 剪贴板（命名模板同下载命名）', () => {
    const { showMenu, menuClick } = usePlayingSongMenu()
    showMenu({ pageX: 0, pageY: 0 })

    menuClick({ action: 'copyName' })

    expect(mocks.clipboardWriteText).toHaveBeenCalledTimes(1)
    expect(String(mocks.clipboardWriteText.mock.calls[0][0])).toContain('歌名')
  })

  it('详情 / 跳专辑 / 复制链接 / 开 QQ 音乐 → 各自的 useMusicJump 入口', () => {
    const { showMenu, menuClick } = usePlayingSongMenu()
    showMenu({ pageX: 0, pageY: 0 })
    const minfo = playMusicInfo.musicInfo

    menuClick({ action: 'sourceDetail' })
    menuClick({ action: 'jumpAlbum' })
    menuClick({ action: 'copyLink' })
    menuClick({ action: 'openInQq' })

    expect(mocks.toSongDetail).toHaveBeenCalledWith(minfo)
    expect(mocks.jumpToAlbum).toHaveBeenCalledWith(minfo)
    expect(mocks.copyMusicLink).toHaveBeenCalledWith(minfo)
    expect(mocks.openMusicInQqMusic).toHaveBeenCalledWith(minfo)
  })

  it('jumpSinger → 带货架坐标（多位歌手的挑选菜单弹在菜单原位）', () => {
    const { showMenu, menuClick } = usePlayingSongMenu()
    showMenu({ pageX: 12, pageY: 34 })

    menuClick({ action: 'jumpSinger' })

    expect(mocks.jumpToSinger).toHaveBeenCalledWith(playMusicInfo.musicInfo, { pageX: 12, pageY: 34 })
  })

  it('search → 进搜索页（歌名 + 歌手）', () => {
    const { showMenu, menuClick } = usePlayingSongMenu()
    showMenu({ pageX: 0, pageY: 0 })

    menuClick({ action: 'search' })

    expect(mocks.push).toHaveBeenCalledWith({ path: '/search', query: { text: '歌名 歌手' } })
  })

  it('dislike → 先确认；确认后进名单并跳下一首（右键的就是正在播放的这首）', async() => {
    mocks.confirm.mockResolvedValue(true)
    // 菜单显示时还没进名单；addDislikeWithCloud 之后 hasDislike 为真 → 触发 playNext(true)
    mocks.hasDislike.mockReturnValueOnce(false).mockReturnValue(true)
    const { showMenu, menuClick } = usePlayingSongMenu()
    showMenu({ pageX: 0, pageY: 0 })

    menuClick({ action: 'dislike' })
    await flushPromises()

    expect(mocks.confirm).toHaveBeenCalled()
    expect(mocks.addDislikeWithCloud).toHaveBeenCalledWith(expect.objectContaining({ name: '歌名', singer: '歌手' }))
    expect(mocks.playNext).toHaveBeenCalledWith(true)
  })

  it('dislike 取消确认：什么都不做', async() => {
    mocks.confirm.mockResolvedValue(false)
    const { showMenu, menuClick } = usePlayingSongMenu()
    showMenu({ pageX: 0, pageY: 0 })

    menuClick({ action: 'dislike' })
    await flushPromises()

    expect(mocks.addDislikeWithCloud).not.toHaveBeenCalled()
    expect(mocks.playNext).not.toHaveBeenCalled()
  })

  it('菜单被点空白收起（item 为 null）：只收菜单，不派任何动作', () => {
    const { showMenu, menuClick, isShowSongMenu } = usePlayingSongMenu()
    showMenu({ pageX: 0, pageY: 0 })

    menuClick(null)

    expect(isShowSongMenu.value).toBe(false)
    expect(mocks.toggleFav).not.toHaveBeenCalled()
    expect(mocks.push).not.toHaveBeenCalled()
  })
})
