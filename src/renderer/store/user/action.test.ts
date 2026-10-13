import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cloudListSongs, createdLists, favAlbumIds, favAlbums, favLists, favPlaylistIds, favSongIds, favSongIdsLoaded, favSongs, followSingers, isInited, labels, musicGene, pagers, profile, vip,
} from './state'
import {
  addDislikedSongToCloud, addFavSongToCloud, canFavSongInCloud, createCloudList, isFavSongInCloud, loadMoreFavAlbums, loadMoreFavLists, loadMoreFollowSingers, loadMoreFavSongs, reloadCreatedLists, removeCloudList, removeFavAlbumFromList, removeFavListFromList, removeFavSongFromCloud, resetUserCenter, toggleFavSongToCloud,
} from './action'

/**
 * 「我喜欢」一键切换的**动作方向**（ui-polish-3 工单 06）。
 *
 * 真机要求是「按照具体的状态」：已在我喜欢里 → 移除，不在 → 加入。这条判据只有一处
 * （`toggleFavSongToCloud`），行内心形键 / 右键菜单 / 播放栏三个入口都走它，所以在这里钉住：
 *   1. 两个方向各走各的写接口，且**只**走一个；
 *   2. 收藏态还没加载时**先拉全量 id 再决定**——否则界面上那份文案还没到位，点下去会走反方向
 *      （该移除的又收藏一遍）；
 *   3. 拉不到（未登录）时不写任何东西，把错抛给调用方去弹「请先登录 QQ 音乐」。
 *
 * 只把最外层 SDK 换成桩，store 与状态写回都是真的。
 */

const { likeSong, unlikeSong, getFavSongIds, getFavSonglist, getFavAlbum, getFollowSingers, getFavSong, getCreatedSonglist, createList, removeList, addDislikedSongs, setFavAlbum, setFavPlaylist } = vi.hoisted(() => ({
  likeSong: vi.fn(),
  unlikeSong: vi.fn(),
  getFavSongIds: vi.fn(),
  getFavSonglist: vi.fn(),
  getFavAlbum: vi.fn(),
  getFollowSingers: vi.fn(),
  getFavSong: vi.fn(),
  getCreatedSonglist: vi.fn(),
  createList: vi.fn(),
  removeList: vi.fn(),
  addDislikedSongs: vi.fn(),
  setFavAlbum: vi.fn(),
  setFavPlaylist: vi.fn(),
}))

vi.mock('@renderer/utils/musicSdk', () => ({
  default: {
    tx: {
      songList: { likeSong, unlikeSong, createList, removeList, setFavPlaylist },
      user: { getFavSongIds, getFavSonglist, getFavAlbum, getFollowSingers, getFavSong, getCreatedSonglist },
      dislike: { addDislikedSongs },
      album: { setFavAlbum },
    },
  },
}))

/** 在线歌曲对象：QQ 的 songId/songType 在 meta 里（见 common/utils/tools.ts 的映射） */
const song = (id: string) => ({
  id: `tx_${id}`,
  name: '歌名',
  singer: '歌手',
  source: 'tx',
  interval: '03:00',
  meta: { id, songType: 0 },
}) as any

beforeEach(() => {
  vi.clearAllMocks()
  favSongIds.splice(0, favSongIds.length)
  favSongIdsLoaded.value = false
  // total 归零 = 「我收藏的歌曲」列表还没加载过：写成功后的就地更新不会动它
  // （本组用例只关心收藏态与写接口；列表就地更新那组会自己把 total 与列表铺好）
  favSongs.total = 0
  favSongs.list.splice(0, favSongs.list.length)
  getFavSongIds.mockResolvedValue([])
  likeSong.mockResolvedValue(true)
  unlikeSong.mockResolvedValue(true)
})

