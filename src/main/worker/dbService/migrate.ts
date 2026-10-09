import type Database from 'better-sqlite3'
import { LIST_IDS } from '@common/constants'
import tables, { DB_VERSION } from './tables'
import { deleteUserLists } from './modules/list/dbHelper'

// const migrateV1 = (db: Database.Database) => {
//   const sql = `
//     DROP TABLE "main"."download_list";

//     CREATE TABLE "download_list" (
//       "id" TEXT NOT NULL,
//       "isComplate" INTEGER NOT NULL,
//       "status" TEXT NOT NULL,
//       "statusText" TEXT NOT NULL,
//       "progress_downloaded" INTEGER NOT NULL,
//       "progress_total" INTEGER NOT NULL,
//       "url" TEXT,
//       "quality" TEXT NOT NULL,
//       "ext" TEXT NOT NULL,
//       "fileName" TEXT NOT NULL,
//       "filePath" TEXT NOT NULL,
//       "musicInfo" TEXT NOT NULL,
//       "position" INTEGER NOT NULL,
//       PRIMARY KEY("id")
//     );
//   `
//   db.exec(sql)
//   db.prepare('UPDATE "main"."db_info" SET "field_value"=@value WHERE "field_name"=@name').run({ name: 'version', value: '2' })
// }

const migrateV1 = (db: Database.Database) => {
  // 修复 v2.4.0 的默认数据库版本号不对的问题
  const existsTable = db.prepare('SELECT name FROM "main".sqlite_master WHERE type=\'table\' AND name=\'dislike_list\';').get()
  if (!existsTable) {
    const sql = tables.get('dislike_list')!
    db.exec(sql)
  }
}

/**
 * v2 → v3：`music_url` 加 `created_at`（URL 缓存回收策略的时间依据，设置页重构票 08）。
 *
 * 四个刻意的做法：
 * 1. **重建表，列定义取自 `tables.get('music_url')` 的原样文本**（不是手写 `ALTER TABLE ADD COLUMN`）：
 *    `verifyDB` 是拿这张表在 `sqlite_master` 里的整串 SQL 与 `tables` 的文本比对的，重建能保证两边
 *    逐字符同源；手写 ALTER 是把列定义拼到原文末尾，差一个空格 / 引号 / 默认值就校验不过 →
 *    `db.init` 返回 `null` → 用户库被改名备份后**重建空库**。本文件的 `migrateV1` 也是这个套路。
 * 2. **整段进事务**：4 条语句（改名 / 建新表 / 搬数据 / 删旧表）中间失败会留下半迁移状态——
 *    事务回滚后旧表原样还在、版本号不动，下次启动重试；不回滚就可能只剩一张空表。
 * 3. **`created_at` 一律写 0**（老行没有时间信息）：回收时把 0 当**最旧**处理（见
 *    `modules/music_url/recycle.ts` 的口径），所以升级后第一次回收会把加列之前的缓存整批清掉，
 *    代价只是下次播放重新取流。
 * 4. **列已存在时也照样重建**：只对名字判存在（不比对定义），半迁移状态（列在但定义不同，
 *    如带 DEFAULT）会被这次重建**归一化**成 `tables.ts` 的定义，而不是被跳过。
 */
const migrateV2 = (db: Database.Database) => {
  // 极老的库（`music_url` 表还没出现）没有可迁移的数据，直接按当前定义建表——
  // 否则下面的 `ALTER TABLE ... RENAME` 会抛 SqliteError，而那条异常会让整个 `init` 失败。
  if (!hasTable(db, 'music_url')) {
    db.exec(tables.get('music_url')!)
    return
  }
  const hasCreatedAt = (db.pragma('table_info("music_url")') as Array<{ name: string }>)
    .some(column => column.name == 'created_at')
  const createdAtExpr = hasCreatedAt ? '"created_at"' : '0'
  db.transaction(() => {
    db.exec(`
      ALTER TABLE "music_url" RENAME TO "music_url_v2";
      ${tables.get('music_url')!}
      INSERT INTO "music_url" ("id", "url", "created_at")
        SELECT "id", "url", ${createdAtExpr} FROM "music_url_v2";
      DROP TABLE "music_url_v2";
    `)
  })()
}

/**
 * v3 → v4：删掉「试听列表」（`LIST_IDS.DEFAULT`）在库里的全部数据行（票 08 契约 1：**真删旧行**）。
 *
 * 四个刻意的做法：
 * 1. **走 `dbHelper` 的列表删除路径**（`deleteUserLists`，即 `list_remove` 事件那条路径）：它把
 *    `my_list` / `my_list_music_info` / `my_list_music_info_order` 三张表一次清干净，将来这条数据链
 *    多了别的表也不用回来改这里。`db` 参数只为与其它迁移函数对齐签名——`dbHelper` 取的是
 *    `getDB()`，而 `init` 在调 `migrateData(db)` 之前已经把同一个实例赋进去了。
 * 2. **不做任何搬运**：用户已明确接受「早版本里点过的歌不再找得回来」，所以既不迁进「我的收藏」，
 *    也不留备份行——库里、同步载荷、备份导出都不再有这个概念。
 * 3. **表结构一个字不动**：只是清行，所以 `tables.ts` 的建表 SQL / `verifyDB` 的逐字符校验不受影响，
 *    版本号抬一档只是为了让这次清行**有记录**（跑过就不再跑）。
 * 4. **幂等**：行不存在时 DELETE 影响 0 行；即便版本号被回写成 '3'（例如从旧备份还原了 config），
 *    重跑也只是再清一次。
 */
const migrateV3 = (db: Database.Database) => {
  deleteUserLists([LIST_IDS.DEFAULT])
}

