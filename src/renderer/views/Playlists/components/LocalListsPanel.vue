<template>
  <div :class="$style.container">
    <local-rail :list-id="listId" :tab="tab" />
    <!-- 「全部本地音乐」固定节点（票 03）：库聚合视图，不是歌单 → 走独立的 LocalLibraryView -->
    <local-library-view v-if="listId === LIBRARY_NODE_ID" />
    <!-- 一个自建列表都没有：右栏明说没得选，而不是把别的列表（试听列表 / 我的收藏）塞进来
         （工单 07 / ADR 0006；左栏另有自己的提示条） -->
    <div v-else-if="!listId" :class="$style.empty">{{ $t('playlists__local_empty') }}</div>
    <list-music-table v-else :list-id="listId" />
  </div>
</template>

<script lang="ts">
import { computed } from '@common/utils/vueTools'
import { useRouter, useRoute } from '@common/utils/vueRouter'
import { LIST_IDS } from '@common/constants'
import { userLists } from '@renderer/store/list/state'
import { type TabId, withTab } from '../tabs'
import LocalRail from './PlaylistRail/LocalRail.vue'
import ListMusicTable from '@renderer/components/common/ListMusicTable/index.vue'
import LocalLibraryView from './LocalLibraryView.vue'

/**
 * 我的歌单 →「本地歌单」tab（工单 09）：左栏本地自建列表 + 右栏该列表的歌曲表。
 *
 * 这个文件只是壳：左栏在 `PlaylistRail/LocalRail.vue`，右栏是共享的 `ListMusicTable`。
 * 本地列表的数据在本地库（list store），没有要在这里取的数，选中项由 `route.query.id` 派生。
 *
 * 没指定本地列表时落到第一个自建列表。**不回落到试听列表**——它已从界面退场（工单 07 / ADR 0006）；
 * 一个自建列表都没有时返回空串，右栏显示空态文案。
 */
export default {
  name: 'PlaylistsLocalPanel',
  components: {
    LocalRail,
    ListMusicTable,
    LocalLibraryView,
  },
  props: {
    // 页面壳传下来的当前 tab：本面板写 `id` 时要把它一起写回 query（理由见 `../tabs.ts` 的 withTab）
    tab: {
      type: String,
      required: true,
    },
  },
  setup(props: { tab: TabId }) {
    const router = useRouter()
    const route = useRoute()

    const LIBRARY_NODE_ID = LIST_IDS.LOCAL_LIBRARY
    const listId = computed(() => {
      const id = route.query.id as string | undefined
      if (id && (userLists.some(l => l.id === id) || id === LIST_IDS.LOCAL_LIBRARY)) return id
      // 没选（或选的是已删除的列表）：落到「全部本地音乐」节点（票 03 起它是本 tab 的默认视图，
      // 永远存在；此前是落到第一个自建列表）
      return LIBRARY_NODE_ID
    })

    // 归一：本地 tab 里没有 id 且有可选的本地列表时补一个（地址栏里能看出当前选的是哪一个）。
    // 保留其它键——`cloud` 属于云端 tab（切回去时它的选中项还在）；`tab` 必须**显式带**：
    // 这次写入可能发生在「切 tab 的导航还没落地」的窗口里，那时 route.query 里根本没有 tab，
    // 靠 spread 保留就会把 tab 写丢、被 tabFromQuery 判回云端（工单 02）
    if (route.query.id == null && listId.value) {
      void router.replace({ path: route.path, query: withTab(route.query, props.tab, { id: listId.value }) })
    }

    return {
      listId,
      LIBRARY_NODE_ID,
    }
  },
}
</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.container {
  height: 100%;
  display: flex;
  flex-flow: row nowrap;
  // 左栏（21%）与右栏之间的呼吸位：此前为 0，右栏首元素（搜索框/标题）贴着左栏滚动条，
  // 两栏在视觉上黏成一块（真机截图红框处，2026-10-12）
  gap: 16px;
}

// 没有可选本地列表时的空态（右栏）
.empty {
  flex: auto;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  color: var(--color-font-label);
}
</style>
