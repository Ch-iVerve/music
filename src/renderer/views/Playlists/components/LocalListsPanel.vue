<template>
  <div :class="$style.container">
    <local-rail :list-id="listId" :tab="tab" />
    <!-- 一个自建列表都没有：右栏明说没得选，而不是把别的列表塞进来（工单 07 / ADR 0006；左栏另有提示条） -->
    <div v-if="!listId" :class="$style.empty">{{ $t('playlists__local_empty') }}</div>
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

/**
 * 我的歌单 →「本地歌单」tab（工单 09）：左栏本地自建列表 + 右栏该列表的歌曲表。
 *
 * 这个文件只是壳：左栏在 `PlaylistRail/LocalRail.vue`，右栏是共享的 `ListMusicTable`。
 * 本地列表的数据在本地库（list store），没有要在这里取的数，选中项由 `route.query.id` 派生。
 *
 * 库（原「全部本地音乐」节点）已升为一级入口（集合概念统一 D3 / 票 04，`/library`）——
 * 本 tab 只剩歌单编排这一件事；老深链 `?id=local_library` 转入 `/library`。
 * 没指定本地列表时返回空串（右栏显示空态）——**不回落到任何保留列表**（试听列表 / 本地收藏
 * 均已退休，工单 07 / ADR 0006 / 集合概念统一）。
 */
export default {
  name: 'PlaylistsLocalPanel',
  components: {
    LocalRail,
    ListMusicTable,
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

    const listId = computed(() => {
      const id = route.query.id as string | undefined
      if (id && userLists.some(l => l.id === id)) return id
      // 没选（或选的是已删除的列表）：落到第一个自建列表（库已升为一级入口，不再是兜底节点）；
      // 一个自建列表都没有时返回空串，右栏显示空态
      return userLists[0]?.id ?? ''
    })

    // 库的老深链（`?id=local_library`，本地媒体库票 03 起它是个固定节点）→ 转到新一级入口
    if (route.query.id === LIST_IDS.LOCAL_LIBRARY) {
      void router.replace({ path: '/library' })
    } else if (route.query.id == null && listId.value) {
      // 归一：本地 tab 里没有 id 且有可选的本地列表时补一个（地址栏里能看出当前选的是哪一个）。
      // 保留其它键——`cloud` 属于云端 tab（切回去时它的选中项还在）；`tab` 必须**显式带**：
      // 这次写入可能发生在「切 tab 的导航还没落地」的窗口里，那时 route.query 里根本没有 tab，
      // 靠 spread 保留就会把 tab 写丢、被 tabFromQuery 判回云端（工单 02）
      void router.replace({ path: route.path, query: withTab(route.query, props.tab, { id: listId.value }) })
    }

    return {
      listId,
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