describe('store/user/action 的 toggleFavSongToCloud', () => {
  it('不在我喜欢里 → 加入（走 likeSong，不碰 unlikeSong），返回 true', async() => {
    await expect(toggleFavSongToCloud(song('1'))).resolves.toBe(true)

    expect(likeSong).toHaveBeenCalledTimes(1)
    expect(likeSong).toHaveBeenCalledWith([{ songId: 1, songType: 0 }])
    expect(unlikeSong).not.toHaveBeenCalled()
  })

  it('已在我喜欢里 → 移除（走 unlikeSong，不碰 likeSong），返回 false', async() => {
    favSongIds.push('1')
    favSongIdsLoaded.value = true

    await expect(toggleFavSongToCloud(song('1'))).resolves.toBe(false)

    expect(unlikeSong).toHaveBeenCalledTimes(1)
    expect(unlikeSong).toHaveBeenCalledWith([{ songId: 1, songType: 0 }])
    expect(likeSong).not.toHaveBeenCalled()
  })

  it('收藏态还没加载 → 先拉全量 id 再决定方向（不会点反）', async() => {
    // 服务端说这首已经在我喜欢里，但本地还没拉过（favSongIdsLoaded=false）
    getFavSongIds.mockResolvedValue(['1'])

    await toggleFavSongToCloud(song('1'))

    expect(getFavSongIds).toHaveBeenCalledTimes(1)
    expect(unlikeSong).toHaveBeenCalledTimes(1)
    expect(likeSong).not.toHaveBeenCalled()
  })

  it('拉不到收藏态（未登录）→ 抛给调用方，且一个写接口都不发', async() => {
    getFavSongIds.mockRejectedValue(new Error('QQ 音乐未登录'))

    await expect(toggleFavSongToCloud(song('1'))).rejects.toThrow('QQ 音乐未登录')

    expect(likeSong).not.toHaveBeenCalled()
    expect(unlikeSong).not.toHaveBeenCalled()
  })
})

/**
 * 写失败必须**带着 QQ 的错误码**抛出来（工单 09）。
 *
 * 真机症状是「点了没加也没移」——旧实现失败只回一个 false，`code`/`retCode`/`msg` 全被丢掉，
 * 弹窗只剩一句「添加失败」，用户贴回来也看不出是哪一步被拒。判据与文案收在
 * `isWriteOk` / `writeFailText` 两处（纯函数），这里连同旧形状（布尔）一起钉住。
 */
describe('store/user/action 的写失败诊断', () => {
  it('SDK 回诊断结构且 not ok → 抛出的文案带上 code / retCode / msg', async() => {
    favSongIdsLoaded.value = true
    likeSong.mockResolvedValue({ ok: false, code: 10006, retCode: 80092, msg: 'song not exist' })

    await expect(addFavSongToCloud(song('1'))).rejects.toThrow(/code=10006/)
    await expect(addFavSongToCloud(song('1'))).rejects.toThrow(/retCode=80092/)
    await expect(addFavSongToCloud(song('1'))).rejects.toThrow(/song not exist/)
    // 失败不能就地改收藏态（改了就成假成功）
    expect(favSongIds.includes('1')).toBe(false)
  })

  it('取消喜欢失败同理（带码抛给调用方）', async() => {
    favSongIdsLoaded.value = true
    unlikeSong.mockResolvedValue({ ok: false, code: null, retCode: 80092, msg: '' })

    await expect(removeFavSongFromCloud(song('1'))).rejects.toThrow(/retCode=80092/)
  })

  it('**被拒但 retCode 是 0**（真机实测形状 `code: 80105`）→ 照样抛，且不改收藏态', async() => {
    // 2026-09-24 真机实测：服务端拒绝时 `code: 80105` 而 `data.retCode: 0`。
    // SDK 两条都判之后这里才是 ok:false；store 这一层要保证「retCode 0」不能让它当成功放行。
    favSongIdsLoaded.value = true
    likeSong.mockResolvedValue({ ok: false, code: 80105, retCode: 0, msg: '' })

    await expect(addFavSongToCloud(song('1'))).rejects.toThrow(/code=80105/)
    expect(favSongIds.includes('1')).toBe(false)

    unlikeSong.mockResolvedValue({ ok: false, code: 80105, retCode: 0, msg: '' })
    favSongIds.push('1')
    await expect(removeFavSongFromCloud(song('1'))).rejects.toThrow(/code=80105/)
    expect(favSongIds.includes('1')).toBe(true)
  })

  it('旧形状（SDK 回布尔 true）仍然算成功——契约没收窄', async() => {
    likeSong.mockResolvedValue(true)

    await expect(addFavSongToCloud(song('1'))).resolves.toBeUndefined()
  })

  it('写成功 → 就地改收藏态，界面（行内键 / 菜单）立刻跟着变', async() => {
    favSongIdsLoaded.value = true
    likeSong.mockResolvedValue({ ok: true, code: 0, retCode: 0, msg: '' })

    await addFavSongToCloud(song('1'))

    expect(favSongIds.includes('1')).toBe(true)
  })
})

