<template>
  <!-- QQ 云端自建歌单（工单 06 / 拆 tab 见工单 09）：这组改的是 QQ 云端（与本地组是两套数据、
       两种写语义），只放开已实现的能力（建 / 带封面建 / 删）——重命名、排序、导入导出不出现，
       点了没反应比没有更糟。加歌 / 删歌 / 刷新在右栏的 CloudListPane。
       「带封面」只做在**新建**上（封面直传 COS 后随 AddPlaylist 一起提交）：
       改已有歌单封面的端点实测不可用，见 useCloudLists.ts 的注释与 tx/songList.js。 -->
  <div :class="$style.lists">
    <ul class="scroll" :class="$style.listsContent">
      <li v-if="cloudLists.length === 0 && !isShowNewCloudList" :class="$style.railTip">
        <span v-text="cloudListsLabel" />
      </li>
      <li
        v-for="item in cloudLists"
        :key="`cloud__${item.dirId}`" class="cloud-list"
        :class="[$style.listsItem, {[$style.active]: String(item.dirId) == cloudDirId}, {[$style.clicked]: rightClickCloudItem?.dirId === item.dirId}]"
        :aria-label="item.name" @contextmenu="handleCloudItemRigthClick($event, item)" @click="handleSelect(String(item.dirId))"
      >
        <span :class="$style.listsLabel" :title="item.name">
          <!-- 封面来自卡片的 `img`（`getCreatedSonglist` 的 logo / picUrl）；空或加载失败时组件内部落占位图 -->
          <playlist-cover :src="item.img" />
          <span :class="$style.listsName">{{ item.name }}</span>
        </span>
      </li>
      <transition enter-active-class="animated-fast slideInLeft" leave-active-class="animated-fast fadeOut" @after-leave="isNewCloudListLeave = false" @after-enter="$refs.dom_cloudNewInput.focus()">
        <li v-if="isShowNewCloudList" :class="[$style.listsItem, $style.listsNew, {[$style.newLeave]: isNewCloudListLeave}]">
          <!-- 选好的封面：看得见才不会被忘掉；点它 = 去掉封面（回到不带封面建） -->
          <img
            v-if="newListCover" :class="$style.listsNewCover" :src="newListCover.url" alt=""
            :aria-label="$t('playlists__cloud_cover_clear')" :title="$t('playlists__cloud_cover_clear')" @click="handleCoverRemove"
          >
          <base-input
            ref="dom_cloudNewInput" :class="$style.listsInput" type="text" :placeholder="$t('playlists__cloud_new_input')"
            @keyup.enter="handleCreateCloudList" @blur="handleCreateCloudList"
          />
        </li>
      </transition>
    </ul>

    <!-- 底部常驻动作条（票 13）：新建歌单外显；普通/带封面两种建法走小菜单 -->
    <div :class="$style.listFooter">
      <button :class="$style.newListBtn" @click="isShowCloudNewMenu = !isShowCloudNewMenu">
        <svg version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" :class="$style.newListIcon" viewBox="0 0 24 24" space="preserve">
          <use xlink:href="#icon-list-add" />
        </svg>
        <span>{{ $t('lists__new_list_btn') }}</span>
      </button>
    </div>
    <base-menu v-model="isShowCloudNewMenu" :menus="cloudNewMenus" :xy="cloudNewMenuLocation" item-name="name" @menu-click="handleCloudNewMenuClick" />
    <!-- 隐藏的文件选择器：带封面建走它（`.coverPicker` 是 display:none，不占布局） -->
    <input ref="dom_coverPicker" :class="$style.coverPicker" type="file" accept="image/png,image/jpeg,image/gif,image/webp" @change="handleCoverPicked">

    <!-- 右键删除云端歌单（含二次确认） -->
    <base-menu v-model="isShowCloudMenu" :menus="cloudMenus" :xy="cloudMenuLocation" item-name="name" @menu-click="handleCloudMenuClick" />
  </div>
</template>

<script lang="ts">
import { ref, shallowReactive, toRef } from '@common/utils/vueTools'
import { type TabId } from '../../tabs'
import { useI18n } from '@renderer/plugins/i18n'
import PlaylistCover from './PlaylistCover.vue'
import useCloudLists from './useCloudLists'

/**
 * 我的歌单 →「QQ 音乐·歌单」tab 的左栏（工单 09）：云端自建歌单那一组。
 *
 * 拆自原来的 `PlaylistRail.vue`：本组**不带**本地那一套（useMenu/useDarg/useShare/useEditList
 * 都是本地库专用，`useDarg` 还会挂全局按键监听），逻辑只有取数与建 / 删，见 `useCloudLists.ts`。
 * 样式与本地组共用 `rail.less`。
 */
export default {
  name: 'PlaylistRailCloud',
  components: {
    PlaylistCover,
  },
  props: {
    cloudDirId: {
      type: String,
      default: '',
    },
    // 页面壳传下来的当前 tab（经面板中转）：写 `cloud` 时一起写回 query，别把 tab 写丢（工单 02）
    tab: {
      type: String,
      required: true,
    },
  },
  setup(props: { cloudDirId: string, tab: TabId }) {
    // 底部「＋新建歌单」的两种建法（票 13）：普通 / 带封面（封面只在新建时能给，见文件头注释）
    const t = useI18n()
    const dom_coverPicker = ref<HTMLInputElement | null>(null)
    const isShowCloudNewMenu = ref(false)
    const cloudNewMenuLocation = shallowReactive({ x: 0, y: 0 })
    const cloudNewMenus = [
      { name: t('playlists__cloud_new'), action: 'plain' },
      { name: t('playlists__cloud_new_with_cover'), action: 'cover' },
    ]
    // 只实例化一次：点击处理器复用同一份状态（重复调用会造出第二份 ref，改动就落空了）
    const cloud = useCloudLists({ cloudDirId: toRef(props, 'cloudDirId'), tab: toRef(props, 'tab') })
    const handleCloudNewMenuClick = (action: string) => {
      if (action == 'plain') cloud.isShowNewCloudList.value = true
      else if (action == 'cover') dom_coverPicker.value?.click()
    }
    return {
      ...cloud,
      dom_coverPicker,
      isShowCloudNewMenu,
      cloudNewMenuLocation,
      cloudNewMenus,
      handleCloudNewMenuClick,
    }
  },
}
</script>

<style lang="less" module>
@import './rail.less';
</style>
