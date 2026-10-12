// export const sql = `
//   CREATE TABLE "db_info" (
//     "id" INTEGER NOT NULL UNIQUE,
//     "field_name" TEXT,
//     "field_value" TEXT,
//     PRIMARY KEY("id" AUTOINCREMENT)
//   );

//   CREATE TABLE "my_list" (
//     "id" TEXT NOT NULL,
//     "name" TEXT NOT NULL,
//     "source" TEXT,
//     "sourceListId" TEXT,
//     "position" INTEGER NOT NULL,
//     "locationUpdateTime" INTEGER,
//     PRIMARY KEY("id")
//   );

//   CREATE TABLE "my_list_music_info" (
//     "id" TEXT NOT NULL,
//     "listId" TEXT NOT NULL,
//     "name" TEXT NOT NULL,
//     "singer" TEXT NOT NULL,
//     "source" TEXT NOT NULL,
//     "interval" TEXT,
//     "meta" TEXT NOT NULL,
//     UNIQUE("id","listId")
//   );
//   CREATE INDEX "index_my_list_music_info" ON "my_list_music_info" (
//     "id",
//     "listId"
//   );

//   CREATE TABLE "my_list_music_info_order" (
//     "listId" TEXT NOT NULL,
//     "musicInfoId" TEXT NOT NULL,
//     "order" INTEGER NOT NULL
//   );
//   CREATE INDEX "index_my_list_music_info_order" ON "my_list_music_info_order" (
//     "listId",
//     "musicInfoId"
//   );

//   CREATE TABLE "music_info_other_source" (
//     "source_id" TEXT NOT NULL,
//     "id" TEXT NOT NULL,
//     "source" TEXT NOT NULL,
//     "name" TEXT NOT NULL,
//     "singer" TEXT NOT NULL,
//     "meta" TEXT NOT NULL,
//     "order" INTEGER NOT NULL,
//     UNIQUE("source_id","id")
//   );
//   CREATE INDEX "index_music_info_other_source" ON "music_info_other_source" (
//     "source_id",
//     "id"
//   );

//   -- TODO  "meta" TEXT NOT NULL,
//   CREATE TABLE "lyric" (
//     "id" TEXT NOT NULL,
//     "source" TEXT NOT NULL,
//     "type" TEXT NOT NULL,
//     "text" TEXT NOT NULL
//   );

//   CREATE TABLE "music_url" (
//     "id" TEXT NOT NULL,
//     "url" TEXT NOT NULL
//   );

//   CREATE TABLE "download_list" (
//     "id" TEXT NOT NULL,
//     "isComplate" INTEGER NOT NULL,
//     "status" TEXT NOT NULL,
//     "statusText" TEXT NOT NULL,
//     "progress_downloaded" INTEGER NOT NULL,
//     "progress_total" INTEGER NOT NULL,
//     "url" TEXT,
//     "quality" TEXT NOT NULL,
//     "ext" TEXT NOT NULL,
//     "fileName" TEXT NOT NULL,
//     "filePath" TEXT NOT NULL,
//     "musicInfo" TEXT NOT NULL,
//     "position" INTEGER NOT NULL,
//     PRIMARY KEY("id")
//   );
// `

// export const tables = [
//   'table_db_info',
//   'table_my_list',
//   'table_my_list_music_info',
//   'index_index_my_list_music_info',
//   'table_my_list_music_info_order',
//   'index_index_my_list_music_info_order',
//   'table_music_info_other_source',
//   'index_index_music_info_other_source',
//   'table_lyric',
//   'table_music_url',
//   'table_download_list',
// ]

type Tables = 'db_info'
| 'my_list'
| 'my_list_music_info'
| 'index_my_list_music_info'
| 'my_list_music_info_order'
| 'index_my_list_music_info_order'
| 'music_info_other_source'
| 'index_music_info_other_source'
| 'lyric'
| 'music_url'
| 'download_list'
| 'dislike_list'
| 'follow_feed_baseline'
| 'follow_feed_item'
| 'local_library_track'

const tables = new Map<Tables, string>()