/**
 * 「我收藏的歌曲」列表的**就地更新**（2026-09-24 用户报障）。
 *
 * 现象：人在收藏页上，在别处点心收藏/取消，列表当场不变，切走再回来才看到。
 * 根因：写成功后那次「立刻重读」拿回来的是**服务端还没反映这次写的旧页**
 * （同 `favSongIds` 注释说的「这次收藏要等下次重拉才认」），正好把界面盖回原样。
 * 所以现在改成写成功即就地改列表——这组用例钉住它，并覆盖几种边界。
 */
const idsOf = () => favSongs.list.map((item: any) => item.meta.id)

describe('store/user/action 的「我收藏的歌曲」就地更新', () => {
  const seedList = (...ids: string[]) => {
    favSongs.list.splice(0, favSongs.list.length, ...ids.map(id => song(id)))
    favSongs.total = ids.length
  }

  it('收藏成功 → 新歌立刻出现在列表最前，total +1', async() => {
    seedList('9', '8')
    likeSong.mockResolvedValue({ ok: true, code: 0, retCode: 0, msg: '' })

    await addFavSongToCloud(song('1'))

    expect(idsOf()).toEqual(['1', '9', '8'])
    expect(favSongs.total).toBe(3)
  })

  it('取消喜欢成功 → 那一行立刻从列表移出，total -1', async() => {
    seedList('1', '9')
    unlikeSong.mockResolvedValue({ ok: true, code: 0, retCode: 0, msg: '' })

    await removeFavSongFromCloud(song('1'))

    expect(idsOf()).toEqual(['9'])
    expect(favSongs.total).toBe(1)
  })

  it('重复收藏同一首（已在列表里）→ 不重复插入、total 不加', async() => {
    seedList('1', '9')
    likeSong.mockResolvedValue(true)

    await addFavSongToCloud(song('1'))

    expect(idsOf()).toEqual(['1', '9'])
    expect(favSongs.total).toBe(2)
  })

  it('取消一首不在列表里的（列表只加载了第一页）→ 列表不动、total 不变', async() => {
    seedList('1', '9')
    unlikeSong.mockResolvedValue(true)

    await removeFavSongFromCloud(song('404'))

    expect(idsOf()).toEqual(['1', '9'])
    expect(favSongs.total).toBe(2)
  })

  it('列表还没加载过（total=0）→ 不往列表里塞东西（进页面会重拉）', async() => {
    likeSong.mockResolvedValue(true)

    await addFavSongToCloud(song('1'))

    expect(favSongs.list).toHaveLength(0)
    expect(favSongs.total).toBe(0)
  })

  it('写被拒（真机形状 code 80105 + retCode 0）→ 列表一行都不动', async() => {
    seedList('9')
    likeSong.mockResolvedValue({ ok: false, code: 80105, retCode: 0, msg: '' })

    await expect(addFavSongToCloud(song('1'))).rejects.toThrow()

    expect(idsOf()).toEqual(['9'])
    expect(favSongs.total).toBe(1)
  })
})

/**
 * 收藏的**来源分支**：本地文件 / 其它源 vs QQ 在线歌（ui-polish-followups 票 17 接缝 2）。
 *
 * 契约（2026-09-24 起）：本地收藏退场后「我喜欢」只有**云端 dirId=201 一条路**
 * （`core/player/action.ts` 的 collectMusic 注释、`views/Favorites/components/SongsPanel.vue`），
 * 所以来源分支只剩「这一首能不能写进云端」：
 *   - 判据是**有没有 QQ 歌曲 id**（`source == 'tx'` 且 `meta.id` 不为 null）——本地文件
 *     （source=local，`meta.id` 是文件路径/没有）与其它源的 id 送给 QQ 都是错的；
 *   - 不能收藏的歌，界面**不显示**收藏入口（三个入口都先问 `canFavSongInCloud`），
 *     真被直接调用时写接口也不发请求（不静默送错数据）；
 *   - 收藏态只读云端的全量 id 集合（本地 love 列表的数据行仍在，但不再是收藏态的判据）。
 *
 * 期望值来源：判据与文案都取自 `store/user/action.ts` 的既有实现与其注释（票 06/09 落地时的
 * 真机结论：本地文件没有 QQ songId，送进写接口是「无意义条目」——同 `AddSongsModal` 的
 * `source !== 'local'` 过滤、`playlists__add_songs_no_online` 文案）。
 */
