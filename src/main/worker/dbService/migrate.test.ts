import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import type BetterSqlite3 from 'better-sqlite3'
import tables, { DB_VERSION } from './tables'
import { getDB, init } from './db'
import verifyDB from './verifyDB'
import { musicUrlCount, musicUrlRecycle, musicUrlRemove, musicUrlSave } from './modules/music_url'
import { followFeedBaselineAll, followFeedItemsGet } from './modules/follow_feed'
import { localLibraryAll, localLibraryCount } from './modules/local_library'

/**
 * 旧库迁移实测（`dbService.init` 的硬要求，AGENTS §2.4 / 票 08 验收第一条）。
 *
 * **为什么必须有这个文件**：`tables.ts` 的建表 SQL 与 `verifyDB` 是**逐字符**比对的（正常化空白 /
 * 分号 / 注释后整串相等）。校验不过时 `db.ts` 的 `init` 返回 `null`，`main/app.ts` 会弹窗、把用户库
 * 改名备份后**重建空库** —— 数据丢了。所以「改表结构」这件事只有两种状态：在一份真旧库上实测
 * `init` 返回 `true`，或者没验证过。这里就是把那次实测变成可复跑的用例。
 *
 * 四组用例：
 * 1. `v2 → v5`：库的 `music_url` 是票 08 之前的定义（两列、无 `created_at`），版本号 `'2'`；
 * 2. `v1 → v5`：再老一版（缺 `dislike_list`，版本号 `'1'`），要连做四版迁移；
 * 3. 半迁移状态：`created_at` 已在但定义带 `DEFAULT`（手写 `ALTER TABLE` 会留下的样子）、版本号还是 `'2'`
 *    —— 重建要把它归一化回 `tables` 的原文，且已写入的时间戳不能被抹掉；
 * 4. 空目录（没有库文件）：新建的库自带 `created_at` 且直接通过校验。
 * 外加三组：一是「迁移后的库上回收 / 精确删真的能跑通」（验语句绑定的列名对不对，光看结构比不出来），
 * 二是「旧库实测：试听列表行被真删、其余列表数据一行不少」（票 08 的 v3 → v4 清行迁移），
 * 三是「v4 库补关注动态两张表」（关注动态票 02 的 v4 → v5 建表迁移）。
 *
 * **旧库夹具**：默认用**合成旧库**（v3 结构 + 真实体量的行数，见 `legacyFixture`），所以这组用例
 * **每次都跑**。要用一份**真库的副本**复验（结构与数据量是真的，合成库只能证明「我按我以为的旧结构
 * 写对了」）就设环境变量——注意要的是**副本**，不能拿原件：
 * ```bash
 * cp ~/.config/chiverve-music-dev/LxDatas/lx.data.db* /tmp/lx-legacy.db  # 连同 -wal/-shm 一起拷
 * CHIVERVE_LEGACY_DB=/tmp/lx-legacy.db npx vitest run src/main/worker/dbService/migrate.test.ts
 * ```
 * （2026-09-24 起：从「不设环境变量就整组跳过」改成「默认用合成件」——原先那种写法让 CI 永远少两条
 * 用例，而它们覆盖的正是最要命的路径。票 08 起夹具版本号跟到 `'3'`：真库副本现在就是这个版本，
 * 再按 `'2'` 断言会让「真库副本」这条路直接失败。）
 */

/**
 * 桩掉 `db.ts` 里 `new Database(path, { nativeBinding })` 的 `nativeBinding` 路径提示。
 *
 * 那个路径（`<__dirname>/../node_modules/better-sqlite3/build/Release/better_sqlite3.node`）是给
 * **打包后**用的：那时 `__dirname` 是 `dist`，路径指到 asar 里那份绑定的拷贝。在 vitest 里
 * `__dirname` 是源码目录 `src/main/worker/dbService`，`../node_modules/...` 不存在 → 不桩就会在
 * `new Database` 处抛错（`init` 的 catch 分支会再抛一次，测试根本进不到迁移逻辑）。
 * 桩只丢这一个路径提示，其余原样交给真的 better-sqlite3：加载的是同一个原生 addon、同一个 SQLite。
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

/** 票 08 之前的 `music_url` 定义（`git show HEAD:src/main/worker/dbService/tables.ts` 的原文） */
const LEGACY_MUSIC_URL_SQL = `
  CREATE TABLE "music_url" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL
  );
`

/** 旧库里的缓存行（合成的，刻意不含任何真实 URL）：id 形如 `${歌曲id}_${音质}` */
const LEGACY_ROWS: Array<[string, string]> = [
  ['1001_128k', 'https://example.invalid/1001?sign=aaa'],
  ['1002_320k', 'https://example.invalid/1002?sign=bbb'],
  ['1003_flac', 'https://example.invalid/1003?sign=ccc'],
]

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'chiverve-db-migrate-'))
let caseSeq = 0
/** 每个用例一个独立目录（`init` 在 `db.ts` 里维护模块级连接，用例之间不能共用库文件） */
const newCaseDir = () => {
  const dir = path.join(tmpRoot, `case-${++caseSeq}`)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}
const dbFileOf = (dir: string) => path.join(dir, 'lx.data.db')

/**
 * 造一份旧库：表结构与当前 `tables` 一致，只有 `music_url` 用旧定义、版本号写旧值。
 * 另外塞一行 `lyric`，用来证明迁移只动 `music_url`、别的表一行没碰。
 */
const createLegacyDb = (dir: string, version: '1' | '2') => {
  const file = dbFileOf(dir)
  const db = new Database(file)
  const sqls = Array.from(tables.entries())
    // v6 才有的表不能出现在旧夹具里（它当时还不存在）；v1 的库另缺 `dislike_list`（上游 v2.4.0 版本号遗留，`migrateV1` 就是补它）
    .filter(([name]) => name != 'local_library_track' && !(version == '1' && name == 'dislike_list'))
    .map(([name, sql]) => name == 'music_url' ? LEGACY_MUSIC_URL_SQL : sql)
  db.exec(sqls.join('\n'))
  db.exec(`INSERT INTO "main"."db_info" ("field_name", "field_value") VALUES ('version', '${version}');`)
  const insertUrl = db.prepare('INSERT INTO "main"."music_url" ("id", "url") VALUES (?, ?)')
  for (const [id, url] of LEGACY_ROWS) insertUrl.run(id, url)
  db.prepare('INSERT INTO "main"."lyric" ("id", "source", "type", "text") VALUES (?, ?, ?, ?)')
    .run('2001', 'tx', 'lrc', '[00:00.00]旧库里的歌词')
  db.close()
  return file
}

