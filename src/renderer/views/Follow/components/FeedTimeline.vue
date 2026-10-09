<template>
  <div :class="$style.container">
    <!-- 按发布周分组（items 已按发布时间倒序，相邻同周即一组）。
         单页、不分 tab（骨架工单的既定口径），周锚头只是扫视用的视觉停靠点 -->
    <section v-for="group in groups" :key="group.key" :class="$style.group">
      <h3 :class="$style.week">{{ weekLabel(group.key) }}</h3>
      <ul :class="$style.list">
        <!-- 点歌行 = 从这首开始播（队列 = 本页全部歌曲行）；专辑行点行 = 展开/收起专辑内歌曲
             （展开区里点了直接播，不出这一页），专辑名仍可点进专辑页 -->
        <li
          v-for="item in group.items" :key="item.id"
          :class="[
            $style.row,
            { [$style.playable]: item.kind === 'song' || (albumSongsMap.get(item.id)?.length ?? 0) > 0 },
          ]"
          @click="handleRowClick(item)"
          @contextmenu.prevent="showRowMenu($event, item)"
        >
          <div :class="$style.main">
            <!-- 时间轴节点：本次新增的行节点亮主色，已读行空心——新旧的表达收在这里，
                 不再用「本次新增」整句文案压在名字旁。色弱兜底：节点带 title -->
            <span
              :class="[$style.dot, { [$style.dotFresh]: isFresh(item) }]"
              :title="isFresh(item) ? $t('follow__fresh') : ''"
            />
            <span :class="$style.coverBox">
              <!-- 封面按 albumMid 拼 QQ 音乐静态图 URL（`musicSdk/tx/album.js` 的 albumImg 同款）。
                   缺 mid 的行不渲染 img——空 src 会画出破损图标，用底色块 + 专辑图标占位 -->
              <img
                v-if="item.albumMid"
                :class="$style.cover" loading="lazy" decoding="async"
                :src="coverUrl(item)" alt=""
              >
              <span v-else :class="$style.coverEmpty">
                <!-- 本文件三处图标 svg 都必须带该符号自身的 viewBox：#icon-* 的 path 坐标系各异
                     （1024 / 451.8 / 425.2），缺 viewBox 不缩放，墨迹整个画到视口外——
                     悬停圆里「没有箭头」就是这个原因 -->
                <svg version="1.1" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 425.2 425.2">
                  <use xlink:href="#icon-album" />
                </svg>
              </span>
              <!-- 歌曲行 hover 出播放钮：行点击即播的具象提示（专辑行不出——它点行是展开） -->
              <span v-if="item.kind === 'song'" :class="$style.coverPlay">
                <svg version="1.1" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 1024 1024">
                  <use xlink:href="#icon-play" />
                </svg>
              </span>
            </span>
            <div :class="$style.body">
              <div :class="$style.nameLine">
                <!-- 专辑行的专辑名可点（进专辑页）；歌名点了由整行承担「从这首开始播」。
                     可点名的 title 写**动作**（跳转提示）、aria-label 写名字——写了 title 就等于占了
                     可访问名，得用 aria-label 拿回来（在线歌曲表那几列同款，AGENTS §2.5.1 第 11 条） -->
                <span
                  :class="item.kind === 'album' ? [$style.name, $style.clickable] : $style.name"
                  :title="item.kind === 'album' ? $t('list__jump_album') : item.name"
                  :aria-label="item.name"
                  @click.stop="item.kind === 'album' && jumpToAlbumRow(item)"
                >{{ item.name }}</span>
                <!-- 专辑展开指示：有歌可展的专辑行才画；展开时箭头翻转 -->
                <span
                  v-if="item.kind === 'album' && (albumSongsMap.get(item.id)?.length ?? 0) > 0"
                  :class="[$style.chevron, { [$style.chevronOpen]: isAlbumExpanded(item) }]"
                >
                  <svg version="1.1" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 451.847 451.847">
                    <use xlink:href="#icon-down" />
                  </svg>
                </span>
              </div>
              <div :class="$style.meta">
                <!-- kind 收进 meta 行首：两种行的区分靠它，但不再让它独占一列把所有行往右推 -->
                <span :class="$style.kind">
                  {{ item.kind === 'song' ? $t('follow__kind_song') : $t('follow__kind_album') }}
                </span>
                <!-- `.stop`：点名字是跳转，别把整行的「播放 / 展开」也带出来 -->
                <span
                  :class="$style.singer" :title="$t('list__jump_singer')" :aria-label="item.singerName"
                  @click.stop="jumpToSinger(item)"
                >{{ item.singerName }}</span>
                <!-- 曲目数只有新专行有（新歌行为 null）；专辑行理论上一定有，缺失时宁可不画 -->
                <span v-if="item.kind === 'album' && item.trackCount != null">{{ $t('follow__album_tracks', { count: item.trackCount }) }}</span>
                <span :class="$style.time">{{ item.publishTime }}</span>
              </div>
            </div>
          </div>
          <!-- 专辑展开区：本簇内（本轮发现）的曲目，点了直接播——不出动态页。
               只含本轮发现的那批，专辑全量曲目仍以专辑页为准（点专辑名进页） -->
          <ul v-if="isAlbumExpanded(item)" :class="$style.albumSongs">
            <li
              v-for="(song, songIndex) in albumSongsMap.get(item.id)" :key="song.id"
              :class="$style.albumSong"
              @click.stop="handleAlbumSongClick(item, songIndex)"
            >
              <span :class="$style.albumSongIndex">{{ songIndex + 1 }}</span>
              <span :class="$style.albumSongName" :title="song.name">{{ song.name }}</span>
              <span :class="$style.albumSongMeta">{{ song.singer }}</span>
            </li>
          </ul>
        </li>
      </ul>
    </section>
    <!-- 歌曲行菜单：在线歌曲表那套（`useMenu`，12 项里适用的那些） -->
    <base-menu v-model="isShowItemMenu" :menus="menus" :xy="menuLocation" item-name="name" @menu-click="handleSongMenuClick" />
    <!-- 专辑行菜单：打开专辑 / 复制专辑链接 / 在 QQ 音乐打开 -->
    <base-menu v-model="isShowAlbumMenu" :menus="albumMenus" :xy="albumMenuLocation" item-name="name" @menu-click="handleAlbumMenuClick" />
    <!-- 菜单里「添加到…」「下载」用的单条弹窗（照 OnlineList 的用法，teleport 到 #view） -->
    <common-list-add-modal v-model:show="isShowListAdd" :music-info="selectedAddMusicInfo" teleport="#view" />
    <common-download-modal v-model:show="isShowDownload" :music-info="selectedDownloadMusicInfo" teleport="#view" />
  </div>