describe('store/user/action 的收藏来源分支（本地 vs QQ 在线）', () => {
  /** 本地文件：source=local，没有 QQ 歌曲 id（本地库歌曲的形态，见 ListMusicTable 的用例） */
  const localFile = { id: 'local_1', name: '本地文件', singer: '歌手', source: 'local', interval: '03:00', meta: { albumName: '' } } as any

  it('tx 源且带 QQ 歌曲 id → 能收藏', () => {
    expect(canFavSongInCloud(song('1'))).toBe(true)
  })

  it('本地文件 / 其它源 → 不能收藏（本地收藏已取消，界面上不出现收藏入口）', () => {
    expect(canFavSongInCloud(localFile)).toBe(false)
    expect(canFavSongInCloud({ ...song('1'), source: 'netease' })).toBe(false)
  })

  it('缺 meta / 缺 meta.id / 空歌 → 不能收藏（判据是 meta.id != null，不是「有 meta」）', () => {
    expect(canFavSongInCloud({ ...song('1'), meta: {} })).toBe(false)
    expect(canFavSongInCloud({ ...song('1'), meta: undefined })).toBe(false)
    expect(canFavSongInCloud(null)).toBe(false)
    expect(canFavSongInCloud(undefined)).toBe(false)
  })

  it('本地文件即使被直接调用写接口：抛错且**一个请求都不发**', async() => {
    // 直接调 addFavSongToCloud 是「界面判据被绕过」的场景（快捷键 / 托盘 / deeplink 也走它）：
    // 没有 QQ id 时不能拿 NaN 去打接口
    await expect(addFavSongToCloud(localFile)).rejects.toThrow()
    await expect(removeFavSongFromCloud(localFile)).rejects.toThrow()

    expect(likeSong).not.toHaveBeenCalled()
    expect(unlikeSong).not.toHaveBeenCalled()
  })

  it('收藏态只认云端 id 集合（字符串 id），与 source 无关', () => {
    expect(isFavSongInCloud(song('1'))).toBe(false)

    favSongIds.push('1')

    expect(isFavSongInCloud(song('1'))).toBe(true)
    expect(isFavSongInCloud(song('2'))).toBe(false)
    // 没有 QQ id 的一律「未收藏」（不能拿空串去 includes）
    expect(isFavSongInCloud({ ...song('1'), meta: {} })).toBe(false)
    expect(isFavSongInCloud(null)).toBe(false)
  })
})

/**
 * 「不喜欢」的云端顺带写（票 05）。与上面那批收藏写的口径**故意不同**：失败不抛。
 * 它挂在「屏蔽播放」动作的尾巴上（本地屏蔽规则已经生效），弹窗只会把一次操作变成两步；
 * 所以契约是：在线歌才发、本地歌一个请求都不发、失败吞掉只留日志。
 */