/** 开一条独立连接读库（断言别用 `getDB()`——那是 `init` 自己的连接，读出来的是缓存过的状态） */
const inspect = <T>(file: string, fn: (db: BetterSqlite3.Database) => T): T => {
  const db = new Database(file)
  try {
    return fn(db)
  } finally {
    db.close()
  }
}

const readColumns = (file: string) => inspect(file, db => (db.pragma('table_info("music_url")') as Array<{ name: string }>).map(column => column.name))
const readRows = (file: string) => inspect(file, db => db
  .prepare('SELECT "id", "url", "created_at" AS "createdAt" FROM "main"."music_url" ORDER BY "rowid"')
  .all() as Array<{ id: string, url: string, createdAt: number }>)
const readVersion = (file: string) => inspect(file, db => (db
  .prepare('SELECT "field_value" AS "value" FROM "main"."db_info" WHERE "field_name" = ?')
  .get('version') as { value: string }).value)
const readTableNames = (file: string) => inspect(file, db => (db
  .prepare('SELECT "name" FROM "main".sqlite_master WHERE "type" = \'table\' ORDER BY "name"')
  .all() as Array<{ name: string }>).map(row => row.name))
const readLyricCount = (file: string) => inspect(file, db => (db.prepare('SELECT COUNT(*) AS "count" FROM "main"."lyric"').get() as { count: number }).count)

/** 按 listId 统计列表歌曲行（票 08 的迁移只该动 `default` 这一档） */
const readListMusicCounts = (file: string) => inspect(file, db => {
  const rows = db.prepare('SELECT "listId", COUNT(*) AS "count" FROM "main"."my_list_music_info" GROUP BY "listId"').all() as Array<{ listId: string, count: number }>
  return Object.fromEntries(rows.map(row => [row.listId, row.count])) as Record<string, number>
})
/** 按 listId 统计排序行（`my_list_music_info_order`，与歌曲表是两份） */
const readListOrderCounts = (file: string) => inspect(file, db => {
  const rows = db.prepare('SELECT "listId", COUNT(*) AS "count" FROM "main"."my_list_music_info_order" GROUP BY "listId"').all() as Array<{ listId: string, count: number }>
  return Object.fromEntries(rows.map(row => [row.listId, row.count])) as Record<string, number>
})
/** `my_list` 里的自建列表 id（收藏/试听/临时列表本来就不在这张表里） */
const readUserListIds = (file: string) => inspect(file, db => (db
  .prepare('SELECT "id" FROM "main"."my_list" ORDER BY "position"')
  .all() as Array<{ id: string }>).map(row => row.id))
/** 全部列表歌曲行（v5→v6 迁移的回读比对用：迁移只建新表，这份数据一个字段都不该动） */
const readAllListMusics = (file: string) => inspect(file, db => db
  .prepare('SELECT "id", "listId", "name", "singer", "source", "interval", "meta" FROM "main"."my_list_music_info" ORDER BY "listId", "id"')
  .all() as Array<{ id: string, listId: string, name: string, singer: string, source: string, interval: number | null, meta: string }>)
const readDislikeRows = (file: string) => inspect(file, db => db
  .prepare('SELECT "type", "content", "meta" FROM "main"."dislike_list" ORDER BY "rowid"')
  .all())
const readDownloadRows = (file: string) => inspect(file, db => db
  .prepare('SELECT "id", "isComplate", "status", "statusText", "progress_downloaded", "progress_total", "quality", "ext", "fileName", "position" FROM "main"."download_list" ORDER BY "rowid"')
  .all() as Array<{ id: string, isComplate: number, status: string, statusText: string, progress_downloaded: number, progress_total: number, quality: string, ext: string, fileName: string, position: number }>)
/** `migrateV6` 迁移出的自建列表 id（与 `migrate.ts` 的字面量保持一致；名字是迁移产物，硬编码中文） */
const LEGACY_LOVE_LIST_ID = 'userlist_love_legacy'
/**
 * 去掉「迁移会动的那几档」后的计数，供守恒断言用：`default`（v3 → v4 起被清）、
 * `love`（v6 → v7 整档迁进 legacy）、`userlist_love_legacy`（v6 → v7 新建）。
 */
const stableCounts = (counts: Record<string, number>) => Object.fromEntries(
  Object.entries(counts).filter(([listId]) => !['default', 'love', LEGACY_LOVE_LIST_ID].includes(listId)),
)

