import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import type BetterSqlite3 from 'better-sqlite3'
import { getDB, init } from '../../db'
import {
  localLibraryAdd,
  localLibraryAll,
  localLibraryCount,
  localLibraryGetByIds,
  localLibraryRemove,
  localLibraryUpdate,
} from './index'

/**
 * 本地媒体库持久化域的行为测试（票 01 的验收 seam）。
 *
 * 只测外部行为：给这些输入，库里查到什么、引用歌单行变成什么样、删了什么——
 * 不测内部实现。库用真实 SQLite（临时目录），不 mock fs/sqlite 本体；
 * 与 migrate.test.ts 相同，只桩掉 `nativeBinding` 路径提示（vitest 里那份打包路径不存在）。
 *
 * 「引用行」语义（spec D4）：新本地条目在 `my_list_music_info` 里以 `source='local'`、
 * `id`=曲目哈希引用库曲目，展示字段（name/singer/interval/meta.albumName）与库行是**两份**——
 * 所以更新曲目必须同事务同步引用行，移除曲目必须级联清掉引用行与排序行。
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

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'chiverve-local-library-'))
let caseSeq = 0
/** 每个用例一个独立目录（`init` 维护模块级连接，用例之间不能共用库文件） */
const newCaseDir = () => {
  const dir = path.join(tmpRoot, `case-${++caseSeq}`)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/** 开独立连接读库（断言别用 `getDB()`——那是 init 自己的连接） */
const inspect = <T>(fn: (db: BetterSqlite3.Database) => T): T => {
  const db = new Database(path.join(currentDir!, 'lx.data.db'))
  try {
    return fn(db)
  } finally {
    db.close()
  }
}

let currentDir: string | undefined

/** 造一条曲目（importedAt 由 dbHelper 统一填，输入里不传） */
const track = (id: string, overrides: Partial<LX.LocalLibrary.Track> = {}): LX.LocalLibrary.TrackInput => ({
  id,
  name: `song_${id}`,
  singer: 'singer_a',
  album: 'album_a',
  interval: '03:00',
  ext: 'mp3',
  size: 1024,
  year: '2020',
  genre: 'pop',
  trackNum: '1',
  discNum: '1',
  hasPic: true,
  hasLyric: false,
  ...overrides,
})

interface ListRow { id: string, listId: string, name: string, singer: string, interval: string | null, meta: string }
const readOrderRows = () => inspect(db => (db
  .prepare('SELECT "listId", "musicInfoId", "order" FROM "main"."my_list_music_info_order" ORDER BY "listId", "musicInfoId"')
  .all() as Array<{ listId: string, musicInfoId: string, order: number }>))

/** 往库表里插一行歌单条目（source 可指定，用来验证「只有 local 行被联动」） */
const insertListMusic = (db: BetterSqlite3.Database, args: { id: string, listId: string, source: string, meta: Record<string, unknown> }) => {
  db.prepare('INSERT INTO "main"."my_list_music_info" ("id", "listId", "name", "singer", "source", "interval", "meta") VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(args.id, args.listId, `name_${args.id}`, `singer_${args.id}`, args.source, '04:00', JSON.stringify(args.meta))
  db.prepare('INSERT INTO "main"."my_list_music_info_order" ("listId", "musicInfoId", "order") VALUES (?, ?, ?)')
    .run(args.listId, args.id, 0)
}

afterAll(() => {
  try {
    getDB()?.close()
  } catch {}
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

describe('全新 v6 库上：添加与读取', () => {
  it('批量添加后全部可读，字段 camelCase 对齐，importedAt 同批一致且非 0', () => {
    currentDir = newCaseDir()
    expect(init(currentDir)).toBe(false)

    localLibraryAdd([track('t_b'), track('t_a'), track('t_c')])

    const all = localLibraryAll()
    expect(localLibraryCount()).toBe(3)
    expect(all.map(row => row.id)).toEqual(['t_a', 't_b', 't_c']) // 按名称排序的默认序
    expect(all[0]).toMatchObject({ id: 't_a', name: 'song_t_a', singer: 'singer_a', album: 'album_a', ext: 'mp3', size: 1024, year: '2020', genre: 'pop', trackNum: '1', discNum: '1' })
    expect(all[0].hasPic).toBe(true)
    expect(all[0].hasLyric).toBe(false)
    expect(new Set(all.map(row => row.importedAt)).size).toBe(1) // 同批一个时间戳
    expect(all[0].importedAt).toBeGreaterThan(0)
  })

  it('getByIds 只回命中的行（不存在的 id 静默略过）', () => {
    const rows = localLibraryGetByIds(['t_a', 'missing'])
    expect(rows.map(row => row.id)).toEqual(['t_a'])
  })

  it('哈希去重：同 id 再添不改旧行（首见为准），计数不变', () => {
    localLibraryAdd([track('t_a', { name: '另一份同名文件的歌名', singer: 'singer_b' })])
    expect(localLibraryCount()).toBe(3)
    const row = localLibraryGetByIds(['t_a'])[0]
    expect(row.name).toBe('song_t_a')
    expect(row.singer).toBe('singer_a')
  })
})

describe('更新：同事务同步引用歌单行', () => {
  it('库行更新；local 引用行的 name/singer/interval/meta.albumName 跟上；非 local 行与其它曲目行不动', () => {
    currentDir = newCaseDir()
    expect(init(currentDir)).toBe(false)
    localLibraryAdd([track('t1'), track('t2', { album: 'album_t2' })])

    // 引用行：t1 被两个歌单引用（local）；t1 在另一个歌单还有一行 tx（同 id 不同源只能在不同列表——UNIQUE(id,listId)）；t2 有一个 local 引用（不该被波及）
    inspect(db => {
      db.prepare('INSERT INTO "main"."my_list" ("id", "name", "source", "sourceListId", "position", "locationUpdateTime") VALUES (?, ?, ?, ?, ?, ?)')
        .run('list_x', '歌单一', null, null, 0, 0)
      db.prepare('INSERT INTO "main"."my_list" ("id", "name", "source", "sourceListId", "position", "locationUpdateTime") VALUES (?, ?, ?, ?, ?, ?)')
        .run('list_y', '歌单二', null, null, 1, 0)
      db.prepare('INSERT INTO "main"."my_list" ("id", "name", "source", "sourceListId", "position", "locationUpdateTime") VALUES (?, ?, ?, ?, ?, ?)')
        .run('list_z', '歌单三', null, null, 2, 0)
      insertListMusic(db, { id: 't1', listId: 'list_x', source: 'local', meta: { albumName: 'album_a', filePath: '/media/t1.mp3', ext: 'mp3', songId: 't1' } })
      insertListMusic(db, { id: 't1', listId: 'list_y', source: 'local', meta: { albumName: 'album_a', filePath: '/media/t1.flac', ext: 'flac', songId: 't1' } })
      insertListMusic(db, { id: 't1', listId: 'list_z', source: 'tx', meta: { albumName: '在线同名歌' } })
      insertListMusic(db, { id: 't2', listId: 'list_x', source: 'local', meta: { albumName: 'album_t2', filePath: '/media/t2.mp3', ext: 'mp3', songId: 't2' } })
    })
    const orderBefore = readOrderRows()

    const changed = localLibraryUpdate({
      ...track('t1', {
        name: '改过的歌名',
        singer: '改过的歌手',
        album: '改过的专辑',
        interval: '04:05',
      }),
      importedAt: 0,
    })

    expect(changed).toBe(true)
    // 库行更新
    expect(localLibraryGetByIds(['t1'])[0]).toMatchObject({ name: '改过的歌名', singer: '改过的歌手', album: '改过的专辑', interval: '04:05' })
    // 引用行联动：只有 t1 的 local 行变，meta 里只动 albumName（filePath/ext 是播放依据，不许碰）
    const allRows = inspect(db => (db
      .prepare('SELECT "id", "listId", "source", "name", "singer", "interval", "meta" FROM "main"."my_list_music_info" ORDER BY "listId", "id", "source"')
      .all() as Array<ListRow & { source: string }>))
    const refRows = allRows.filter(row => row.id == 't1' && row.source == 'local')
    expect(refRows.map(row => row.listId).sort()).toEqual(['list_x', 'list_y'])
    for (const row of refRows) {
      expect(row.name).toBe('改过的歌名')
      expect(row.singer).toBe('改过的歌手')
      expect(row.interval).toBe('04:05')
      const meta = JSON.parse(row.meta)
      expect(meta.albumName).toBe('改过的专辑')
    }
    const txRow = allRows.find(row => row.id == 't1' && row.source == 'tx')!
    expect(txRow.name).toBe('name_t1')
    expect(JSON.parse(txRow.meta).albumName).toBe('在线同名歌')
    const t2Row = allRows.find(row => row.id == 't2' && row.source == 'local')!
    expect(t2Row.name).toBe('name_t2')
    expect(JSON.parse(t2Row.meta).albumName).toBe('album_t2')
    // 排序行不受更新影响
    expect(readOrderRows()).toEqual(orderBefore)
  })

  it('更新不存在的曲目：返回 false、无副作用、不抛错', () => {
    expect(localLibraryUpdate({ ...track('ghost'), importedAt: 0 })).toBe(false)
  })
})

describe('移除：级联清理引用行与排序行', () => {
  it('曲目行、其 local 引用行、对应排序行一起消失；其它曲目与非 local 行不受影响', () => {
    currentDir = newCaseDir()
    expect(init(currentDir)).toBe(false)
    localLibraryAdd([track('t1'), track('t2')])
    inspect(db => {
      db.prepare('INSERT INTO "main"."my_list" ("id", "name", "source", "sourceListId", "position", "locationUpdateTime") VALUES (?, ?, ?, ?, ?, ?)')
        .run('list_x', '歌单一', null, null, 0, 0)
      db.prepare('INSERT INTO "main"."my_list" ("id", "name", "source", "sourceListId", "position", "locationUpdateTime") VALUES (?, ?, ?, ?, ?, ?)')
        .run('list_y', '歌单二', null, null, 1, 0)
      insertListMusic(db, { id: 't1', listId: 'list_x', source: 'local', meta: {} })
      insertListMusic(db, { id: 't2', listId: 'list_x', source: 'local', meta: {} })
      // t1 的 tx 行只能在另一个列表（UNIQUE(id,listId)）：它的条目行与排序行都不属于库
      insertListMusic(db, { id: 't1', listId: 'list_y', source: 'tx', meta: {} })
    })

    localLibraryRemove(['t1'])

    expect(localLibraryCount()).toBe(1)
    expect(localLibraryGetByIds(['t1'])).toEqual([])
    const allRows = inspect(db => (db
      .prepare('SELECT "id", "source" FROM "main"."my_list_music_info" ORDER BY "id", "source"')
      .all() as Array<{ id: string, source: string }>))
    expect(allRows).toEqual([
      { id: 't1', source: 'tx' }, // 非 local 行不属于库，移除曲目不动它
      { id: 't2', source: 'local' },
    ])
    // 排序行只删「被移除的 local 条目」那一对：tx 条目（list_y,t1）的排序行必须还在
    expect(readOrderRows().map(row => `${row.listId}:${row.musicInfoId}`)).toEqual(['list_x:t2', 'list_y:t1'])
  })

  it('移除不存在的 id：安静无事', () => {
    expect(() => { localLibraryRemove(['ghost']) }).not.toThrow()
    expect(() => { localLibraryRemove([]) }).not.toThrow()
  })
})
