<template>
  <div id="my-playlists" :class="$style.container">
    <div :class="$style.header">
      <base-tab v-model="tab" :class="$style.tabs" :list="tabs" item-key="tab" @change="handleTabChange" />
    </div>
    <!-- Tab 懒加载：v-if（不是 v-show）——切进来才挂载；云端那组因此只在切到该 tab 时才取 createdLists -->
    <!-- `:tab` 必须传下去：面板写自己的 id / cloud 时要**带上当前 tab**，否则会把 `tab` 键写丢（工单 02） -->
    <div :class="$style.content">
      <local-lists-panel v-if="tab === 'local'" :tab="tab" />
      <cloud-lists-panel v-else-if="tab === 'cloud'" :tab="tab" />
    </div>
    <!-- 托管导入的进度/汇总弹窗（票 02）：状态在 core/localLibrary；挂在页面壳而不是本地面板——
         面板被 tab 的 v-if 卸载时弹窗不能跟着消失（进行中的导入会失去取消入口） -->
    <local-import-progress-modal />
  </div>
</template>

<script lang="ts">
import { ref, watch } from '@common/utils/vueTools'
import { useRouter, useRoute } from '@common/utils/vueRouter'
import { type TabId, tabFromQuery, withTab } from './tabs'
import LocalListsPanel from './components/LocalListsPanel.vue'
import CloudListsPanel from './components/CloudListsPanel.vue'
import LocalImportProgressModal from '@renderer/components/common/LocalImportProgressModal.vue'

/**
 * 我的歌单（工单 09；默认 tab 与顺序见工单 07）：两个 tab——**在线**（QQ 云端自建歌单）
 * 与 **本地**（本地自建列表）。两者是**两套数据、两种写语义**，以前堆在一根左栏里两个组
 * 各自滚动，现在各占一个 tab，每个 tab 内部仍是「左栏 + 右栏」。
 *
 * tab 文案（2026-10-13 用户口径）：`playlists__tab_local` 从「库」改成「本地」——票 04 起
 * 库（素材总集）已升为独立一级入口「本地音乐」，本 tab 只剩自建列表，继续叫「库」会与
 * 本地媒体库撞词（`CONTEXT.md` 的 _Avoid_ 正是这一条）。
 *
 * 这个文件只是壳：Tab 切换与 query 同步；两个面板在 components/ 里，各自取数。
 *
 * query（三个键各归其主）：
 * - `tab`：`cloud` / `local`，本文件写
 * - `id`：本地 tab 选中的列表，`LocalListsPanel` 写
 * - `cloud`：云端 tab 选中的 dirId，`CloudRail` 写
 * 切 tab **不丢**另外两个键：那是各自 tab 内部的选择，切回去还在原位（与收藏页把参数清掉不同——
 * 那边的参数只对一个 tab 有意义）。老地址因此照旧可用：`?id=…` 落本地 tab、`?cloud=…` 落云端 tab，
 * 两者都缺时默认 `cloud`（推断规则见 `./tabs.ts`，单测在 `tabs.test.ts`）。
 *
 * ⚠️ 三个键**每个写入方都要带全**：`id` / `cloud` 的写入方（两个面板与左栏）必须用
 * `withTab(route.query, props.tab, …)` 把 tab 一起写回去，`tab` 的写入方（本文件）用
 * `withTab`。理由见 `./tabs.ts` 里 `withTab` 的注释（工单 02：路由器异步期间读到旧 query，
 * 「顺带保留」靠不住）。因此当前 tab 要按 props 往下传。
 *
 * ⚠️ 默认 tab 是云端：进页面就会挂 `CloudListsPanel` → 跑一次 `initUserCenter()`（未登录时
 * 云端那组落「未登录」文案）。这是「默认看 QQ 歌单」的既定代价，不是漏懒加载。
 */

export default {
  name: 'Playlists',
  components: {
    LocalListsPanel,
    CloudListsPanel,
    LocalImportProgressModal,
  },
  setup() {
    const router = useRouter()
    const route = useRoute()

    const tab = ref<TabId>(tabFromQuery(route.query as Record<string, unknown>))

    // 顺序与 tabs.ts 的 TABS 一致：**第一个是默认 tab**（cloud，2026-09-24 用户定），
    // 本地第二。两处顺序别各改各的——TABS 那边有单测钉着，改它就要一起改这里。
    const tabs = [
      { tab: 'cloud', label: window.i18n.t('playlists__tab_cloud' as any) },
      { tab: 'local', label: window.i18n.t('playlists__tab_local' as any) },
    ]

    const handleTabChange = (id: TabId) => {
      // 另一个 tab 的选中参数（`id` / `cloud`）**故意保留**：切回去还在原位（见文件头的口径）。
      // tab 由 `withTab` 显式带上——本文件是唯一写它的地方。
      void router.replace({ path: route.path, query: withTab(route.query, id) })
    }

    // 地址栏被外部改（老地址重定向进来、外部链接）时跟上；两个面板自己写的 id / cloud 也在这里
    // 过一遍——有 `tab` 键时它说了算，没有时按老链接语义推断，所以不会出现「写 id 把 tab 改掉」
    watch(() => [route.query.tab, route.query.id, route.query.cloud], () => {
      tab.value = tabFromQuery(route.query as Record<string, unknown>)
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