describe('store/user/action 的 addDislikedSongToCloud（票 05）', () => {
  /** 本地文件：与收藏来源分支同一形态（没有 QQ 歌曲 id） */
  const localFile = { id: 'local_1', name: '本地文件', singer: '歌手', source: 'local', interval: '03:00', meta: {} } as any

  it('在线歌 → 用数字 songId 写云端（AddDislike）', async() => {
    addDislikedSongs.mockResolvedValue({ ok: true, code: 0, retcode: 0, msg: '' })

    await addDislikedSongToCloud(song('464898842'))

    expect(addDislikedSongs).toHaveBeenCalledTimes(1)
    expect(addDislikedSongs).toHaveBeenCalledWith([464898842])
  })

  it('本地文件 / 其它源 → 直接跳过，一个请求都不发', async() => {
    await addDislikedSongToCloud(localFile)
    await addDislikedSongToCloud({ ...song('1'), source: 'netease' })

    expect(addDislikedSongs).not.toHaveBeenCalled()
  })

  it('缺数字 songId（meta 空 / 无 meta）→ 不发（不拿 NaN 打接口）', async() => {
    await addDislikedSongToCloud({ ...song('1'), meta: {} })
    await addDislikedSongToCloud({ ...song('1'), meta: undefined })

    expect(addDislikedSongs).not.toHaveBeenCalled()
  })

  it('云端被拒 → 不抛给调用方（本地屏蔽已生效），只留一行日志', async() => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    addDislikedSongs.mockRejectedValue(new Error('加入不喜欢被拒（code=10000 retcode=1）'))

    await expect(addDislikedSongToCloud(song('1'))).resolves.toBeUndefined()

    expect(log).toHaveBeenCalled()
    log.mockRestore()
  })

  it('未登录（requireCredential 抛的固定串）→ 静默跳过，不打日志', async() => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    addDislikedSongs.mockRejectedValue(new Error('QQ 音乐未登录'))

    await expect(addDislikedSongToCloud(song('1'))).resolves.toBeUndefined()

    expect(log).not.toHaveBeenCalled()
    log.mockRestore()
  })
})

/**
 * 收藏页卡片上的**取消收藏**（票 06 E3）。
 *
 * 与详情页那套写法的差别在「列表怎么收尾」：收藏页要**就地移卡 + 不整页重拉**
 * （重拉会把用户「加载更多」翻出来的页丢掉——收藏专辑动辄几百条），所以这里钉住
 * `getFavAlbum` / `getFavSonglist` 没被调用。写接口要的 id 也不同：专辑卡片手里
 * 只有 mid（`id`）与数字 `albumId`，写接口要后者。
 */
describe('store/user/action 的收藏页取消收藏（票 06 E3）', () => {
  const albumCard = { id: 'album-mid-1', albumId: '12345', name: '专辑甲', img: '', author: '', desc: null, source: 'tx' } as any
  const listCard = { id: '987654321', name: '歌单甲', img: '', author: '', desc: null, source: 'tx' } as any

  beforeEach(() => {
    vi.clearAllMocks()
    favAlbums.splice(0, favAlbums.length, albumCard, { ...albumCard, id: 'album-mid-2', albumId: '222' })
    favLists.splice(0, favLists.length, listCard, { ...listCard, id: '111' })
    favAlbumIds.splice(0, favAlbumIds.length, 'album-mid-1', 'album-mid-2')
    favPlaylistIds.splice(0, favPlaylistIds.length, '987654321', '111')
    setFavAlbum.mockResolvedValue(true)
    setFavPlaylist.mockResolvedValue(true)
  })

  it('专辑：写的是数字 albumId；就地移卡、收藏态同步、**不重拉列表**', async() => {
    await removeFavAlbumFromList(albumCard)

    expect(setFavAlbum).toHaveBeenCalledWith('12345', false)
    expect(favAlbums.map(item => item.id)).toEqual(['album-mid-2'])
    expect(favAlbumIds).toEqual(['album-mid-2'])
    expect(getFavAlbum).not.toHaveBeenCalled()
  })

  it('歌单：写的是 tid；就地移卡、不重拉列表', async() => {
    await removeFavListFromList(listCard)

    expect(setFavPlaylist).toHaveBeenCalledWith('987654321', false)
    expect(favLists.map(item => item.id)).toEqual(['111'])
    expect(favPlaylistIds).toEqual(['111'])
    expect(getFavSonglist).not.toHaveBeenCalled()
  })

  it('被服务端拒绝 → 抛给调用方（面板弹错），卡片与收藏态都不动', async() => {
    setFavAlbum.mockResolvedValue(false)

    await expect(removeFavAlbumFromList(albumCard)).rejects.toThrow()
    expect(favAlbums.map(item => item.id)).toEqual(['album-mid-1', 'album-mid-2'])
    expect(favAlbumIds).toEqual(['album-mid-1', 'album-mid-2'])
  })

  it('专辑卡片缺数字 albumId → 不发请求直接抛（不能拿 mid 当 id 送）', async() => {
    const broken = { ...albumCard, albumId: '' }

    await expect(removeFavAlbumFromList(broken)).rejects.toThrow()
    expect(setFavAlbum).not.toHaveBeenCalled()
    expect(favAlbums).toHaveLength(2)
  })
})

