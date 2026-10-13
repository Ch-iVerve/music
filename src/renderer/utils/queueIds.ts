/**
 * 在线列表宿主的**播放队列身份**（票 06 M3 收口）。
 *
 * 这些字符串只服务一件事：`tempListMeta.id`——「当前播的是哪个列表」。
 * 生成它的地方（各宿主页的 `:list-id` 与自己那套播放入口）与读它的地方（`utils/playingRowLocate`
 * 等）必须拿到**逐字符相同**的值；此前同一个身份的字面量散在多个文件里靠手工对齐
 * （`search__`、`board__` 各有两份生成，`syncSourceList` 还自带一份正则解析），改一处漏一处
 * 就是「正在播放那一行」认不出来、播放栏定位键失灵。
 *
 * 约定：
 *   - 有真实列表 id 的用「前缀 + 真实 id」（`album__<mid>` / `board__<id>` …），生成函数负责
 *     把 `null/undefined` 归一成空串（路由 query 没就绪时的老口径）；
 *   - 没有真实 id 的用下面那几个自造常量——**不带时间戳**：同一个槽位（如「我的收藏」）
 *     跨次进入要能认出是同一份列表；
 *   - 这份模块是叶子（不 import 任何业务模块）：views / components / store 都可以取它。
 */

/** 专辑页（`/album?mid=`）。 */
export const albumQueueId = (mid: unknown) => `album__${String(mid ?? '')}`
/** 歌单详情页（`/songList/detail?id=`，id 是 tid）。 */
export const songListQueueId = (tid: unknown) => `tx__${String(tid ?? '')}`
/**
 * 榜单（`/musicHall` 的排行榜）。
 *
 * ⚠️ 同一串还用作「复制到我的歌单」的 `sourceListId`（`leaderboard/action.ts` 的 getListId），
 * `store/list/syncSourceList` 靠 `BOARD_QUEUE_PREFIX` 反解出榜单 id——两处必须同源。
 */
export const boardQueueId = (id: unknown) => `board__${String(id ?? '')}`
/** 榜单身份前缀（反解用，见 `boardQueueId`）。 */
export const BOARD_QUEUE_PREFIX = 'board__'
/** 云端自建歌单（「我的歌单」里的云朵页）。 */
export const cloudQueueId = (dirId: unknown) => `cloud_${String(dirId ?? '')}`
/** 搜索结果（`/search` 的歌曲 tab；身份带关键词，换关键词即换队列）。 */
export const searchQueueId = (keyword: unknown) => `search__${String(keyword ?? '')}`
/** 歌手页的歌曲 tab。 */
export const singerSongsQueueId = (mid: unknown) => `singer__songs__${String(mid ?? '')}`
/** 发现页的新歌 tab（身份带地区 type，切 tab 即换队列）。 */
export const newSongsQueueId = (type: unknown) => `discover__new_songs__${String(type)}`

/** 我的收藏 → 我收藏的歌曲（没有真实列表 id，自造稳定标识）。 */
export const FAV_SONGS_QUEUE_ID = 'fav__songs'
/** 我的收藏 → QQ 不喜欢。 */
export const DISLIKE_SONGS_QUEUE_ID = 'dislike__songs'
/** 雷达推荐流。 */
export const RADAR_QUEUE_ID = 'radar__recommend'
/** 每日 30 首（雷达页的另一个 tab，与 `RADAR_QUEUE_ID` 并列）。 */
export const DAILY_30_QUEUE_ID = 'daily30__recommend'
/** 关注动态的时间线。 */
export const FOLLOW_FEED_QUEUE_ID = 'follow_feed__timeline'
/** 关注动态里「专辑展开区」的队列身份前缀（每张专辑一个队列：`<前缀><itemId>`）。 */
export const FOLLOW_FEED_ALBUM_ID_PREFIX = 'follow_feed__album_'

/**
 * 宿主页**没有**传 `listId` 时的兜底身份（`OnlineList/usePlay` 的 `getQueueId`）。
 *
 * ⚠️ 共用它不代表内容相同：几个没传身份的表内容不同，判「正在播放那一行」时必须
 * 连歌曲 id 一起比（见 `utils/playingRowLocate.ts` 的 `findPlayingRowIndex`）。
 */
export const ONLINE_LIST_FALLBACK_QUEUE_ID = 'online_list__temp'
