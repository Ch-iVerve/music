/**
 * 关注动态（`follow_feed`）的跨层类型。
 *
 * 为什么这份类型放在 `common` 而不是 `main/types/db_service.d.ts`：**它的形状要跨 IPC**
 * （渲染侧要拿到基线、条目、未读数），而 `db_service.d.ts` 只对主进程可见。
 * 与 `dislike_list` 的先例一致：通道载荷的类型在 `common`，worker 内部的行类型才在 `DBService`——
 * 这里两者形状相同，所以不再在 `DBService` 里抄一份（多一份就多一处会漂移的定义）。
 *
 * 术语：关注动态 / 动态条目 / 基线。
 */
declare namespace LX {
  namespace FollowFeed {
    /** 条目类型：新歌行 / 新专行（时间线里只有这两种行） */
    type ItemKind = 'song' | 'album'

    /**
     * 基线：每位关注歌手一行，「我知道他到哪了」。
     *
     * `latestSongId` 是**判新的唯一标记**：下一轮从列表头部往下走，撞到它就停，撞到之前的算增量。
     * 为什么不是「比 `latestSongTime` 更新」——实测 `order: 0` 并非普遍按发布时间倒序
     * （见 `renderer/core/followFeed/diff.ts` 的注释）。
     *
     * `null` = 还没取到过（此前没有任何作品的歌手就是这样；他发出第一首歌时会被正常报出来，
     * 因为「首次静默」判的是**有没有这一行**，不是标记是不是 null）。
     */
    interface Baseline {
      singerMid: string
      latestSongId: string | null
      /** 该标记那首歌的发布时间（`YYYY-MM-DD`）；只用于展示与排查，判新不靠它 */
      latestSongTime: string | null
      /** 写入时间戳（ms）；由 worker 统一打（同 `music_url.created_at` 的口径） */
      updatedAt: number
    }

    /** 写入基线的载荷：`updatedAt` 由 worker 打，调用方不该指定 */
    type BaselineInput = Omit<Baseline, 'updatedAt'>

    /** 时间线里的一条动态条目 */
    interface Item {
      id: number
      kind: ItemKind
      singerMid: string
      singerName: string
      /**
       * 去重键（`UNIQUE(kind, item_id)`）：
       * 歌曲行 = 新式歌曲 id（`tx_<songmid>`）；专辑行 = 专辑 mid。
       * 它保证同一首歌 / 同一张专辑只会被报一次。
       */
      itemId: string
      /** 歌名（歌曲行）/ 专辑名（专辑行） */
      name: string
      albumMid: string | null
      albumName: string | null
      /** 专辑行的曲目数；歌曲行为 `null`（判断新歌 / 新专用的就是它，见 spec） */
      trackCount: number | null
      /** 发布时间（`YYYY-MM-DD`，来自接口）——时间线按它倒序 */
      publishTime: string
      /** 发现时间戳（ms），worker 打的；页内「本次未读」标记用它 */
      foundAt: number
      read: 0 | 1
      /**
       * 播放载荷的 JSON（`toNewMusicInfo` 的输出）：
       * - 歌曲行：**单个**新式歌曲对象；
       * - 专辑行：**数组**（本簇内的每首歌）——专辑行在页面上展开即播，不必跳专辑页
       *   （2026-09-28 用户拍板；只含本轮发现的曲目，专辑全量以专辑页为准）。
       * 存它是为了「点了直接播」——时间线里的歌可能早已不在接口的最新列表里，
       * 不存载荷就得为了播放再查一次。
       */
      music: string | null
    }

    /** 写入条目的载荷：`id` / `foundAt` / `read` 由 worker 决定 */
    type ItemInput = Omit<Item, 'id' | 'foundAt' | 'read'>

    /**
     * 页面顶部的两个数。
     *
     * `lastSuccessAt` 取基线里最大的 `updatedAt`——基线只在该歌手本轮**成功取到数据**时才推进，
     * 所以它天然只反映成功的那次（`null` = 还从没成功过，页面显示「从未检查」）。
     * 失败原因不落库：它只存内存（重启即清，重启后会马上再跑一轮）。
     */
    interface Summary {
      monitoredCount: number
      lastSuccessAt: number | null
    }
  }
}