/** 数据层（`tx/user.js` / `tx/songList.js`）给的**老式**歌曲对象：取数结果都长这样。 */
const oldSong = (id: string) => ({
  songmid: id,
  songId: id,
  songType: 0,
  name: `歌${id}`,
  singer: '歌手',
  source: 'tx',
  interval: '03:00',
  types: {},
  _types: {},
})

/** 手动控制 resolve 时机的 Promise（并发闸用例要「请求在飞」这个中间态）。 */
const deferred = () => {
  let resolve!: (value: any) => void
  const promise = new Promise<any>((_resolve) => { resolve = _resolve })
  return { promise, resolve }
}

/**
 * 文案断言取 i18n 的**实际值**（dom setup 的桩与真 i18n 都可能生效，别写死 key）——
 * 同 `views/Search/components/TypedResultList.test.ts` 的 `loadFailedText`。
 */
const loadFailedText = () => window.i18n.t('list__load_failed' as any)

/**
 * 账号中心会话缓存的**复位**（换号 / 登出 / 登录成功三条路共用的一个动作）。
 *
 * 真机症状（2026-09-26 审查）：未登录时进过任一页 → `initUserCenter` 已把 `isInited` 置 true
 * → 登录后不再取数；换号后 `favSongIds` 还是上一个人的 → 「该移除的又收藏一遍」。
 * 所以复位必须清到「这个会话没拉过任何东西」的状态，尤其 `isInited` 与收藏态。
 */
const seedUserCenter = () => {
  createdLists.splice(0, createdLists.length, { id: 'c1' } as any)
  favLists.splice(0, favLists.length, { id: 'p1' } as any)
  favAlbums.splice(0, favAlbums.length, { id: 'a1' } as any)
  followSingers.splice(0, followSingers.length, { id: 's1' } as any)
  favSongs.list.splice(0, favSongs.list.length, song('1'))
  favSongs.total = 1
  favSongs.page = 3
  favSongIds.push('1')
  favSongIdsLoaded.value = true
  favAlbumIds.push('mid1')
  favPlaylistIds.push('tid1')
  cloudListSongs.list.splice(0, cloudListSongs.list.length, song('2'))
  cloudListSongs.total = 1
  cloudListSongs.page = 2
  cloudListSongs.listTid = 'tid1'
  cloudListSongs.noItemLabel = 'list__load_failed'
  pagers.favLists = { page: 2, hasMore: true }
  pagers.favAlbums = { page: 2, hasMore: true }
  pagers.followSingers = { page: 2, hasMore: true }
  labels.favLists = 'list__load_failed'
  labels.profile = 'user_center__need_login'
  profile.name = '上一个人'
  vip.hires = true
  musicGene.nick = '上一个人'
  isInited.value = true
}

const clearUserCenter = () => {
  for (const list of [createdLists, favLists, favAlbums, followSingers, favAlbumIds, favPlaylistIds, favSongIds]) list.splice(0, list.length)
  favSongs.list.splice(0, favSongs.list.length)
  favSongs.total = 0
  favSongs.page = 1
  favSongIdsLoaded.value = false
  cloudListSongs.list.splice(0, cloudListSongs.list.length)
  cloudListSongs.total = 0
  cloudListSongs.page = 1
  cloudListSongs.listTid = ''
  cloudListSongs.noItemLabel = ''
  for (const pager of Object.values(pagers)) {
    pager.page = 1
    pager.hasMore = false
  }
  for (const key of Object.keys(labels) as Array<keyof typeof labels>) labels[key] = ''
  profile.name = ''
  vip.hires = false
  musicGene.nick = ''
  isInited.value = false
}

