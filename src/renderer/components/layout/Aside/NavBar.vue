<template>
  <div ref="dom_menu" :class="$style.menu">
    <!--
      左栏三分组（工单 11）：在线（雷达 / 发现 / 乐馆）→ 我的（我的音乐 / 我的收藏 / 我的歌单 /
      我的下载 / 关注动态）→ 设置（贴底）。**组标题小字已去掉**（ui-polish 工单 01：用户 2026-09-23
      要求「不要小字」，分组只靠组间留白表达），设置组 margin-top:auto 贴底。

      「搜索」不再占左栏位：工具栏的搜索框（`components/layout/Toolbar/SearchInput.vue`）
      在**任何窗口宽度下都渲染**，左栏这个入口本来就是重复的（工单 11 的验收项）。
    -->
    <ul
      v-for="(group, index) in menuGroups" :key="`group__${index}`"
      :class="[$style.list, { [$style.bottom]: group.bottom }]" role="toolbar"
    >
      <li v-for="item in group.items" :key="item.to" :class="$style.navItem" role="presentation">
        <!-- aria-label 与 title 同值但都不能省：链接内容只有一个 svg 图标（无可见文本），
             删 aria-label 会让 role=tab 的链接失去可访问名；title 是唯一的悬停提示来源
             （应用级气泡插件已删，规矩见 §2.5.1）。 -->
        <router-link
          :class="[$style.link, {[$style.active]: $route.meta.name == item.name}]" role="tab"
          :aria-selected="$route.meta.name == item.name" :to="item.to"
          :aria-label="item.tips" :title="item.tips"
        >
          <!-- viewBox 写死 24×24：左栏这一排的图标**统一**是 Material 的 24 网格实心 glyph
               （2026-09-24 用户要求）。以前每个条目自带 `iconSize`（448 / 425.2 / 493.23… 各不相同），
               同一个渲染 size 出来的墨迹相差 ±8%——那正是「不统一」的来源。
               写死而不是保留逐项配置：这套图标同网格，谁将来塞一个非 24 网格的进来就会一眼看出来 -->
          <svg version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" viewBox="0 0 24 24" :height="item.size" :width="item.size" space="preserve">
            <use :xlink:href="item.icon" />
          </svg>
        </router-link>
        <!-- 角标（左栏首个，2026-09-26 关注动态）。**绝对定位在 `li` 上**（`.navItem` 是 relative）：
             塞进上面那个 flex 居中盒会把图标挤变形。没有角标（数字为 0 / 缺省）的项由 `v-if` 整块不渲染，
             `> 99` 由 `badgeLabel` 封顶成 `99+`；颜色只用既有 token（本仓库没有 error/warning 语义 token） -->
        <span
          v-if="item.badge" :class="$style.badge" :title="item.badgeTitle"
        >{{ badgeLabel(item.badge) }}</span>
      </li>
    </ul>
  </div>
</template>

<script lang="ts">
import { appSetting } from '@renderer/store/setting'
import { followFeedState } from '@renderer/store/followFeed/state'
import { loadFollowFeedBadge } from '@renderer/store/followFeed/action'
import { useI18n } from '@root/lang'
import { ref, computed, onMounted } from '@common/utils/vueTools'
import { useIconSize } from '@renderer/utils/compositions/useIconSize'

/**
 * 角标数字 → 显示文案：非正数给空串（**不渲染**）；`> 99` 封顶 `99+`（左栏这一列窄，
 * 三位数会把角标撑成横条）。抽成纯函数是为了让这两条判据只有一处实现，模板只负责画
 * （单测从渲染结果钉：0 不出现、100 显示 `99+`）。
 */
export const badgeLabel = (count: number): string => {
  if (!(count > 0)) return ''
  return count > 99 ? '99+' : String(count)
}

/** 左栏一项的数据形状。`badge` / `badgeTitle` 是 2026-09-26 关注动态加的（左栏首个角标） */
interface NavItem {
  to: string
  tips: string
  icon: string
  size: string
  name: string
  enable: boolean
  /** 未读数字；缺省或 0 不渲染（判据与封顶在 `badgeLabel`） */
  badge?: number
  /** 角标自己的悬停提示（数字本身不自解释，所以要 title；没有角标的项不填） */
  badgeTitle?: string
}

interface NavGroup {
  /** 「设置」组贴底 */
  bottom?: boolean
  items: NavItem[]
}