afterAll(() => {
  try {
    getDB()?.close()
  } catch {}
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

describe('v2 → v5：`music_url` 加 `created_at`', () => {
  let dir: string
  let file: string

  beforeAll(() => {
    dir = newCaseDir()
    file = createLegacyDb(dir, '2')
    expect(readColumns(file)).toEqual(['id', 'url']) // 前提：这份库确实是旧结构
    expect(readVersion(file)).toBe('2')
  })

  it('dbService.init 返回 true（不是 null：不会走到「改名备份 + 重建空库」那条路）', () => {
    expect(init(dir)).toBe(true)
    // `init` 只在 verifyDB 通过时才返回 dbFileExists，这里再断言一次，把判据钉在同一处
    expect(verifyDB(getDB())).toBe(true)
  })

  it('表多出 created_at 列，老行一行不少、url 逐字符没动，且 created_at 都是 0', () => {
    expect(readColumns(file)).toEqual(['id', 'url', 'created_at'])
    const rows = readRows(file)
    expect(rows.map(row => [row.id, row.url])).toEqual(LEGACY_ROWS)
    expect(rows.every(row => row.createdAt === 0)).toBe(true)
  })

  it('版本号升到 DB_VERSION；别的表一行没动；没留下迁移用的临时表', () => {
    expect(DB_VERSION).toBe('7')
    expect(readVersion(file)).toBe(DB_VERSION)
    expect(readLyricCount(file)).toBe(1)
    // 迁移中途改名出来的表必须收干净。`sqlite_stat*` 是 `init` 里 `PRAGMA optimize` 建的，不算数
    const tableNames = readTableNames(file).filter(name => !name.startsWith('sqlite_stat'))
    expect(tableNames).toEqual([
      'db_info',
      'dislike_list',
      'download_list',
      'follow_feed_baseline',
      'follow_feed_item',
      'local_library_track',
      'lyric',
      'music_info_other_source',
      'music_url',
      'my_list',
      'my_list_music_info',
      'my_list_music_info_order',
      'sqlite_sequence',
    ])
  })

  it('幂等：再跑一次 init 仍返回 true，行数与时间戳都不变（不会重复搬数据）', () => {
    expect(init(dir)).toBe(true)
    expect(verifyDB(getDB())).toBe(true)
    expect(readVersion(file)).toBe(DB_VERSION)
    expect(readRows(file).map(row => [row.id, row.url, row.createdAt])).toEqual(LEGACY_ROWS.map(([id, url]) => [id, url, 0]))
  })
})

describe('v1 → v5：连做四版迁移（`dislike_list` 与 `created_at` 一起补）', () => {
  let dir: string
  let file: string

  beforeAll(() => {
    dir = newCaseDir()
    file = createLegacyDb(dir, '1')
    expect(readTableNames(file)).not.toContain('dislike_list')
    expect(readColumns(file)).toEqual(['id', 'url'])
  })

  it('dbService.init 返回 true，且两版迁移都落了地', () => {
    expect(init(dir)).toBe(true)
    expect(verifyDB(getDB())).toBe(true)
    expect(readVersion(file)).toBe(DB_VERSION)
    expect(readColumns(file)).toEqual(['id', 'url', 'created_at'])
    expect(readTableNames(file)).toContain('dislike_list')
    expect(readRows(file).map(row => [row.id, row.url, row.createdAt])).toEqual(LEGACY_ROWS.map(([id, url]) => [id, url, 0]))
  })
})

describe('半迁移状态（列已在、定义与 `tables` 不同、版本号还是 2）：重建归一化，时间戳不丢', () => {
  let dir: string
  let file: string
  /** 手写 `ALTER TABLE ... ADD COLUMN` 会留下的定义（带 DEFAULT，与 `tables` 的原文不同） */
  const ALTERED_TIMESTAMP = 1_600_000_000_000

  beforeAll(() => {
    dir = newCaseDir()
    file = createLegacyDb(dir, '2')
    inspect(file, db => {
      db.exec('ALTER TABLE "music_url" ADD COLUMN "created_at" INTEGER NOT NULL DEFAULT 0;')
      db.prepare('UPDATE "main"."music_url" SET "created_at" = ? WHERE "id" = ?').run(ALTERED_TIMESTAMP, LEGACY_ROWS[0][0])
    })
    expect(readColumns(file)).toEqual(['id', 'url', 'created_at'])
  })

  it('init 返回 true（重建把定义归一化回 `tables`，而不是因为定义不同就卡在校验上）', () => {
    expect(init(dir)).toBe(true)
    expect(verifyDB(getDB())).toBe(true)
    const definition = inspect(file, db => (db
      .prepare('SELECT "sql" FROM "main".sqlite_master WHERE "name" = \'music_url\'')
      .get() as { sql: string }).sql)
    // 归一化的判据：库里这串 SQL 与 `tables` 的原文等价（`verifyDB` 用同一套正常化规则）
    expect(definition.replace(/\n|\s|;|--.+/g, '')).toBe(tables.get('music_url')!.replace(/\n|\s|;|--.+/g, ''))
  })

  it('已经写入的真实时间戳被保留（不是统统抹成 0）', () => {
    expect(readRows(file).find(row => row.id == LEGACY_ROWS[0][0])!.createdAt).toBe(ALTERED_TIMESTAMP)
    expect(readRows(file).filter(row => row.id != LEGACY_ROWS[0][0]).every(row => row.createdAt === 0)).toBe(true)
  })
})

describe('空目录（没有库文件）：新建的库直接是 v6 结构', () => {
  let dir: string
  let file: string

  beforeAll(() => {
    dir = newCaseDir()
    file = dbFileOf(dir)
  })

  it('init 返回 false（= 新建库，不是 null）且校验通过、带 created_at', () => {
    expect(init(dir)).toBe(false)
    expect(verifyDB(getDB())).toBe(true)
    expect(readVersion(file)).toBe(DB_VERSION)
    expect(readColumns(file)).toEqual(['id', 'url', 'created_at'])
  })
})

describe('迁移后的库上：写入 / 回收 / 精确删真的能跑通（验语句绑定的列名）', () => {
  let dir: string
  let file: string

  beforeAll(() => {
    dir = newCaseDir()
    file = createLegacyDb(dir, '2')
    expect(init(dir)).toBe(true)
  })

  it('新写入的行带真实时间戳（`insertMusicUrl` 写的是 Date.now()，不是 0）', () => {
    const before = Date.now()
    musicUrlSave([{ id: '3001_128k', url: 'https://example.invalid/3001?sign=ddd' }])
    const row = readRows(file).find(item => item.id == '3001_128k')!
    expect(row.createdAt).toBeGreaterThanOrEqual(before)
    expect(row.createdAt).toBeLessThanOrEqual(Date.now())
  })

  it('keepDays=1：老库那批 `created_at = 0` 的行按「最旧」被回收，新行留着', () => {
    const result = musicUrlRecycle({ keepDays: 1, maxSizeMB: 0 })
    expect(result.skipped).toBe(false)
    expect(result.deleted).toBe(LEGACY_ROWS.length)
    expect(readRows(file).map(row => row.id)).toEqual(['3001_128k'])
  })

  it('两个阈值都是 0（默认）= 不回收：连库都不读，行数不变', () => {
    const countBefore = musicUrlCount()
    const result = musicUrlRecycle({ keepDays: 0, maxSizeMB: 0 })
    expect(result.skipped).toBe(true)
    expect(result.bytesBefore).toBe(null)
    expect(result.bytesAfter).toBe(null)
    expect(musicUrlCount()).toBe(countBefore)
  })

  it('`musicUrlRemove` 按 id 精确删（`deleteMusicUrl` 的真实调用路径）', () => {
    musicUrlRemove(['3001_128k'])
    expect(musicUrlCount()).toBe(0)
    expect(readRows(file)).toEqual([])
  })
})

/**
 * 旧库夹具：默认**自己造**一份形状一致的 v3 旧库（= 票 08 之前的真库样子：`musics.fcg` 那版的
 * `music_url` 已经有 `created_at`、版本号 `'3'`，列表数据里还带着「试听列表」那一档），
 * 于是下面两组**每次都跑**；设了 `CHIVERVE_LEGACY_DB` 就改用那份**真库副本**（也不再跳过）。
 *
 * 为什么是 v3：`v3 → v4` 才是票 08 的清行迁移，而用户手上的库就是 `'3'`（`'1'`/`'2'` → 最新的
 * 多版链路由上面几组用例覆盖）。夹具里刻意塞进四档列表数据，用来证明迁移**只**删试听列表：
 * - `default`：3 首（迁移后必须清零，票 08 契约 1）
 * - `love`：2 首（一行不动）
 * - `temp`：2 首（一行不动）
 * - 一条自建列表（`my_list` 行 + 2 首，一行不动）
 */
const legacyDbPath = process.env.CHIVERVE_LEGACY_DB

/** 夹具里的列表数据（id 是合成的，不含任何真实歌曲信息） */
const LEGACY_LIST_ROWS: Record<string, string[]> = {
  default: ['d1', 'd2', 'd3'],
  love: ['l1', 'l2'],
  temp: ['t1', 't2'],
  userlist_fixture: ['u1', 'u2'],
}

/** 往 `my_list_music_info` + `my_list_music_info_order` 写同一档列表的若干首歌 */
const insertLegacyListMusics = (db: BetterSqlite3.Database, listId: string, musicIds: string[]) => {
  const insertMusic = db.prepare('INSERT INTO "main"."my_list_music_info" ("id", "listId", "name", "singer", "source", "interval", "meta") VALUES (?, ?, ?, ?, ?, ?, ?)')
  const insertOrder = db.prepare('INSERT INTO "main"."my_list_music_info_order" ("listId", "musicInfoId", "order") VALUES (?, ?, ?)')
  musicIds.forEach((musicId, index) => {
    insertMusic.run(musicId, listId, `song_${musicId}`, 'singer', 'tx', 200, '{}')
    insertOrder.run(listId, musicId, index)
  })
}

/** v3 旧库：表结构与当前 `tables` 完全一致，版本号写 `'3'`，列表数据含四档 */
const legacyFixture = (dir: string) => {
  const file = dbFileOf(dir)
  if (legacyDbPath) {
    // 真库副本：连同 -wal/-shm 一起拷（应用可能在跑，主文件里未必含未 checkpoint 的事务）
    fs.copyFileSync(legacyDbPath, file)
    for (const suffix of ['-wal', '-shm']) {
      if (fs.existsSync(`${legacyDbPath}${suffix}`)) fs.copyFileSync(`${legacyDbPath}${suffix}`, `${file}${suffix}`)
    }
    return file
  }
  const db = new Database(file)
  db.exec(Array.from(tables.entries()).filter(([name]) => name != 'local_library_track').map(([, sql]) => sql).join('\n'))
  db.prepare('INSERT INTO "main"."db_info" ("field_name", "field_value") VALUES (?, ?)').run('version', '3')
  const insertUrl = db.prepare('INSERT INTO "main"."music_url" ("id", "url", "created_at") VALUES (?, ?, ?)')
  db.transaction(() => {
    // 一次事务写完：800 行逐条受自动提交会明显拖慢这条用例
    for (let song = 1; song <= 400; song++) {
      for (const quality of ['128k', '320k']) {
        // 刻意不含任何真实 URL（与 LEGACY_ROWS 同口径）；created_at 统一 0 = 加列之前的行
        insertUrl.run(`${song}_${quality}`, `https://example.invalid/${song}?quality=${quality}`, 0)
      }
    }
    db.prepare('INSERT INTO "main"."my_list" ("id", "name", "source", "sourceListId", "position", "locationUpdateTime") VALUES (?, ?, ?, ?, ?, ?)')
      .run('userlist_fixture', '旧库自建列表', null, null, 0, 0)
    for (const [listId, musicIds] of Object.entries(LEGACY_LIST_ROWS)) insertLegacyListMusics(db, listId, musicIds)
  })()
  db.prepare('INSERT INTO "main"."lyric" ("id", "source", "type", "text") VALUES (?, ?, ?, ?)')
    .run('2001', 'tx', 'lrc', '[00:00.00]合成旧库里的歌词')
  db.close()
  return file
}

describe('旧库（合成件；设 CHIVERVE_LEGACY_DB 时用真库副本）：dbService.init 返回 true 且老数据一行不少', () => {
  it('实测一份旧库（结构 + 行数）', () => {
    const dir = newCaseDir()
    const file = legacyFixture(dir)

    const versionBefore = readVersion(file)
    const columnsBefore = readColumns(file)
    const rowsBefore = readRows(file)
    const bytesBefore = inspect(file, db => (db.prepare('SELECT COALESCE(SUM(LENGTH("id") + LENGTH("url")), 0) AS "bytes" FROM "main"."music_url"').get() as { bytes: number }).bytes)
    // 列表侧的迁移前状态：试听列表那档在不在、其余几档各有多少行
    const listCountsBefore = readListMusicCounts(file)
    const userListIdsBefore = readUserListIds(file)
    console.log('[migrate.test] 旧库（%s）：version=%s, music_url 行数=%d, 近似占用=%d 字节, 列=%s',
      legacyDbPath ? '真库副本' : '合成件', versionBefore, rowsBefore.length, bytesBefore, columnsBefore.join('/'))
    console.log('[migrate.test] 迁移前列表行数：%s（my_list 里的自建列表：%s）',
      JSON.stringify(listCountsBefore), JSON.stringify(userListIdsBefore))
    // 前提：这份库确实是**比当前旧**的库。合成件固定是 `'3'`；真库副本随用户手上那份走
    // （票 08 之后是 `'4'`、媒体库票 01 之后是 `'5'`），所以这里只要求「数值上旧于 DB_VERSION」。
    expect(Number(versionBefore)).toBeLessThan(Number(DB_VERSION))
    expect(versionBefore).not.toBe(DB_VERSION)
    expect(columnsBefore).toEqual(['id', 'url', 'created_at'])

    expect(init(dir)).toBe(true)
    expect(verifyDB(getDB())).toBe(true)

    const columnsAfter = readColumns(file)
    const rowsAfter = readRows(file)
    console.log('[migrate.test] 迁移后：version=%s, music_url 行数=%d, 行内容逐行不变=%s',
      readVersion(file), rowsAfter.length,
      JSON.stringify(rowsAfter.map(row => [row.id, row.createdAt])) == JSON.stringify(rowsBefore.map(row => [row.id, row.createdAt])))
    expect(readVersion(file)).toBe(DB_VERSION)
    expect(columnsAfter).toEqual(['id', 'url', 'created_at'])
    // 逐行（id + url + created_at）原样：这份库已经是 v3，v4 只清列表行，`music_url` 一个字节都不该动
    expect(rowsAfter.map(row => [row.id, row.url, row.createdAt])).toEqual(rowsBefore.map(row => [row.id, row.url, row.createdAt]))
    expect(readLyricCount(file)).toBeGreaterThan(0)
  })

  it('试听列表被真删、我的收藏迁成 legacy 列表，其余列表一首不少（票 08 契约 1 + ADR-0013）', () => {
    const dir = newCaseDir()
    const file = legacyFixture(dir)
    const listCountsBefore = readListMusicCounts(file)
    const orderCountsBefore = readListOrderCounts(file)
    const userListIdsBefore = readUserListIds(file)

    expect(init(dir)).toBe(true)

    const listCountsAfter = readListMusicCounts(file)
    const orderCountsAfter = readListOrderCounts(file)
    console.log('[migrate.test] 列表行数 %s → %s；排序行数 %s → %s',
      JSON.stringify(listCountsBefore), JSON.stringify(listCountsAfter),
      JSON.stringify(orderCountsBefore), JSON.stringify(orderCountsAfter))
    // 真删：两处「default」都清零（不是搬进收藏，也不是留成孤儿行）
    expect(listCountsAfter.default ?? 0).toBe(0)
    expect(orderCountsAfter.default ?? 0).toBe(0)
    // 迁移：love 整档改挂到 legacy（条目行与排序行一起走，数量守恒）
    expect(listCountsAfter.love ?? 0).toBe(0)
    expect(orderCountsAfter.love ?? 0).toBe(0)
    expect(listCountsAfter[LEGACY_LOVE_LIST_ID] ?? 0).toBe(listCountsBefore.love ?? 0)
    expect(orderCountsAfter[LEGACY_LOVE_LIST_ID] ?? 0).toBe(orderCountsBefore.love ?? 0)
    // 其余档逐项守恒（临时 / 自建列表一首都没少）
    expect(stableCounts(listCountsAfter)).toEqual(stableCounts(listCountsBefore))
    expect(stableCounts(orderCountsAfter)).toEqual(stableCounts(orderCountsBefore))
    // `my_list`：default/love 从来不在表里；love 有歌时新增一条 legacy 列表行（真库副本 love 可能为空）
    expect(readUserListIds(file)).not.toContain('default')
    expect(readUserListIds(file)).not.toContain('love')
    expect(readUserListIds(file).includes(LEGACY_LOVE_LIST_ID)).toBe((listCountsBefore.love ?? 0) > 0)
    // 非迁移新增的自建列表一行不多不少（legacy 排在末尾，顺序断言见 v6 → v7 组）
    expect(readUserListIds(file).filter(id => id != LEGACY_LOVE_LIST_ID)).toEqual(userListIdsBefore)
  })
})

/**
 * 同一份旧库夹具上把两个阈值**真跑一遍**（票 08 验收 2 / 3 的数据层等价物）。
 *
 * 验收原文是「重启应用后看到行数变化」——「重启」那半截是 `main/app.ts` 的 `initAppSetting` →
 * `recycleMusicUrlCache`（读代码 + 看主进程日志），这半截（挑行 / 删行 / 计量）在这里用真数据量跑。
 * 为了让场景与「升级后的稳态」一致，先把所有行的 `created_at` 刷成现在（迁移上来的老行都是 0），
 * 再把一行改成两天前当「过期样本」。
 */
describe('旧库（合成件；设 CHIVERVE_LEGACY_DB 时用真库副本）：保留天数 / 容量上限真跑一遍', () => {
  const DAY = 24 * 60 * 60 * 1000

  it('keepDays=1 只删掉两天前那一条；maxSizeMB=1 把占用压到 1 MB 内', () => {
    const dir = newCaseDir()
    const file = legacyFixture(dir)
    expect(init(dir)).toBe(true)

    const now = Date.now()
    // 稳态：所有行都是「刚写进来的」
    getDB().prepare('UPDATE "main"."music_url" SET "created_at" = ?').run(now)
    const idsBefore = readRows(file).map(row => row.id)
    expect(idsBefore.length).toBeGreaterThan(1)

    // 过期样本：把第一行改成两天前
    const expiredId = idsBefore[0]
    getDB().prepare('UPDATE "main"."music_url" SET "created_at" = ? WHERE "id" = ?').run(now - 2 * DAY, expiredId)
    const byKeepDays = musicUrlRecycle({ keepDays: 1, maxSizeMB: 0 })
    const idsAfterKeepDays = readRows(file).map(row => row.id)
    console.log('[migrate.test] keepDays=1：回收前 %d 行 → 删了 %d 行 → 剩 %d 行（过期样本已删=%s）',
      idsBefore.length, byKeepDays.deleted, idsAfterKeepDays.length, !idsAfterKeepDays.includes(expiredId))
    expect(byKeepDays.deleted).toBe(1)
    expect(idsAfterKeepDays).toEqual(idsBefore.slice(1)) // 只少了第一行（顺序也照旧）

    // 容量：塞到远超 1 MB（约 200 字节 / 行），再用 maxSizeMB=1 压回上限内
    const bulk: LX.Music.MusicUrlInfo[] = []
    for (let index = 0; index < 6000; index++) {
      bulk.push({ id: `bulk_${index}_128k`, url: `https://example.invalid/bulk/${index}?sign=${'x'.repeat(160)}` })
    }
    for (let index = 0; index < bulk.length; index += 500) musicUrlSave(bulk.slice(index, index + 500))

    const bytesBeforeMaxSize = inspect(file, db => (db.prepare('SELECT COALESCE(SUM(LENGTH("id") + LENGTH("url")), 0) AS "bytes" FROM "main"."music_url"').get() as { bytes: number }).bytes)
    const rowsBeforeMaxSize = readRows(file).length
    const byMaxSize = musicUrlRecycle({ keepDays: 0, maxSizeMB: 1 })
    const bytesAfterMaxSize = inspect(file, db => (db.prepare('SELECT COALESCE(SUM(LENGTH("id") + LENGTH("url")), 0) AS "bytes" FROM "main"."music_url"').get() as { bytes: number }).bytes)
    const idsAfterMaxSize = readRows(file).map(row => row.id)
    console.log('[migrate.test] maxSizeMB=1：回收前 %d 行 / %d 字节 → 删了 %d 行 → 剩 %d 行 / %d 字节（上限 %d）',
      rowsBeforeMaxSize, bytesBeforeMaxSize, byMaxSize.deleted, idsAfterMaxSize.length, bytesAfterMaxSize, 1024 * 1024)
    expect(bytesBeforeMaxSize).toBeGreaterThan(1024 * 1024)
    expect(byMaxSize.deleted).toBeGreaterThan(0)
    expect(bytesAfterMaxSize).toBeLessThanOrEqual(1024 * 1024)
    // 从最旧的一端删：最后写进来的那条一定还在（它是最新的）
    expect(idsAfterMaxSize).toContain('bulk_5999_128k')
    // 而迁移上来的老行时间戳最早 → 先被删（口径：旧的先走）
    expect(idsAfterMaxSize.length).toBeLessThan(rowsBeforeMaxSize)
  })
})

/**
 * 两种「历史库形态」的兜底（2026-09-26 全历史自审查发现）。
 *
 * 两条在旧实现里都会**抛异常**，而 `init` 的异常会一路冒到 `initAppSetting`（那里没有 catch）→
 * 建窗口的代码永不执行、界面根本不出现、也没有任何弹窗。所以各钉一条，保证走的是
 * 「迁移/建表 → 校验」而不是「崩在 `init` 里」。
 */
describe('缺 version 行的库（比 v1 更早的形态）：按 v1 起迁移，不再抛 TypeError', () => {
  it('init 返回 true，且版本号被写成 DB_VERSION', () => {
    const dir = newCaseDir()
    const file = dbFileOf(dir)
    const db = new Database(file)
    // 当前结构、但不写 db_info 的 version 行——旧实现读 `.field_value` 时在这里 TypeError
    db.exec(Array.from(tables.values()).join('\n'))
    db.close()

    expect(init(dir)).toBe(true)
    expect(readVersion(file)).toBe(DB_VERSION)
  })
})

describe('缺 music_url 表的库：按当前定义直接建表，不再抛 SqliteError', () => {
  it('init 返回 true，建出来的表自带 created_at', () => {
    const dir = newCaseDir()
    const file = dbFileOf(dir)
    const db = new Database(file)
    // v1 形态：只差 music_url 这张表（旧实现的 `ALTER TABLE ... RENAME` 会在这里抛错）
    db.exec(Array.from(tables.entries())
      .filter(([name]) => name != 'music_url')
      .map(([, sql]) => sql)
      .join('\n'))
    db.exec('INSERT INTO "main"."db_info" ("field_name", "field_value") VALUES (\'version\', \'1\');')
    db.close()

    expect(init(dir)).toBe(true)
    expect(readColumns(file)).toContain('created_at')
    expect(readVersion(file)).toBe(DB_VERSION)
  })
})

/**
 * v4 → v5（关注动态票 02）：补 `follow_feed_baseline` / `follow_feed_item` 两张表。
 *
 * 这份夹具的形态就是**用户手上那个 v4 库**：其余表齐全、只差关注动态这两种。
 * 两张都是新表、没有旧数据要搬，所以判据是：`init` 返回 true、两张表按 `tables` 的定义建出来
 * （`verifyDB` 的逐字符校验会验）、既有数据一行不少、且**不预置任何行**（空基线 = 「还没建过基线」，
 * 首次检查会静默建立它——首次静默是用户明确要的行为）。
 * 另钉一条幂等：版本号被回写成 `'4'` 时再跑一次不许因为「表已存在」而抛错
 * （抛错会让 `init` 收成 `null` → 用户库被改名备份后重建空库）。
 */
describe('v4 → v5：补关注动态两张表', () => {
  /** 造一份只差关注动态两张表的 v4 库（其余表全用当前定义，另塞两行既有数据证明迁移没碰它们） */
  const createV4Db = (dir: string) => {
    const file = dbFileOf(dir)
    const db = new Database(file)
    db.exec(Array.from(tables.entries())
      .filter(([name]) => name != 'follow_feed_baseline' && name != 'follow_feed_item')
      .map(([, sql]) => sql)
      .join('\n'))
    db.exec('INSERT INTO "main"."db_info" ("field_name", "field_value") VALUES (\'version\', \'4\');')
    db.prepare('INSERT INTO "main"."my_list" ("id", "name", "source", "sourceListId", "position", "locationUpdateTime") VALUES (?, ?, ?, ?, ?, ?)')
      .run('userlist_v4', 'v4 库里的自建列表', null, null, 0, 0)
    db.prepare('INSERT INTO "main"."dislike_list" ("type", "content") VALUES (\'music\', ?)').run('旧库里的不喜欢@singer')
    db.close()
    return file
  }

  it('init 返回 true；两张表建出来；旧数据一行不少；基线为空', () => {
    const dir = newCaseDir()
    const file = createV4Db(dir)
    expect(readTableNames(file)).not.toContain('follow_feed_baseline')
    const listIdsBefore = readUserListIds(file)

    expect(init(dir)).toBe(true)
    expect(verifyDB(getDB())).toBe(true)
    expect(readVersion(file)).toBe(DB_VERSION)
    expect(readTableNames(file)).toContain('follow_feed_baseline')
    expect(readTableNames(file)).toContain('follow_feed_item')
    expect(readUserListIds(file)).toEqual(listIdsBefore)
    expect(followFeedBaselineAll()).toEqual([])
    expect(followFeedItemsGet()).toEqual([])
  })

  it('幂等：版本号被回写成 4 再跑一次不抛错（表已存在时不许 CREATE 硬撞）', () => {
    const dir = newCaseDir()
    const file = createV4Db(dir)
    expect(init(dir)).toBe(true)
    // 模拟「从旧备份还原了配置」把版本号带回 v4 的场景
    inspect(file, db => {
      db.prepare('UPDATE "main"."db_info" SET "field_value"=? WHERE "field_name"=?').run('4', 'version')
    })
    expect(init(dir)).toBe(true)
    expect(verifyDB(getDB())).toBe(true)
    expect(readVersion(file)).toBe(DB_VERSION)
  })
})

/**
 * v5 → v6（本地媒体库票 01）：补 `local_library_track` 表。
 *
 * 夹具形态 = 用户手上的 v5 库：其余表齐全、只差媒体库这一张。新表、没有旧数据要搬，
 * 判据：`init` 返回 true、表按 `tables` 的定义建出来（`verifyDB` 逐字符校验会验）、
 * 既有数据一行不少、曲目表**为空**（不预置任何行——空库 = 「还没导入过」，导入是票 02 的事）。
 * 另钉一条幂等：版本号被回写成 `'5'` 时重跑不许因「表已存在」抛错
 * （抛错会让 `init` 收成 `null` → 用户库被改名备份后重建空库）。
 * ⚠️ 迁移链现在会继续跑到 v7（集合概念统一）：下载夹具里那条**已完成**记录会被 `migrateV6` 清掉，
 * 本组按最终态断言（见「已完成下载被清」）。
 */
describe('v5 → v6：补本地媒体库表', () => {
  /** 造一份只差 `local_library_track` 的 v5 库（其余表全用当前定义，塞几行既有数据证明迁移没碰它们） */
  const createV5Db = (dir: string) => {
    const file = dbFileOf(dir)
    const db = new Database(file)
    db.exec(Array.from(tables.entries())
      .filter(([name]) => name != 'local_library_track')
      .map(([, sql]) => sql)
      .join('\n'))
    db.exec('INSERT INTO "main"."db_info" ("field_name", "field_value") VALUES (\'version\', \'5\');')
    db.transaction(() => {
      db.prepare('INSERT INTO "main"."my_list" ("id", "name", "source", "sourceListId", "position", "locationUpdateTime") VALUES (?, ?, ?, ?, ?, ?)')
        .run('userlist_v5', 'v5 库里的自建列表', null, null, 0, 0)
      insertLegacyListMusics(db, 'userlist_v5', ['v5s1', 'v5s2'])
      db.prepare('INSERT INTO "main"."dislike_list" ("type", "content") VALUES (\'music\', ?)').run('v5 库里的不喜欢@singer')
      db.prepare('INSERT INTO "main"."music_url" ("id", "url", "created_at") VALUES (?, ?, ?)').run('v5_128k', 'https://example.invalid/v5', 0)
      // 下载两条：已完成（v6 → v7 要清）与未完成（保留可续）
      const insertDownload = db.prepare('INSERT INTO "main"."download_list" ("id", "isComplate", "status", "statusText", "progress_downloaded", "progress_total", "url", "quality", "ext", "fileName", "filePath", "musicInfo", "position") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      insertDownload.run('dl_v5_done', 1, 'done', '已完成', 100, 100, null, '128k', 'mp3', 'v5_done.mp3', '/downloads/v5_done.mp3', '{}', 0)
      insertDownload.run('dl_v5_pending', 0, 'waiting', '等待中', 0, 100, null, '128k', 'mp3', 'v5_pending.mp3', '/downloads/v5_pending.mp3', '{}', 1)
    })()
    db.close()
    return file
  }

  it('init 返回 true；媒体库表建出来；列表/缓存/不喜欢无损、已完成下载被清（v7）；曲目表为空', () => {
    const dir = newCaseDir()
    const file = createV5Db(dir)
    expect(readTableNames(file)).not.toContain('local_library_track')
    const listIdsBefore = readUserListIds(file)
    const urlsBefore = readRows(file)
    const listMusicsBefore = readAllListMusics(file)
    const dislikesBefore = readDislikeRows(file)
    const downloadsBefore = readDownloadRows(file)

    expect(init(dir)).toBe(true)
    expect(verifyDB(getDB())).toBe(true)
    expect(readVersion(file)).toBe(DB_VERSION)
    expect(readTableNames(file)).toContain('local_library_track')
    // 列表 / 曲目缓存 / 不喜欢逐行原样；下载只剩未完成项（已完成行随 v7 的 migrateV6 清除）
    expect(readUserListIds(file)).toEqual(listIdsBefore)
    expect(readRows(file)).toEqual(urlsBefore)
    expect(readAllListMusics(file)).toEqual(listMusicsBefore)
    expect(readDislikeRows(file)).toEqual(dislikesBefore)
    expect(readDownloadRows(file)).toEqual(downloadsBefore.filter(row => row.isComplate != 1))
    expect(localLibraryAll()).toEqual([])
    expect(localLibraryCount()).toBe(0)
  })

  it('幂等：版本号被回写成 5 再跑一次不抛错（表已存在时不许 CREATE 硬撞）', () => {
    const dir = newCaseDir()
    const file = createV5Db(dir)
    expect(init(dir)).toBe(true)
    // 模拟「从旧备份还原了配置」把版本号带回 v5 的场景
    inspect(file, db => {
      db.prepare('UPDATE "main"."db_info" SET "field_value"=? WHERE "field_name"=?').run('5', 'version')
    })
    expect(init(dir)).toBe(true)
    expect(verifyDB(getDB())).toBe(true)
    expect(readVersion(file)).toBe(DB_VERSION)
  })
})

/**
 * v6 → v7（集合概念统一，ADR-0013 / spec `.scratch/functional-logic-consolidation/spec.md`）：
 * love 迁 legacy、default 清残余、旧式条目清除、已完成下载清行、`local_library_track` 重建加 origin。
 *
 * 夹具形态 = 用户手上的 v6 库：`local_library_track` 是**旧定义**（无 origin 列，v6 时代原文）。
 * 数据刻意铺满判据面：
 * - love 2 首（迁 legacy：条目行 + 排序行）；default 1 首（清残余）
 * - 旧式本地条目 2 首（`source='local'` 无 trackId：一首正常 meta、一首**坏 JSON**——判据必须容忍）
 * - 托管本地条目 1 首（`trackId` = id，必须留下）；temp 2 首、自建列表 2 首（原样）
 * - download_list 1 完成（清）+ 1 未完成（留）；库行 1 首（补 origin='import'）
 */
describe('v6 → v7：集合概念统一（love 迁移 / 旧式条目清除 / 下载清行 / origin 列）', () => {
  /** v6 时代的 `local_library_track` 原文（`git show HEAD:src/main/worker/dbService/tables.ts`，无 origin 列） */
  const LEGACY_LOCAL_LIBRARY_SQL = `
    CREATE TABLE "local_library_track" (
      "id" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "singer" TEXT NOT NULL,
      "album" TEXT,
      "interval" TEXT,
      "ext" TEXT NOT NULL,
      "size" INTEGER NOT NULL,
      "year" TEXT,
      "genre" TEXT,
      "track_num" TEXT,
      "disc_num" TEXT,
      "has_pic" INTEGER NOT NULL,
      "has_lyric" INTEGER NOT NULL,
      "imported_at" INTEGER NOT NULL,
      PRIMARY KEY("id")
    );
  `
  const HOSTED_HASH = 'a'.repeat(40)

  const readLocalLibraryColumns = (file: string) => inspect(file, db => (db.pragma('table_info("local_library_track")') as Array<{ name: string }>).map(column => column.name))
  const readLocalLibraryOrigins = (file: string) => inspect(file, db => db
    .prepare('SELECT "id", "origin" FROM "main"."local_library_track" ORDER BY "id"')
    .all() as Array<{ id: string, origin: string }>)

  const createV6Db = (dir: string) => {
    const file = dbFileOf(dir)
    const db = new Database(file)
    db.exec(Array.from(tables.entries())
      .map(([name, sql]) => name == 'local_library_track' ? LEGACY_LOCAL_LIBRARY_SQL : sql)
      .join('\n'))
    db.exec('INSERT INTO "main"."db_info" ("field_name", "field_value") VALUES (\'version\', \'6\');')
    db.transaction(() => {
      db.prepare('INSERT INTO "main"."my_list" ("id", "name", "source", "sourceListId", "position", "locationUpdateTime") VALUES (?, ?, ?, ?, ?, ?)')
        .run('userlist_v6', 'v6 库里的自建列表', null, null, 0, 0)
      insertLegacyListMusics(db, 'love', ['lv1', 'lv2'])
      insertLegacyListMusics(db, 'default', ['df1'])
      insertLegacyListMusics(db, 'temp', ['tp1', 'tp2'])
      insertLegacyListMusics(db, 'userlist_v6', ['v6s1', 'v6s2'])
      // 旧式本地条目（source='local'、meta 无 trackId）：一首正常、一首坏 JSON（判据必须容忍）
      const insertMusic = db.prepare('INSERT INTO "main"."my_list_music_info" ("id", "listId", "name", "singer", "source", "interval", "meta") VALUES (?, ?, ?, ?, ?, ?, ?)')
      const insertOrder = db.prepare('INSERT INTO "main"."my_list_music_info_order" ("listId", "musicInfoId", "order") VALUES (?, ?, ?)')
      insertMusic.run('local_/Music/old1.mp3', 'userlist_v6', '旧式一', 'singer', 'local', 100, JSON.stringify({ filePath: '/Music/old1.mp3' }))
      insertOrder.run('userlist_v6', 'local_/Music/old1.mp3', 2)
      insertMusic.run('local_/Music/old2.flac', 'temp', '旧式二', 'singer', 'local', 100, 'not-json')
      insertOrder.run('temp', 'local_/Music/old2.flac', 2)
      // 托管条目（trackId = id）：必须留下
      insertMusic.run(HOSTED_HASH, 'userlist_v6', '托管歌', 'singer', 'local', 100, JSON.stringify({ trackId: HOSTED_HASH, filePath: `/media/${HOSTED_HASH}.mp3` }))
      insertOrder.run('userlist_v6', HOSTED_HASH, 3)
      // 库行（旧定义无 origin 列）
      db.prepare('INSERT INTO "main"."local_library_track" ("id", "name", "singer", "album", "interval", "ext", "size", "year", "genre", "track_num", "disc_num", "has_pic", "has_lyric", "imported_at") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(HOSTED_HASH, '托管歌', 'singer', null, 100, 'mp3', 1000, null, null, null, null, 0, 0, 1)
      // 下载：1 完成（清） + 1 未完成（留）
      const insertDownload = db.prepare('INSERT INTO "main"."download_list" ("id", "isComplate", "status", "statusText", "progress_downloaded", "progress_total", "url", "quality", "ext", "fileName", "filePath", "musicInfo", "position") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      insertDownload.run('dl_done', 1, 'done', '已完成', 100, 100, null, '128k', 'mp3', 'done.mp3', '/downloads/done.mp3', '{}', 0)
      insertDownload.run('dl_pending', 0, 'waiting', '等待中', 0, 100, null, '128k', 'mp3', 'pending.mp3', '/downloads/pending.mp3', '{}', 1)
    })()
    db.close()
    return file
  }

  it('迁移落地：love 迁 legacy、default/旧式条目/已完成下载清零、origin 列补上', () => {
    const dir = newCaseDir()
    const file = createV6Db(dir)
    // 前提：这份库确实是 v6 结构（local_library_track 无 origin 列、版本号 6）
    expect(readLocalLibraryColumns(file)).not.toContain('origin')
    expect(readVersion(file)).toBe('6')

    expect(init(dir)).toBe(true)
    expect(verifyDB(getDB())).toBe(true)
    expect(readVersion(file)).toBe(DB_VERSION)

    // love 整档改挂 legacy（条目行 + 排序行），default 清残余
    const listCounts = readListMusicCounts(file)
    const orderCounts = readListOrderCounts(file)
    expect(listCounts.love ?? 0).toBe(0)
    expect(orderCounts.love ?? 0).toBe(0)
    expect(listCounts.default ?? 0).toBe(0)
    expect(listCounts[LEGACY_LOVE_LIST_ID]).toBe(2)
    expect(orderCounts[LEGACY_LOVE_LIST_ID]).toBe(2)
    // legacy 列表行排在末尾（position = max + 1）
    expect(readUserListIds(file)).toEqual(['userlist_v6', LEGACY_LOVE_LIST_ID])
    // 旧式条目（含坏 meta 那首）连排序行一并清除；托管条目留下
    const localRows = readAllListMusics(file).filter(row => row.source == 'local')
    expect(localRows.map(row => [row.id, row.listId])).toEqual([[HOSTED_HASH, 'userlist_v6']])
    expect(orderCounts.temp).toBe(2)
    expect(orderCounts.userlist_v6).toBe(3)
    // 下载：已完成清、未完成留
    expect(readDownloadRows(file).map(row => row.id)).toEqual(['dl_pending'])
    // origin 列：旧行补 'import'（表结构由 verifyDB 逐字符校验，这里再钉列清单）
    expect(readLocalLibraryColumns(file)).toContain('origin')
    expect(readLocalLibraryOrigins(file)).toEqual([{ id: HOSTED_HASH, origin: 'import' }])
  })

  it('幂等：版本号被回写成 6 再跑一次不抛错、不重复建 legacy、旧行 origin 不被抹掉', () => {
    const dir = newCaseDir()
    const file = createV6Db(dir)
    expect(init(dir)).toBe(true)
    // 模拟「从旧备份还原了配置」把版本号带回 v6 的场景
    inspect(file, db => {
      db.prepare('UPDATE "main"."db_info" SET "field_value"=? WHERE "field_name"=?').run('6', 'version')
    })
    expect(init(dir)).toBe(true)
    expect(verifyDB(getDB())).toBe(true)
    expect(readUserListIds(file).filter(id => id == LEGACY_LOVE_LIST_ID)).toHaveLength(1)
    expect(readListMusicCounts(file)[LEGACY_LOVE_LIST_ID]).toBe(2)
    expect(readLocalLibraryOrigins(file)).toEqual([{ id: HOSTED_HASH, origin: 'import' }])
  })
})
