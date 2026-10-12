import { describe, expect, it } from 'vitest'
import { filterMusicList, toNewMusicInfo, fixNewMusicInfoQuality } from '@common/utils/tools'
import { mergeImportedLists, type ImportedListInfo, type LocalListInfo } from './listDataImport'

/**
 * 备份导入的回归用例（票 08 契约 2：**旧备份必须仍能导入**；集合概念统一批扩大为
 * 「已退休的保留列表段（`default` 试听列表 / `love` 本地收藏）一律跳过」）。
 *
 * 为什么要有它：按位置 `shift()` 的旧写法曾在格式变化时把列表认错，而「按 id 认 + 跳过已退休段」
 * 这条口径靠这段用例钉住。纯函数，不碰 window / IPC。
 */

const mapOldMusic = (musicList: any[]) => filterMusicList(musicList.map(m => toNewMusicInfo(m)))
const mapNewMusic = (musicList: any[]) => filterMusicList(musicList).map(m => fixNewMusicInfoQuality(m))

/** 旧格式（playList）里的一首歌 */
const oldMusic = (songmid: string) => ({
  source: 'tx',
  songmid,
  name: `song_${songmid}`,
  singer: 'singer',
  interval: '03:00',
  albumName: 'album',
  types: [],
  _types: {},
  strMediaMid: songmid,
})

/** 新格式（playList_v2）里的一首歌 */
const newMusic = (id: string): LX.Music.MusicInfo => ({
  id: `tx_${id}`,
  name: `song_${id}`,
  singer: 'singer',
  source: 'tx',
  interval: '03:00',
  meta: {
    songId: id,
    albumName: 'album',
    qualitys: [],
    _qualitys: {},
    strMediaMid: id,
  },
})

/** `getAllLists()` 的结果：全部是自建列表（保留列表已退休，没有第 0 项的特殊含义） */
const localLists = (): LocalListInfo[] => [
  { id: 'userlist_a', name: '原有列表 A', list: [newMusic('a1')] },
]

describe('mergeImportedLists：旧备份（含已退休的保留列表段）', () => {
  it('跳过 default 与 love 两段，自建列表照常导入', () => {
    const imported: ImportedListInfo[] = [
      { id: 'default', name: 'list__name_default', list: [oldMusic('d1'), oldMusic('d2'), oldMusic('d3')] },
      { id: 'love', name: 'list__name_love', list: [oldMusic('l1')] },
      { id: 'userlist_b', name: '导入的新列表', list: [oldMusic('b1')] },
    ]

    const { userList } = mergeImportedLists(localLists(), imported, mapOldMusic)

    // 两段保留列表都没进来；原有 A 没被这次导入碰到，备份里的 B 追加在后面
    expect(userList.map(list => list.id)).toEqual(['userlist_a', 'userlist_b'])
    expect(userList[0].list.map(m => m.name)).toEqual(['song_a1'])
    expect(userList[1].list.map(m => m.name)).toEqual(['song_b1'])
    expect(userList.some(list => list.id == 'default' || list.id == 'love')).toBe(false)
  })

  it('第 0 项没有 id（更老格式）：一并跳过，其余自建列表照常导入', () => {
    // 无 id 的第 0 项 = 老格式里的试听列表
    const legacyNoIdEntry: ImportedListInfo = { name: '试听列表', list: [oldMusic('d1')] }
    const imported: ImportedListInfo[] = [
      legacyNoIdEntry,
      { id: 'userlist_b', name: '导入的新列表', list: [oldMusic('b1'), oldMusic('b2')] },
    ]

    const { userList } = mergeImportedLists(localLists(), imported, mapOldMusic)

    expect(userList.map(list => list.id)).toEqual(['userlist_a', 'userlist_b'])
    expect(userList[1].list.map(m => m.name)).toEqual(['song_b1', 'song_b2'])
  })

  it('备份里的自建列表与本地 id 撞车时覆盖本地那一条，而不是新增', () => {
    const imported: ImportedListInfo[] = [
      { id: 'default', name: 'list__name_default', list: [oldMusic('d1')] },
      { id: 'love', name: 'list__name_love', list: [] },
      { id: 'userlist_a', name: '原有列表 A', list: [oldMusic('a9')] },
    ]

    const { userList } = mergeImportedLists(localLists(), imported, mapOldMusic)

    expect(userList.map(list => list.id)).toEqual(['userlist_a'])
    expect(userList[0].list.map(m => m.name)).toEqual(['song_a9'])
  })
})

describe('mergeImportedLists：新备份（只含自建列表）', () => {
  it('按 id 认列表，第 0 项就是普通自建列表（不按位置丢弃）', () => {
    const imported: ImportedListInfo[] = [
      { id: 'userlist_c', name: '导入的新列表 C', list: [newMusic('c1')] },
    ]

    const { userList } = mergeImportedLists(localLists(), imported, mapNewMusic)

    expect(userList.map(list => list.id)).toEqual(['userlist_a', 'userlist_c'])
    expect(userList[0].list.map(m => m.name)).toEqual(['song_a1'])
  })
})