describe('store/user/action 的 resetUserCenter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearUserCenter()
  })

  it('复位会话缓存：列表 / 收藏态 / 分页 / 文案 / isInited 全归零（换号后不会拿上一个人的数据）', () => {
    seedUserCenter()

    resetUserCenter()

    expect(createdLists).toHaveLength(0)
    expect(favLists).toHaveLength(0)
    expect(favAlbums).toHaveLength(0)
    expect(followSingers).toHaveLength(0)
    expect(favSongs.list).toHaveLength(0)
    expect(favSongs.total).toBe(0)
    expect(favSongs.page).toBe(1)
    // 收藏态失效：这条最要命（换号后判反方向 → 该移除的又收藏一遍）
    expect(favSongIds).toHaveLength(0)
    expect(favSongIdsLoaded.value).toBe(false)
    expect(favAlbumIds).toHaveLength(0)
    expect(favPlaylistIds).toHaveLength(0)
    expect(cloudListSongs.list).toHaveLength(0)
    expect(cloudListSongs.listTid).toBe('')
    expect(pagers.favLists).toEqual({ page: 1, hasMore: false })
    expect(pagers.favAlbums).toEqual({ page: 1, hasMore: false })
    expect(pagers.followSingers).toEqual({ page: 1, hasMore: false })
    expect(labels.favLists).toBe('')
    expect(labels.profile).toBe('')
    expect(profile.name).toBe('')
    expect(vip.hires).toBe(false)
    expect(musicGene.nick).toBe('')
    // 关键：未登录时被 initUserCenter 置过的 true 也要归位，否则登录后不再取数
    expect(isInited.value).toBe(false)
  })
})

/**
 * 「加载更多」的两个坑（2026-09-26 审查）：
 *   1. 双击 / 连点会**重复追加同一页**（没有 in-flight 闸，两次调用各自算 page+1）；
 *   2. 失败**静默**——按钮回调是 `void loadMore*()`，rejection 冒到顶层（dev 下是全屏浮层）。
 * 契约与 `load()` 一致：失败只写文案（`list__load_failed`），不抛给调用方，已有数据保留。
 */
const MORE_CASES = [
  { name: '收藏歌单', loadMore: loadMoreFavLists, fetcher: getFavSonglist, target: favLists, key: 'favLists' as const },
  { name: '收藏专辑', loadMore: loadMoreFavAlbums, fetcher: getFavAlbum, target: favAlbums, key: 'favAlbums' as const },
  { name: '关注歌手', loadMore: loadMoreFollowSingers, fetcher: getFollowSingers, target: followSingers, key: 'followSingers' as const },
]

describe.each(MORE_CASES)('store/user/action 的 loadMore（$name）', ({ loadMore, fetcher, target, key }) => {
  beforeEach(() => {
    vi.clearAllMocks()
    target.splice(0, target.length)
    pagers[key] = { page: 1, hasMore: true }
    labels[key] = ''
  })

  it('双击「加载更多」只发一次请求（在飞期间第二次直接返回），该页只追加一遍', async() => {
    const pending = deferred()
    fetcher.mockReturnValue(pending.promise)

    const first = loadMore()
    const second = loadMore()
    // 闸在第一个 await 之前：第二次调用同步就被挡下，不该再打接口
    expect(fetcher).toHaveBeenCalledTimes(1)

    pending.resolve({ list: [{ id: 'x1' }], hasMore: false })
    await Promise.all([first, second])

    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(target.map(item => item.id)).toEqual(['x1'])
  })

  it('拉取失败 → 不抛给调用方（按钮回调是 void），落 list__load_failed，已有数据保留', async() => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    target.push({ id: 'old' } as any)
    fetcher.mockRejectedValue(new Error('boom'))

    await expect(loadMore()).resolves.toBeUndefined()

    expect(labels[key]).toBe(loadFailedText())
    expect(target.map(item => item.id)).toEqual(['old'])
    expect(log).toHaveBeenCalled()
    log.mockRestore()
  })

  it('失败后再点一次：闸要放开（失败不能把「加载更多」永久卡死）', async() => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    fetcher.mockRejectedValueOnce(new Error('boom'))
    await loadMore()
    expect(labels[key]).toBe(loadFailedText())

    fetcher.mockResolvedValueOnce({ list: [{ id: 'x1' }], hasMore: false })
    await loadMore()

    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(target.map(item => item.id)).toEqual(['x1'])
    expect(labels[key]).toBe('')
    log.mockRestore()
  })
})