tables.set('db_info', `
  CREATE TABLE "db_info" (
    "id" INTEGER NOT NULL UNIQUE,
    "field_name" TEXT,
    "field_value" TEXT,
    PRIMARY KEY("id" AUTOINCREMENT)
  );
`)
tables.set('my_list', `
  CREATE TABLE "my_list" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "source" TEXT,
    "sourceListId" TEXT,
    "position" INTEGER NOT NULL,
    "locationUpdateTime" INTEGER,
    PRIMARY KEY("id")
  );
`)
tables.set('my_list_music_info', `
  CREATE TABLE "my_list_music_info" (
    "id" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "singer" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "interval" TEXT,
    "meta" TEXT NOT NULL,
    UNIQUE("id","listId")
  );
`)
tables.set('index_my_list_music_info', `
  CREATE INDEX "index_my_list_music_info" ON "my_list_music_info" (
    "id",
    "listId"
  );
`)
tables.set('my_list_music_info_order', `
  CREATE TABLE "my_list_music_info_order" (
    "listId" TEXT NOT NULL,
    "musicInfoId" TEXT NOT NULL,
    "order" INTEGER NOT NULL
  );
`)
tables.set('index_my_list_music_info_order', `
  CREATE INDEX "index_my_list_music_info_order" ON "my_list_music_info_order" (
    "listId",
    "musicInfoId"
  );
`)
tables.set('music_info_other_source', `
  CREATE TABLE "music_info_other_source" (
    "source_id" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "singer" TEXT NOT NULL,
    "meta" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    UNIQUE("source_id","id")
  );
`)
tables.set('index_music_info_other_source', `
  CREATE INDEX "index_music_info_other_source" ON "music_info_other_source" (
    "source_id",
    "id"
  );
`)
tables.set('lyric', `
  -- TODO  "meta" TEXT NOT NULL,
  CREATE TABLE "lyric" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "text" TEXT NOT NULL
  );
`)
tables.set('music_url', `
  CREATE TABLE "music_url" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "created_at" INTEGER NOT NULL
  );
`)
tables.set('download_list', `
  CREATE TABLE "download_list" (
    "id" TEXT NOT NULL,
    "isComplate" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "statusText" TEXT NOT NULL,
    "progress_downloaded" INTEGER NOT NULL,
    "progress_total" INTEGER NOT NULL,
    "url" TEXT,
    "quality" TEXT NOT NULL,
    "ext" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "musicInfo" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    PRIMARY KEY("id")
  );
`)
tables.set('dislike_list', `
  CREATE TABLE "dislike_list" (
    "type" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "meta" TEXT
  );
`)
/**
 * 关注动态的**基线**：每位关注歌手一行，「我知道他到哪了」。
 *
 * `PRIMARY KEY("singer_mid")` 让写入可以走 `INSERT OR REPLACE`（一个歌手永远只有一行）；
 * `latest_song_id` 是判新的**唯一标记**（下一轮从列表头部往下走，撞到它就停）。
 * 两个判据列都可为 `null`（此前没有任何作品的歌手就是这样）。
 */
tables.set('follow_feed_baseline', `
  CREATE TABLE "follow_feed_baseline" (
    "singer_mid" TEXT NOT NULL,
    "latest_song_id" TEXT,
    "latest_song_time" TEXT,
    "updated_at" INTEGER NOT NULL,
    PRIMARY KEY("singer_mid")
  );
`)
/**
 * 关注动态的**时间线条目**（新歌行 / 新专行）。
 *
 * `UNIQUE("kind","item_id")` 是去重键：同一首歌 / 同一张专辑只会被报一次
 * （`INSERT OR IGNORE` 撞上它就安静跳过）。`music` 存新式歌曲对象的 JSON——**只有歌曲行有**，
 * 它是「点歌直接播」的载荷（时间线里的歌可能早已不在接口的最新列表里）。
 * 容量由 `modules/follow_feed` 的 `ITEM_KEEP` 控制（写入后清理，优先删最旧的已读）。
 */