/**
 * v4 → v5：补关注动态的两张表（`follow_feed_baseline` / `follow_feed_item`，票 02）。
 *
 * 三个刻意的做法：
 * 1. **两张都是新表，没有旧数据要搬**：只建表，所以拿 `tables.get(...)` 的原样文本 `exec` 即可
 *    （`verifyDB` 就是拿这份文本逐字符比对的，手写建表语句迟早会漂）。
 * 2. **建表前判存在**（同 `migrateV1` 的套路）：版本号被回写（例如从旧备份还原了 `config_v2.json`）
 *    时会重跑本版，而 `CREATE TABLE` 撞上已存在的表会抛 `SqliteError` ——
 *    那会让整个 `init` 失败（`db.ts` 收成 `null` → 用户库被改名备份后重建）。
 * 3. **不初始化任何行**：空基线 = 「还没建过基线」，关注动态的首次检查会静默建立它
 *    （首次静默是用户明确要的行为，见 spec）。
 */
const migrateV4 = (db: Database.Database) => {
  for (const name of ['follow_feed_baseline', 'follow_feed_item'] as const) {
    if (!hasTable(db, name)) db.exec(tables.get(name)!)
  }
}

/**
 * v5 → v6：补本地媒体库的曲目表（`local_library_track`，票 01）。
 *
 * 同 `migrateV4` 的套路：新表、没有旧数据要搬，拿 `tables.get(...)` 的原样文本建表；
 * 建表前判存在——版本号被回写（如从旧备份还原 config）会重跑本版，`CREATE TABLE`
 * 撞上已存在的表会抛 SqliteError，让整个 `init` 失败（收成 `null` → 用户库被改名备份后重建空库）。
 * 不初始化任何行：空曲目表 = 「还没导入过」，导入是渲染侧 worker 库服务（票 02）的事。
 */
const migrateV5 = (db: Database.Database) => {
  if (!hasTable(db, 'local_library_track')) db.exec(tables.get('local_library_track')!)
}

/** 表是否存在（迁移里要按库的实际形态分流，不能假设某张表一定在）。 */
const hasTable = (db: Database.Database, name: string) =>
  db.prepare('SELECT name FROM "main".sqlite_master WHERE type=\'table\' AND name=?').get(name) != null

/**
 * 读取库版本号。
 *
 * `db_info` 里没有 `version` 行（或值为空）时**按 '1' 处理**，不是报错：
 * 1. 这种库本来就来自比 v1 更早的版本，`migrateV1` 正是为它写的（补 `dislike_list` 表）；
 * 2. 旧实现直接 `.field_value` 会在缺失时抛 TypeError —— 那会让 `init` 失败、窗口都建不出来
 *    （2026-09-26 全历史自审查发现，配合 `db.ts` 的 try/catch 一起收敛）。
 */
const readVersion = (db: Database.Database): string => {
  const row = db.prepare('SELECT "field_value" FROM "main"."db_info" WHERE "field_name" = ?').get('version') as
    | { field_value?: unknown }
    | undefined
  const value = row?.field_value
  return value == null || value === '' ? '1' : String(value)
}

/**
 * 写入版本号。
 *
 * 用「先 UPDATE、没改到行就 INSERT」而不是一条 UPDATE：`db_info` 里可能**根本没有 version 行**
 * （比 v1 更早的库就长这样），而 UPDATE 打空时不会报错、只是静默什么都没写——
 * 结果就是迁移跑完了版本号还是缺的，下次启动再跑一遍（或校验不过 → 备份 + 重建空库）。
 */
const writeVersion = (db: Database.Database, version: string) => {
  const result = db.prepare('UPDATE "main"."db_info" SET "field_value"=@value WHERE "field_name"=@name').run({ name: 'version', value: version })
  if (result.changes === 0) {
    db.prepare('INSERT INTO "main"."db_info" ("field_name", "field_value") VALUES (@name, @value)').run({ name: 'version', value: version })
  }
}

export default (db: Database.Database) => {
  // PRAGMA user_version = x
  // console.log(db.prepare('PRAGMA user_version').get().user_version)
  // https://github.com/WiseLibs/better-sqlite3/issues/668#issuecomment-1145285728
  const version = readVersion(db)
  switch (version) {
    case '1':
      migrateV1(db)
      // 落穿（fall-through）到下一版：每个 case 只负责自己那一版，版本号在 switch 之后统一写一次。
      // 旧写法是「每个 case 各自把版本号写成 DB_VERSION」，加新版时漏挂进旧臂 → 旧库被盖章成新版本、
      // 新迁移没跑 → 校验不过 → 备份后**重建空库**（本文件注释里反复警告的那个灾难）。
      // eslint-disable-next-line no-fallthrough -- 落穿是本迁移链的设计（见上）
    case '2':
      migrateV2(db)
      // eslint-disable-next-line no-fallthrough -- 同上
    case '3':
      migrateV3(db)
      // eslint-disable-next-line no-fallthrough -- 同上
    case '4':
      migrateV4(db)
      // eslint-disable-next-line no-fallthrough -- 同上
    case '5':
      migrateV5(db)
      break
    default:
      // 未知版本（比 DB_VERSION 新，或字段被写坏）：不动库、只留一条日志。
      // 不能假装成功，也不能自己回退版本号——该不该重建由调用方按 verifyDB 的结果决定。
      if (version !== DB_VERSION) {
        console.error(`[dbService] 未知的数据库版本号 "${version}"（当前代码为 "${DB_VERSION}" ），跳过迁移`)
      }
      return
  }
  writeVersion(db, DB_VERSION)
}