</template>

<script lang="ts">
import { computed } from '@common/utils/vueTools'
import ListAddModal from '@renderer/components/common/ListAddModal.vue'
import DownloadModal from '@renderer/components/common/DownloadModal.vue'
import { useTimelineActions } from '../useTimelineActions'

/**
 * 时间线（关注动态）：**单页、不分 tab**，按发布周分组的两种行——新单曲行与 新专辑行。
 *
 * 视觉语言（2026-09-27 重做）：左侧时间轴脊线 + 行首节点（本次新增亮主色 / 已读空心）+
 * 56px 专辑封面做行的主体视觉 + 周锚头（sticky，周一为一周起点）。
 * 专辑行可**展开**（2026-09-28 用户拍板：不出动态页就能听专辑内歌曲）。
 *
 * 条目与「本次新增」的 id 组都由页面传进来（`items` 已按发布时间倒序，这里**不重排**，
 * 分组只做相邻归拢）；行上的交互（播放 / 展开 / 跳转 / 右键菜单）全部在 `useTimelineActions` 里，本文件只管画。
 */
export default {
  name: 'FollowFeedTimeline',
  components: {
    CommonListAddModal: ListAddModal,
    CommonDownloadModal: DownloadModal,
  },
  props: {
    items: {
      type: Array as () => LX.FollowFeed.Item[],
      default: () => [],
    },
    /** 「本次进入页面时还是未读」的条目 id（页内标记用，来自 store 的 freshIds） */
    freshIds: {
      type: Array as () => number[],
      default: () => [],
    },
  },
  setup(props: { items: LX.FollowFeed.Item[], freshIds: number[] }) {
    const isFresh = (item: LX.FollowFeed.Item): boolean => props.freshIds.includes(item.id)

    /** 封面 URL：300 档对 56px 的显示尺寸（2x 屏 112px）已足够，比 albumImg 默认的 500 省 */
    const coverUrl = (item: LX.FollowFeed.Item): string =>
      item.albumMid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${item.albumMid}.jpg` : ''

    /** 相邻同周归拢成组（key = 该周的周一 `YYYY-MM-DD`；周一为一周起点，中文语境惯例） */
    const groups = computed(() => {
      const out: Array<{ key: string, items: LX.FollowFeed.Item[] }> = []
      for (const item of props.items) {
        const key = weekKey(item.publishTime)
        const last = out[out.length - 1]
        if (last && last.key === key) last.items.push(item)
        else out.push({ key, items: [item] })
      }
      return out
    })

    /** 周键：该日期所在周的周一（`YYYY-MM-DD`）。`publishTime` 是 `YYYY-MM-DD`，无时区歧义 */
    const weekKey = (dateStr: string): string => {
      const [y, m, d] = dateStr.split('-').map(Number)
      const date = new Date(y, m - 1, d)
      date.setDate(date.getDate() - (date.getDay() + 6) % 7)
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    }

    // 周锚头文案走 Intl（locale 跟 i18n 的四语键同名：zh-cn / zh-tw / en-us / ko-kr）。
    // 用方法不用 computed：locale 不是响应式依赖，靠切语言时 $t 触发的整体重渲染拿到新值
    const weekLabel = (key: string): string => {
      const [y, m, d] = key.split('-').map(Number)
      const start = new Date(y, m - 1, d)
      const end = new Date(start)
      end.setDate(end.getDate() + 6)
      const fmt = (date: Date, withYear = false) => new Intl.DateTimeFormat(window.i18n.locale, {
        ...(withYear ? { year: 'numeric' } : {}),
        month: 'short',
        day: 'numeric',
      }).format(date)
      // 常规跨度只有几周（展示窗口只有两周），同年不带年；跨年那一周两端都带年
      return start.getFullYear() === end.getFullYear()
        ? `${fmt(start)} – ${fmt(end)}`
        : `${fmt(start, true)} – ${fmt(end, true)}`
    }

    const {
      isAlbumExpanded,
      albumSongsOf,
      handleRowClick,
      handleAlbumSongClick,
      jumpToSinger,
      jumpToAlbumRow,
      menus,
      menuLocation,
      isShowItemMenu,
      showRowMenu,
      handleSongMenuClick,
      albumMenus,
      albumMenuLocation,
      isShowAlbumMenu,
      handleAlbumMenuClick,
      isShowListAdd,
      selectedAddMusicInfo,
      isShowDownload,
      selectedDownloadMusicInfo,
    } = useTimelineActions(props)

    /**
     * 专辑行 id → 本簇歌曲（模板里每行都要判「有没有歌可展」，解析一次缓存住，
     * 别在模板里对同一行反复 `JSON.parse`）。歌曲行不进这张表。
     */
    const albumSongsMap = computed(() => {
      const map = new Map<number, LX.Music.MusicInfoOnline[]>()
      for (const item of props.items) {
        if (item.kind !== 'album') continue
        map.set(item.id, albumSongsOf(item))
      }
      return map
    })

    return {
      groups,
      weekLabel,
      coverUrl,
      isFresh,
      albumSongsMap,
      isAlbumExpanded,
      handleRowClick,
      handleAlbumSongClick,
      jumpToSinger,
      jumpToAlbumRow,
      menus,
      menuLocation,
      isShowItemMenu,
      showRowMenu,
      handleSongMenuClick,
      albumMenus,
      albumMenuLocation,
      isShowAlbumMenu,
      handleAlbumMenuClick,
      isShowListAdd,
      selectedAddMusicInfo,
      isShowDownload,
      selectedDownloadMusicInfo,
    }
  },
}
</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.container {
  position: relative;
  padding-bottom: 30px;
}

.group {
  position: relative;
}

.week {
  position: sticky;
  top: 0;
  z-index: 1;
  margin: 0;
  padding: 14px 8px 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-font);
  // sticky 吸附时要遮住从下面穿过的内容，背景必须跟内容区一致
  background-color: var(--color-content-background);
}

.list {
  position: relative;
  // 脊线：每组一条（组间被周锚头断开，节奏感比通天线好），x 对齐行首节点中心（.main 的 padding 8 + 点半径 4.5）
  &::before {
    content: '';
    position: absolute;
    left: 12px;
    top: 10px;
    bottom: 10px;
    width: 1px;
    // 浅色主题下 alpha-900（10%）几乎不可见，时间轴的骨架感全靠它，压到 alpha-600
    background-color: var(--color-primary-alpha-600);
  }
}

.row {
  position: relative;
  // 双段结构：主行 + 专辑展开区（column 是为了展开区能占满整行宽度）
  display: flex;
  flex-flow: column nowrap;
  transition: background-color @transition-fast;
}

.main {
  display: flex;
  align-items: center;
  gap: 12px;
  // 左右对称 8px：hover 高亮块包住节点；脊线 left:12 = 这 8px + 点半径 4.5，正好过圆心
  padding: 6px 8px;
  min-width: 0;
}

// 可点样式：歌行整行点了就播；专辑行点了展开。展开区在 .row 里，跟着一起亮
.playable {
  cursor: pointer;

  &:hover {
    background-color: var(--color-primary-alpha-900);
    border-radius: @radius-border;

    .coverPlay {
      opacity: 1;
    }
  }
}

.dot {
  flex: none;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background-color: var(--color-content-background);
  border: 1px solid var(--color-primary-alpha-500);
  box-sizing: border-box;
}

.dotFresh {
  border: none;
  background-color: var(--color-primary);
}

.coverBox {
  position: relative;
  flex: none;
  width: 56px;
  height: 56px;
}

.cover {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: @radius-border;
  object-fit: cover;
  // 加载中的占位（歌手页专辑卡同款）
  background-color: var(--color-button-background);
}

.coverEmpty {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  border-radius: @radius-border;
  background-color: var(--color-button-background);
  color: var(--color-primary-alpha-600);

  svg {
    display: block;
    fill: currentColor;
  }
}

.coverPlay {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 26px;
  height: 26px;
  transform: translate(-50%, -50%);
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background-color: var(--color-primary-dark-1000-alpha-500);
  color: var(--color-primary-font);
  opacity: 0;
  transition: opacity @transition-fast;

  svg {
    display: block;
    fill: currentColor;
  }
}

.body {
  flex: auto;
  min-width: 0;
}

.nameLine {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.name {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-font);
  .mixin-ellipsis-1();
}

// 名字的可点样式（跳转由点击处理器做：走路由，不是 <a>——在线歌曲表那几列也是 span + click，
// 用 <a> 会把「右键菜单 / 选中文本」这些行为带进来）
.clickable,
.singer {
  color: var(--color-primary-font);
  cursor: pointer;
}

.singer {
  font-size: 13px;
  .mixin-ellipsis-1();
}

.chevron {
  flex: none;
  margin-left: auto;
  color: var(--color-font-label);
  transition: transform @transition-fast;

  svg {
    display: block;
    fill: currentColor;
  }
}

.chevronOpen {
  transform: rotate(180deg);
}

.kind {
  flex: none;
  padding: 1px 6px;
  border-radius: @radius-border;
  font-size: 11px;
  // 两种行只靠文字区分，底色同一档——新专行不值得比新歌行更响
  background-color: var(--color-primary-alpha-900);
  color: var(--color-primary);
}

.meta {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 3px;
  min-width: 0;
  font-size: 12px;
  color: var(--color-font-label);
}

.time {
  flex: none;
}

// 专辑展开区：缩进对齐到文本列（.main 的 padding 8 + 节点 9 + gap 12 + 封面 56 + gap 12 = 97px）
.albumSongs {
  margin: 0;
  padding: 2px 8px 8px 97px;
}

.albumSong {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 5px 8px;
  border-radius: @radius-border;
  cursor: pointer;
  font-size: 13px;
  color: var(--color-font);

  &:hover {
    background-color: var(--color-primary-alpha-900);
  }
}

.albumSongIndex {
  flex: none;
  width: 18px;
  text-align: right;
  font-size: 12px;
  color: var(--color-font-label);
}

.albumSongName {
  min-width: 0;
  .mixin-ellipsis-1();
}

.albumSongMeta {
  flex: none;
  max-width: 40%;
  font-size: 12px;
  color: var(--color-font-label);
  .mixin-ellipsis-1();
}
</style>
