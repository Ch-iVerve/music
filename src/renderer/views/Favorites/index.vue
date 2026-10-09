<template>
  <div :class="$style.container">
    <div :class="$style.header">
      <base-tab v-model="tab" :class="$style.tabs" :list="tabs" item-key="tab" @change="handleTabChange" />
    </div>
    <!-- Tab 懒加载：v-if（不是 v-show）——切进来才挂载、才取那一块的数据 -->
    <div :class="$style.content">
      <songs-panel v-if="tab === 'songs'" />
      <fav-lists-panel v-else-if="tab === 'lists'" />
      <fav-albums-panel v-else-if="tab === 'albums'" />
      <follow-singers-panel v-else-if="tab === 'singers'" />
      <dislike-songs-panel v-else-if="tab === 'dislike'" />
    </div>
  </div>
</template>

<script lang="ts">
import { ref, watch } from '@common/utils/vueTools'
import { useRouter, useRoute } from '@common/utils/vueRouter'
import SongsPanel from './components/SongsPanel.vue'
import FavListsPanel from './components/FavListsPanel.vue'
import FavAlbumsPanel from './components/FavAlbumsPanel.vue'
import FollowSingersPanel from './components/FollowSingersPanel.vue'
import DislikeSongsPanel from './components/DislikeSongsPanel.vue'

/**
 * 我的收藏（工单 05）：**所有收藏类的归口**——歌曲 / 歌单 / 专辑 / 歌手。
 *
 * 这个文件只是壳：Tab 切换与 query 同步。每块内容在 components/ 里，各自取数。
 *
 * Tab 写在 route.query.tab 上：可分享，且从歌单/专辑/歌手详情返回时能回到原 Tab
 * （专辑/歌手详情用 router.back() 回历史记录；歌单详情用 fromTab，见 SongCardGrid）。
 */

const TABS = ['songs', 'albums', 'lists', 'singers', 'dislike'] as const
type TabId = typeof TABS[number]

const normalizeTab = (tab: unknown): TabId => TABS.includes(tab as TabId) ? tab as TabId : TABS[0]

export default {
  name: 'Favorites',
  components: {
    SongsPanel,
    FavListsPanel,
    FavAlbumsPanel,
    FollowSingersPanel,
    DislikeSongsPanel,
  },
  setup() {
    const router = useRouter()
    const route = useRoute()
    const tab = ref<TabId>(normalizeTab(route.query.tab))

    const tabs = [
      // 首 tab 就是「我收藏的歌曲」——试听列表退场后它不再需要更上层的名字（工单 07）
      { tab: 'songs', label: window.i18n.t('favorites__tab_fav_songs' as any) },
      { tab: 'albums', label: window.i18n.t('favorites__tab_albums' as any) },
      { tab: 'lists', label: window.i18n.t('favorites__tab_lists' as any) },
      { tab: 'singers', label: window.i18n.t('favorites__tab_singers' as any) },
      // 第五个 tab：云端「不喜欢」（数据类票 02）。同属账号里的云端数据，与上面四个并列；
      // 与本地不喜欢列表（core/dislikeList，拦播放那份）不是一回事。
      { tab: 'dislike', label: window.i18n.t('favorites__tab_dislike' as any) },
    ]

    const handleTabChange = (id: TabId) => {
      // 切 Tab 只留 tab 这一个参数：旧书签里的 `favSource` 等键顺带清掉（歌曲 Tab 已无内层来源）
      void router.replace({ path: route.path, query: { tab: id } })
    }

    watch(() => route.query.tab, (next) => {
      tab.value = normalizeTab(next)
    })

    return {
      tab,
      tabs,
      handleTabChange,
    }
  },
}
</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.container {
  height: 100%;
  // 根容器带左右 padding 时必须 border-box，否则溢出窗口右侧（AGENTS §2.5.1 第 10 条）
  box-sizing: border-box;
  padding: 16px 22px 0;
  color: var(--color-font);
  display: flex;
  flex-flow: column nowrap;
}

.header {
  flex: none;
  display: flex;
  align-items: center;
  padding-bottom: 6px;
}
// base-tab 自带 15px 内边距，这里抵消掉，让 tab 与内容左对齐
.tabs {
  margin-left: -15px;
}

.content {
  flex: auto;
  min-height: 0;
  position: relative;
}
</style>