export default {
  name: 'NavBar',
  setup() {
    const t = useI18n()
    const dom_menu = ref<HTMLElement>()
    const iconSize = useIconSize(dom_menu, 0.32)

    const menuGroups = computed<NavGroup[]>(() => {
      const size = iconSize.value
      // 角标数字与文案在这里一次备好，模板只负责画：模板里不判业务（0 与 99+ 都由 badgeLabel 管）
      const unread = followFeedState.unreadCount
      return [
        {
          items: [
            {
              to: '/radar',
              tips: t('radar'),
              icon: '#icon-radar',
              size,
              name: 'Radar',
              enable: true,
            },
            {
              to: '/discover',
              tips: t('discover'),
              icon: '#icon-discover',
              size,
              name: 'Discover',
              enable: true,
            },
            {
              to: '/musicHall',
              tips: t('music_hall'),
              icon: '#icon-leaderboard',
              size,
              name: 'MusicHall',
              enable: true,
            },
          ],
        },
        {
          items: [
            {
              to: '/user',
              tips: t('user_center'),
              icon: '#icon-nav-user',
              size,
              name: 'UserCenter',
              enable: true,
            },
            {
              to: '/favorites',
              tips: t('favorites'),
              // 图标口径（2026-09-24 用户：「这几个图标都统一一下吧」）：左栏这一排整体换成
              // Material 的 24 网格实心 glyph（来源与理由见 Icons.vue 的 #icon-radar 说明），
              // 本项因此由**空心**心换成实心 `favorite`。
              // 此前那条「保持空心、尺寸已复核」的结论（工单 10 的遗留 + 2026-09-24 复核）说的是
              // 「不要**单独**缩这一颗」——整排统一换套是另一回事，那条随之作废：现在九项同网格、
              // 同 `size`，不再需要任何单独调尺寸的说明。
              icon: '#icon-nav-love',
              size,
              name: 'Favorites',
              enable: true,
            },
            {
              to: '/playlists',
              tips: t('playlists'),
              icon: '#icon-nav-playlist',
              size,
              name: 'Playlists',
              enable: true,
            },
            {
              // 「本地音乐」：库升为一级入口（集合概念统一 D3/票 04），承接原「我的下载」的位置；
              // 下载完成即收编入库（票 03），任务的进行中状态由该页顶部的任务条承接
              to: '/library',
              tips: t('local_music'),
              icon: '#icon-nav-library',
              size,
              enable: true,
              name: 'Library',
            },
            {
              // 「我的」组**末位**（工单 03 的验收项：我的音乐 / 我的收藏 / 我的歌单 / 我的下载之后）。
              // `name` 必须与路由的 `meta.name` 同值（'Follow'），侧栏高亮按它匹配
              to: '/follow',
              tips: t('follow'),
              icon: '#icon-nav-follow',
              size,
              name: 'Follow',
              enable: true,
              badge: unread,
              badgeTitle: unread > 0 ? t('follow__unread_badge', { count: unread }) : undefined,
            },
          ],
        },
        {
          bottom: true,
          items: [
            {
              to: '/setting',
              tips: t('setting'),
              icon: '#icon-setting',
              size,
              enable: true,
              name: 'Setting',
            },
          ],
        },
      ].map(group => ({ ...group, items: group.items.filter(m => m.enable) }))
        .filter(group => group.items.length > 0)
    })

    // 左栏在每个页面都会挂载，所以「进应用先刷一次未读数」落在这里（只读一个数字，不读整份列表，
    // 见 `loadFollowFeedBadge` 的注释）。一轮检查结束后的刷新不在这里，由 core/followFeed 那边负责
    onMounted(() => {
      void loadFollowFeedBadge()
    })

    return {
      appSetting,
      badgeLabel,
      menuGroups,
      dom_menu,
    }
  },
}
</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.menu {
  flex: auto;
  display: flex;
  flex-flow: column nowrap;
}
.list {
  -webkit-app-region: no-drag;

  &:last-child {
    margin-bottom: 0;
  }
  // 组间留白
  & + & {
    margin-top: 10px;
  }
  // 「设置」组贴底（容器是 flex 列，吃掉剩余空间即可）
  &.bottom {
    margin-top: auto;
    // 这一项的高度 = **播放条的高度**（2026-09-24 用户：「入口的高度和播放条的高度对齐」）。
    // 其余项是「宽度 84%」的方形（靠 padding-bottom 撑高），到这一项恰好比播放条矮 4.84px
    // （实测入口 61.16 / 播放条 66，底边本来就齐——左栏与播放条在同一个 flex 行里——
    // 差的是顶边）。用 @height-player 而不是写死 66：它正是播放条 `.player` 的高度来源，
    // 三种进度条样式（迷你/中等/全宽）都用同一个变量，所以跟着它走才不会哪天改了播放条又错位
    .navItem:before {
      padding-bottom: 0;
      height: @height-player;
    }
  }
}
.navItem {
  position: relative;
  &:before {
    content: '';
    display: block;
    width: 100%;
    padding-bottom: 84%;
  }
}
.link {
  position: absolute;
  left: 0%;
  top: 0%;
  width: 100%;
  height: 100%;
  box-sizing: border-box;

  transition: @transition-fast;
  transition-property: background-color, opacity;
  color: var(--color-nav-font);
  cursor: pointer;
  text-align: center;
  outline: none;
  display: flex;
  align-items: center;
  justify-content: center;

  .mixin-ellipsis-1();
  &:before {
    .mixin-after();
    left: 0;
    top: 0;
    width: 3px;
    height: 100%;
    background-color: var(--color-primary-dark-200-alpha-700);
    border-radius: 4px;
    transform: translateX(-100%);
    transition: transform @transition-fast;
  }

  &.active {
    background-color: var(--color-primary-light-300-alpha-700);

    &:before {
      transform: translateX(0);
    }

    &:hover {
      background-color: var(--color-primary-light-300-alpha-800);
    }
  }


  &:hover {
    color: var(--color-nav-font);

    &:not(.active) {
      opacity: .8;
      background-color: var(--color-primary-light-400-alpha-700);
    }
  }
  &:active:not(.active) {
    opacity: .6;
    background-color: var(--color-primary-light-300-alpha-600);
  }
}

// 未读角标（左栏首个）。数字为 0 时模板整块不渲染，所以这里不用管空态。
// 底色用主色、字色用 `--color-primary-light-1000`（主题里就是最亮那档 = 白）：本仓库没有
// error/warning 语义 token（§2.5.1 第 3 条），主色底 + 最亮字是既有 token 里唯一可读的组合。
.badge {
  position: absolute;
  top: 6%;
  right: 6%;
  min-width: 15px;
  height: 15px;
  padding: 0 4px;
  box-sizing: border-box;
  border-radius: 8px;
  background-color: var(--color-primary);
  color: var(--color-primary-light-1000);
  font-size: 10px;
  line-height: 15px;
  text-align: center;
  // 角标压在链接的右上角，别让它接住点击——点角标应当照常跳转
  pointer-events: none;
}

</style>