tables.set('follow_feed_item', `
  CREATE TABLE "follow_feed_item" (
    "id" INTEGER NOT NULL UNIQUE,
    "kind" TEXT NOT NULL,
    "singer_mid" TEXT NOT NULL,
    "singer_name" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "album_mid" TEXT,
    "album_name" TEXT,
    "track_count" INTEGER,
    "publish_time" TEXT NOT NULL,
    "found_at" INTEGER NOT NULL,
    "read" INTEGER NOT NULL,
    "music" TEXT,
    PRIMARY KEY("id" AUTOINCREMENT),
    UNIQUE("kind","item_id")
  );
`)
/**
 * 本地媒体库的曲目表（本地媒体库票 01）。
 *
 * 主键是**内容哈希**：同一份音频文件无论从哪里导入，库中永远只有一行（去重天然成立）；
 * 文件本体托管在 `<userData>/media/` 下以同一哈希命名（`${id}.${ext}`），播放路径可由哈希推出。
 * 歌词与封面正文本体全部内嵌在音频文件里（spec D2 零旁车），库行记「有无」标记（`has_pic`/`has_lyric`）；
 * 年份/流派/音轨/碟号等 tag 的**展示值**缓存在库行（正文本体在文件内嵌），供列表展示与分组，不回读文件。
 * 展示用的 `name`/`singer`/`album`/`interval` 与歌单条目（`my_list_music_info`）是**两份**：
 * 编辑曲目时由 `modules/local_library` 在同一事务里同步更新引用行（引用行的 `id` 就是这里的哈希、
 * `source='local'`），否则歌单里显示的是旧名字。
 *
 * `origin` 是**入库来源**（集合概念统一 spec / ADR-0013）：`'import'`（导入/收编）或 `'download'`
 * （下载完成自动托管入库）。v7 迁移给旧行补 `'import'`；下载入库路径由渲染侧 worker 传入 `'download'`。
 */
tables.set('local_library_track', `
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
    "origin" TEXT NOT NULL DEFAULT 'import',
    PRIMARY KEY("id")
  );
`)

export default tables

/**
 * 数据库版本。改动**必须**同步三处，缺一即出事：
 * 1. 上面 `tables` 里对应的建表 SQL（`verifyDB.ts` 拿它逐字符比对——正常化空白 / 分号 / 注释后整串相等）；
 * 2. `migrate.ts` 里对应的版本分支（旧库要先升到同一结构才通过校验）；
 * 3. 在一份**真旧库**上实测 `dbService.init` 返回 `true`（AGENTS §2.4）。
 *
 * ⚠️ 校验不过时 `db.init` 返回 `null`，`main/app.ts` 会把用户库改名备份后**重建空库**（数据丢失）。
 *
 * 版本历史（每项 = 一个**起始版本**的库在迁移时补了什么；`migrate.ts` 的 `case` 与之对应，
 * 迁移跑完版本号一律写成上面的 `DB_VERSION`）：
 * - 起始 `'1'`：补 `dislike_list` 表（上游 v2.4.0 的默认版本号出错遗留）；
 * - 起始 `'2'`：`music_url` 加 `created_at`（设置页重构票 08：URL 缓存回收的时间依据，0 = 加列之前写的行）；
 * - 起始 `'3'`：删掉「试听列表」（`LIST_IDS.DEFAULT`）在库里的全部数据行（票 08：数据层删除，
 *   真删、不迁进「我的收藏」；表结构不变，只是清行）；
 * - 起始 `'4'`：补 `follow_feed_baseline` 与 `follow_feed_item` 两张表（关注动态票 02）；
 *   两张都是新表、没有旧数据要搬，所以只是建表。
 * - 起始 `'5'`：补 `local_library_track` 表（本地媒体库票 01）；
 *   新表、没有旧数据要搬，所以只是建表。
 * - 起始 `'6'`：集合概念统一（ADR-0013）：love 迁成自建列表后与 default 一起清残余、
 *   旧式本地条目清除、已完成下载记录清除、`local_library_track` 重建加 `origin` 列。
 */
export const DB_VERSION = '7'
