<template>
  <div id="local-music" :class="$style.container">
    <!-- 下载任务条：有进行中/失败任务时显示（库是主视图，任务条只在有任务时出现、完成即消失） -->
    <download-task-bar />
    <local-library-view />
  </div>
</template>

<script lang="ts">
import { getDownloadList } from '@renderer/store/download/action'
import LocalLibraryView from './components/LocalLibraryView.vue'
import DownloadTaskBar from './components/DownloadTaskBar.vue'

/**
 * 本地音乐（集合概念统一 D3/票 04）：库升为一级入口，并与下载合并成一页——
 * 主体是库视图（素材总集，含搜索/分组/导入/重扫/编辑/导出），顶部在有下载任务时出现任务条
 * （下载完成即收编入库，见票 03）。
 *
 * 历史：库节点原先是「我的歌单 → 本地歌单」tab 左栏里的一个固定节点（本地媒体库票 03），
 * 与自建列表（编排）混装；本页把它拿出来独立成入口。左栏导航里的「我的下载」入口由本页承接
 * （旧地址 `/download` 重定向到 `/library`）。
 */
export default {
  name: 'Library',
  components: {
    LocalLibraryView,
    DownloadTaskBar,
  },
  setup() {
    // 进页把**上一会话留下的未完成任务**拉进 store（沿用「进页面才拉下载列表」的老口径）。
    // 为什么要挂在本页而不是任务条里：任务条 `v-if` 没任务就不渲染，它自己的钩子永远等不到
    // 第一次加载——重启后暂停中的任务会既看不见也续不上（下载页删除后 `getDownloadList`
    // 一度没有调用方，票 07 复核补回）。
    void getDownloadList()
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
</style>
