import Database from 'better-sqlite3'
import path from 'path'
import tables, { DB_VERSION } from './tables'
import verifyDB from './verifyDB'
import migrateData from './migrate'

let db: Database.Database


const initTables = (db: Database.Database) => {
  db.exec(`
    ${Array.from(tables.values()).join('\n')}
    INSERT INTO "main"."db_info" ("field_name", "field_value") VALUES ('version', '${DB_VERSION}');
  `)
}


// 打开、初始化数据库
export const init = (lxDataPath: string): boolean | null => {
  const databasePath = path.join(lxDataPath, 'lx.data.db')
  const nativeBinding = path.join(__dirname, '../node_modules/better-sqlite3/build/Release/better_sqlite3.node')
  let dbFileExists = true

  /**
   * 打开之后的每一步都可能抛错（建表 / pragma / 迁移 / 校验），而 `init` 的调用方
   * （`main/app.ts` 的 `initAppSetting`）只认识三种返回值：`true`/`false` = 库可用、
   * `null` = 校验不过（它会弹窗 + 把旧库改名备份后重建空库）。一个未捕获的异常会直接让
   * `initAppSetting` 的 promise reject，而那里的调用点（`main/index.ts` 的
   * `void initAppSetting().then(...)`）**没有 catch** → 建窗口的代码永不执行、界面根本不出现、
   * 也没有任何弹窗提示（只留一条日志）——比"备份后重建"糟糕得多。
   * 所以这里把异常统一收敛成 `null`，交给调用方走它已经设计好的恢复路径。
   *
   * 已知会走到这里的两种历史库形态由 migrate.ts 自己兜住（缺 version 行 / 缺 music_url 表），
   * 这里的 catch 是最后一道网，不是唯一一道。
   */
  try {
    try {
      db = new Database(databasePath, {
        fileMustExist: true,
        nativeBinding,
        // verbose: process.env.NODE_ENV !== 'production' ? console.log : undefined,
      })
    } catch (error: any) {
      // 文件不存在（首次运行）或文件损坏（不是合法的 SQLite 库）都会走到这里：
      // 前者是正常路径，后者会在 initTables 抛错、由外层 catch 收成 `null` 交给调用方重建。
      // 只打一行摘要：原来把整个 error 排出来会带一整条堆栈，在日志（含 CI）里看着像故障，
      // 而它其实是首次运行的正常路径；真要排查库损坏，这里的 message 与外层 catch 的完整错误都够用。
      console.log('[dbService] 无既有库（首次运行）或库不可用，按新建库处理：', error.message)
      db = new Database(databasePath, {
        nativeBinding,
        // verbose: process.env.NODE_ENV !== 'production' ? console.log : undefined,
      })
      initTables(db)
      dbFileExists = false
    }

    db.pragma('journal_mode = WAL')

    if (dbFileExists) migrateData(db)

    // https://www.sqlite.org/pragma.html#pragma_optimize
    if (dbFileExists) db.exec('PRAGMA optimize;')
  } catch (error) {
    console.error('[dbService] 数据库打开后初始化失败（建表 / 迁移 / pragma），将按「校验失败」处理：', error)
    try {
      db.close()
    } catch {}
    return null
  }

  if (!verifyDB(db)) {
    db.close()
    return null
  }

  // https://www.sqlite.org/lang_vacuum.html
  // db.exec('VACUUM "main"')

  process.on('exit', () => db.close())
  console.log('db inited')
  // require('./test')
  return dbFileExists
}

// 获取数据库实例
export const getDB = (): Database.Database => db
