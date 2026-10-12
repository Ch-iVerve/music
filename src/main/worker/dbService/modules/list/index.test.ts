import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import type Database from 'better-sqlite3'
import { getDB, init } from '../../db'
import { listDataOverwrite } from './index'

/**
 * 「旧同步数据 / 旧备份载荷仍能落库」的回归用例（票 08 契约：旧数据不许把已删除的试听列表写回库里；
 * 集合概念统一批把本地收藏 `love` 也并入同口径）。
 *
 * 为什么落在这里而不是 migrate.test.ts：这里验的是 `listDataOverwrite` 对**入参形状**的宽容度——
 * 同步拉取（`sync/listEvent.ts` 的 `setLocalListData`）、备份导入（`overwriteListFull`）、旧 JSON 迁移
 * 三条路最后都汇到这个函数。`defaultList` 与 `loveList` 已从头（`ListDataFull`）里删掉，但**载荷里
 * 可能还带着它们**（旧版对端 / 旧 `.lxmc` 文件）：函数按名字解构，多出来的键必须被安静地忽略——
 * 一旦有人改成按位置取参或对多出来的键报错，这条用例就会红。
 *
 * 用真库跑（better-sqlite3 + `db.ts` 的 `init`）：派生的断言只有真实 SQL 才能证明——比如
 * 「旧载荷里的 3 首试听列表歌一首都没写进 `my_list_music_info`」。
 *
 * 桩同 migrate.test.ts：去掉打包后才会用到的 `nativeBinding` 路径提示。
 */
vi.mock('better-sqlite3', async(importOriginal) => {
  const actual = await importOriginal<{ default: typeof Database }>()
  const RealDatabase = actual.default
  const DatabaseWithoutNativeBinding = new Proxy(RealDatabase, {
    construct: (target, args) => {
      const [filename, options] = args as [string, Record<string, unknown> | undefined]
      const nextOptions: Record<string, unknown> = { ...options }
      delete nextOptions.nativeBinding
      return Reflect.construct(target, [filename, nextOptions])
    },
  })
  return { ...actual, default: DatabaseWithoutNativeBinding }
})

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'chiverve-list-overwrite-'))

afterAll(() => {
  try {
    getDB()?.close()
  } catch {}
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

const createMusic = (id: string): LX.Music.MusicInfo => ({
  id,
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

/** 票 08 之前的载荷形状：`defaultList` 与 `loveList` 平级，是必填的一员 */
interface LegacyListDataPayload {
  defaultList: LX.Music.MusicInfo[]
  loveList: LX.Music.MusicInfo[]
  userList: LX.List.UserListInfoFull[]
  tempList: LX.Music.MusicInfo[]
}

const LEGACY_PAYLOAD: LegacyListDataPayload = {
  defaultList: [createMusic('d1'), createMusic('d2'), createMusic('d3')],
  loveList: [createMusic('l1'), createMusic('l2')],
  userList: [
    {
      id: 'userlist_old_payload',
      name: '旧载荷里的自建列表',
      locationUpdateTime: null,
      list: [createMusic('u1')],
    },
  ],
  tempList: [createMusic('t1')],
}

/** 按 listId 统计某张表里的行数（迁移 / 覆盖写之后用它断言「哪一档有几行」） */
const readCountsByList = (sql: string) => {
  const rows = getDB().prepare(sql).all() as Array<{ listId: string, count: number }>
  const counts: Record<string, number> = {}
  for (const row of rows) counts[row.listId] = row.count
  return counts
}

describe('旧格式载荷（带 `defaultList`）落到 listDataOverwrite', () => {
  it('试听列表的歌一首都不落库，收藏 / 临时 / 自建列表照旧生效', () => {
    const dir = path.join(tmpRoot, 'case-1')
    fs.mkdirSync(dir, { recursive: true })
    // 空目录 → 新建库（init 返回 false 而不是 null：至少不需要走「改名备份 + 重建空库」那条路）
    expect(init(dir)).toBe(false)

    // 旧载荷多一个 `defaultList` 键：类型上已经不存在，运行时必须被忽略
    listDataOverwrite(LEGACY_PAYLOAD as unknown as MakeOptional<LX.List.ListDataFull, 'tempList'>)

    const musicCounts = readCountsByList('SELECT "listId", COUNT(*) AS "count" FROM "main"."my_list_music_info" GROUP BY "listId"')
    const orderCounts = readCountsByList('SELECT "listId", COUNT(*) AS "count" FROM "main"."my_list_music_info_order" GROUP BY "listId"')
    console.log('[listDataOverwrite.test] 旧载荷落库后：歌曲行 %s；排序行 %s', JSON.stringify(musicCounts), JSON.stringify(orderCounts))

    // 已退休的保留列表（default 试听 / love 本地收藏）：载荷里带着也一首都不能写进去
    expect(musicCounts.default).toBeUndefined()
    expect(orderCounts.default).toBeUndefined()
    expect(musicCounts.love).toBeUndefined()
    expect(orderCounts.love).toBeUndefined()
    // 其余档（临时 / 自建列表）按载荷写入
    expect(musicCounts.temp).toBe(1)
    expect(musicCounts.userlist_old_payload).toBe(1)
    expect(orderCounts.temp).toBe(1)
    expect(orderCounts.userlist_old_payload).toBe(1)

    const userLists = (getDB().prepare('SELECT "id" FROM "main"."my_list" ORDER BY "position"').all() as Array<{ id: string }>).map(row => row.id)
    expect(userLists).toEqual(['userlist_old_payload'])
  })

  it('新载荷（只有 userList / tempList）覆盖旧数据后，库里不留任何保留列表行', () => {
    const dir = path.join(tmpRoot, 'case-2')
    fs.mkdirSync(dir, { recursive: true })
    expect(init(dir)).toBe(false)

    listDataOverwrite(LEGACY_PAYLOAD as unknown as MakeOptional<LX.List.ListDataFull, 'tempList'>)
    // 再落一份「当前格式」的载荷：覆盖写（`overwriteListData` 是整表清空重建）
    listDataOverwrite({
      userList: [],
      tempList: [],
    })

    const musicCounts = readCountsByList('SELECT "listId", COUNT(*) AS "count" FROM "main"."my_list_music_info" GROUP BY "listId"')
    console.log('[listDataOverwrite.test] 当前格式载荷覆盖后：歌曲行 %s', JSON.stringify(musicCounts))
    expect(musicCounts).toEqual({})
  })

  it('旧式本地条目（source=local 且无 trackId）落库时被丢弃，托管条目保留', () => {
    const dir = path.join(tmpRoot, 'case-3')
    fs.mkdirSync(dir, { recursive: true })
    expect(init(dir)).toBe(false)

    const hostedHash = 'b'.repeat(40)
    const localLegacy = {
      ...createMusic('local_/Music/old.mp3'),
      source: 'local',
      meta: { filePath: '/Music/old.mp3', ext: 'mp3' },
    } as unknown as LX.Music.MusicInfo
    const localHosted = {
      ...createMusic(hostedHash),
      source: 'local',
      meta: { filePath: `/media/${hostedHash}.mp3`, ext: 'mp3', trackId: hostedHash },
    } as unknown as LX.Music.MusicInfo
    listDataOverwrite({
      userList: [{
        id: 'userlist_local',
        name: '本地列表',
        locationUpdateTime: null,
        list: [localLegacy, localHosted],
      }],
      tempList: [],
    })

    const rows = (getDB().prepare('SELECT "id" FROM "main"."my_list_music_info" ORDER BY "id"').all() as Array<{ id: string }>).map(row => row.id)
    expect(rows).toEqual([hostedHash])
  })
})