describe('store/user/action 的 loadMoreFavSongs（我喜欢）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    favSongs.list.splice(0, favSongs.list.length, song('1'))
    favSongs.total = 3
    favSongs.page = 1
    labels.favSongs = ''
  })

  it('双击「加载更多」只发一次请求，同一页不会追加两遍', async() => {
    const pending = deferred()
    getFavSong.mockReturnValue(pending.promise)

    const first = loadMoreFavSongs()
    const second = loadMoreFavSongs()
    expect(getFavSong).toHaveBeenCalledTimes(1)

    pending.resolve({ list: [oldSong('2')], total: 3 })
    await Promise.all([first, second])

    expect(getFavSong).toHaveBeenCalledTimes(1)
    expect(favSongs.list.map(item => item.meta.id)).toEqual(['1', '2'])
  })
})

describe('store/user/action 的 createCloudList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createdLists.splice(0, createdLists.length)
  })

  it('建歌单成功、刷新列表失败 → 仍按成功返回（否则用户重试会建出重复歌单）', async() => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    createList.mockResolvedValue({ dirId: 126, tid: 978 })
    getCreatedSonglist.mockRejectedValue(new Error('boom'))

    await expect(createCloudList('歌单A')).resolves.toEqual({ dirId: 126, tid: 978 })

    expect(log).toHaveBeenCalled()
    log.mockRestore()
  })
})

/**
 * 删歌单的**同一类坑**（2026-09-26 审查，与 `createCloudList` 对称）：
 * 删除接口已经成功，只是随后的列表刷新失败——旧实现让这个失败冒出去，调用方弹「删除失败」，
 * 用户重试时歌单其实早没了（服务端只会回「歌单不存在」，列表依旧刷不出来）。
 * 契约：删除成功即成功，刷新失败只落一行日志。
 */
describe('store/user/action 的 removeCloudList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createdLists.splice(0, createdLists.length)
  })

  it('删歌单成功、刷新列表失败 → 仍按成功返回（不能报成「删除失败」让用户重试）', async() => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    removeList.mockResolvedValue(true)
    getCreatedSonglist.mockRejectedValue(new Error('boom'))

    await expect(removeCloudList({ dirId: 126, id: '978' } as any)).resolves.toBeUndefined()

    expect(removeList).toHaveBeenCalledWith(126)
    expect(log).toHaveBeenCalled()
    log.mockRestore()
  })

  it('删除接口本身失败（回 false）→ 照旧抛错（删除失败必须让用户看到）', async() => {
    removeList.mockResolvedValue(false)

    await expect(removeCloudList({ dirId: 126, id: '978' } as any)).rejects.toThrow()
  })
})

/**
 * 云端自建歌单列表的**进页重拉**（2026-09-29 用户报障：左栏整场会话不刷新）。
 *
 * `initUserCenter` 被 `isInited` 会话级守卫挡着、只跑一次——云端自建歌单是**多端可变**的
 * 数据（手机 / 网页上都能建、删），会话级缓存会让本应用直到重启都看不到别端的改动。
 * `reloadCreatedLists` 是能重复调用的版本（对齐 `loadFavSongs` 的待遇），契约与其它
 * 账号接口一致：失败只落文案（未登录落登录提示），不抛给调用方。
 */
describe('store/user/action 的 reloadCreatedLists', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createdLists.splice(0, createdLists.length, { id: 'old' } as any)
    labels.createdLists = ''
  })

  it('成功：拉取写回列表，文案从 loading 清空', async() => {
    getCreatedSonglist.mockResolvedValue({ list: [{ id: 'new1' }, { id: 'new2' }] })

    await reloadCreatedLists()

    expect(getCreatedSonglist).toHaveBeenCalledTimes(1)
    expect(createdLists.map(item => item.id)).toEqual(['new1', 'new2'])
    expect(labels.createdLists).toBe('')
  })

  it('失败：落失败文案，不抛给调用方，旧列表保留', async() => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    getCreatedSonglist.mockRejectedValue(new Error('boom'))

    await expect(reloadCreatedLists()).resolves.toBeUndefined()

    expect(labels.createdLists).toBe(loadFailedText())
    expect(createdLists.map(item => item.id)).toEqual(['old'])
    log.mockRestore()
  })

  it('未登录：落「请先登录」文案，不抛', async() => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    getCreatedSonglist.mockRejectedValue(new Error('QQ 音乐未登录'))

    await reloadCreatedLists()

    expect(labels.createdLists).toBe(window.i18n.t('user_center__need_login' as any))
    log.mockRestore()
  })
})
