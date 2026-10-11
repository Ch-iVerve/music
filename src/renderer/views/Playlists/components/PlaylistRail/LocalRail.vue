<template>
  <div ref="dom_lists" :class="$style.lists">
    <ul ref="dom_lists_list" class="scroll" :class="[$style.listsContent, { [$style.sortable]: isModDown }]">
      <!-- 「全部本地音乐」固定节点（票 03）：不是歌单，是库聚合视图的选择器；行尾带数量徽标 -->
      <li
        :class="[$style.listsItem, {[$style.active]: listId == libraryNodeId}]"
        :aria-label="$t('playlists__local_library')" :aria-selected="listId == libraryNodeId"
      >
        <span :class="$style.listsLabel" :title="$t('playlists__local_library')" @click="handleListToggle(libraryNodeId)">
          <span :class="$style.listsName">{{ $t('playlists__local_library') }}</span>
          <span v-if="libraryCount > 0" :class="$style.rowCount">{{ libraryCount }}</span>
        </span>
      </li>
      <li v-if="userLists.length === 0 && !isShowNewList" :class="$style.railTip">
        <span>{{ $t('playlists__local_empty') }}</span>
      </li>
      <li
        v-for="(item, index) in userLists"
        :key="item.id" class="user-list"
        :class="[$style.listsItem, {[$style.active]: item.id == listId}, {[$style.clicked]: rightClickItemIndex == index}, {[$style.fetching]: fetchingListStatus[item.id]}]"
        :data-index="index" :aria-label="item.name" :aria-selected="item.id == listId" @contextmenu="handleListsItemRigthClick($event, index)"
      >
        <!-- 紧凑行（票 13）：无封面无三角槽；行尾「⋯」外显高频动作，右键菜单照旧全量保留 -->
        <span :class="$style.listsLabel" :title="item.name" @click="handleListToggle(item.id)">
          <span :class="$style.listsName">{{ item.name }}</span>
        </span>
        <button
          :class="$style.rowMore"
          :aria-label="$t('playlists__more')" :title="$t('playlists__more')"
          @click.stop="handleRowMore($event, index)"
        >⋯</button>
        <base-input
          :class="$style.listsInput" type="text" :value="item.name"
          :placeholder="item.name" @keyup.enter="handleSaveListName(index, $event)" @blur="handleSaveListName(index, $event)"
        />
      </li>
      <transition enter-active-class="animated-fast slideInLeft" leave-active-class="animated-fast fadeOut" @after-leave="isNewListLeave = false" @after-enter="$refs.dom_listsNewInput.focus()">
        <li v-if="isShowNewList" :class="[$style.listsItem, $style.listsNew, {[$style.newLeave]: isNewListLeave}]">
          <base-input
            ref="dom_listsNewInput" :class="$style.listsInput" type="text" :placeholder="$t('lists__new_list_input')"
            @keyup.enter="handleCreateList" @blur="handleCreateList"
          />
        </li>
      </transition>
    </ul>

    <!-- 底部常驻动作条（票 13）：新建歌单外显为文字按钮；列表更新降为弱化图标 -->
    <div :class="$style.listFooter">
      <button :class="$style.newListBtn" @click="isShowNewList = true">
        <svg version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" :class="$style.newListIcon" viewBox="0 0 24 24" space="preserve">
          <use xlink:href="#icon-list-add" />
        </svg>
        <span>{{ $t('lists__new_list_btn') }}</span>
      </button>
      <button
        :class="$style.footerGhostBtn"
        :aria-label="$t('list_update_modal__title')" :title="$t('list_update_modal__title')"
        @click="isShowListUpdateModal = true"
      >
        <svg version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" height="70%" viewBox="0 0 24 24" space="preserve">
          <use xlink:href="#icon-refresh" />
        </svg>
      </button>
    </div>

    <base-menu v-model="isShowMenu" :menus="menus" :xy="menuLocation" item-name="name" @menu-click="handleMenuClick" />
    <!-- 行尾「⋯」的常用动作子集（票 13）：动作名与右键菜单同一套 case，处理器完全复用 -->
    <base-menu v-model="isShowRowMoreMenu" :menus="rowMoreMenus" :xy="rowMoreMenuLocation" item-name="name" @menu-click="handleMenuClick" />
    <!-- 导出向导（票 11）：JSON / m3u8 / 复制音频文件三选勾 -->
    <library-export-modal :show="showExportWizard" :list-info="wizardListInfo" :musics="wizardMusics" @close="showExportWizard = false" />
    <DuplicateMusicModal v-model:visible="isShowDuplicateMusicModal" :list-info="duplicateListInfo" />
    <ListSortModal v-model:visible="isShowListSortModal" :list-info="sortListInfo" />
    <ListUpdateModal v-model:visible="isShowListUpdateModal" />
  </div>
</template>

<script>
import { LIST_IDS } from '@common/constants'

import DuplicateMusicModal from './components/DuplicateMusicModal.vue'
import ListSortModal from './components/ListSortModal.vue'
import ListUpdateModal from './components/ListUpdateModal.vue'

import { userLists, fetchingListStatus } from '@renderer/store/list/state'
import { removeUserList, getListMusics } from '@renderer/store/list/action'
import { localLibraryGetAll } from '@renderer/utils/ipc'
import LibraryExportModal from '../LibraryExportModal.vue'

import { computed, onBeforeUnmount, ref, shallowReactive, watch } from '@common/utils/vueTools'
import { useRoute, useRouter } from '@common/utils/vueRouter'
import { withTab } from '../../tabs'

import { dialog } from '@renderer/plugins/Dialog'

import { saveListPrevSelectId } from '@renderer/utils/data'

import { useI18n } from '@renderer/plugins/i18n'

import useShare from './useShare'
import useMenu from './useMenu'
import useListUpdate from './useListUpdate'
import useSort from './useSort'
import useDarg from './useDarg'
import useEditList from './useEditList'
import useListScroll from './useListScroll'
import useDuplicate from './useDuplicate'

/**
 * 我的歌单 →「本地歌单」tab 的左栏（工单 09）：本地自建列表那一组。
 *
 * 拆自原来的 `PlaylistRail.vue`（一个组件里塞了本地/云端两组）：本组带**本地库的写能力**
 * （新建/重命名/删除、拖拽排序、排序与查重、导入导出），全部逻辑仍由同目录的 useXxx 提供。
 * 云端那一组在 `CloudRail.vue`——两组的样式共用 `rail.less`。
 *
 * 选中项写在 `route.query.id` 上（保留其它键：`cloud` 属于云端 tab；**`tab` 由页面壳经面板传进来，
 * 每次写入都要显式带上**——理由见 `../../tabs.ts` 的 withTab，工单 02）。
 */
export default {
  name: 'PlaylistRailLocal',
  components: {
    DuplicateMusicModal,
    ListSortModal,
    ListUpdateModal,
    LibraryExportModal,
  },
  props: {
    listId: {
      type: String,
      required: true,
    },
    tab: {
      type: String,
      required: true,
    },
  },
  emits: ['show-menu'],
  setup(props, { emit }) {
    const router = useRouter()
    const route = useRoute()
    const t = useI18n()

    const dom_lists_list = ref(null)
    const rightClickItemIndex = ref(-10)

    const { handleImportList } = useShare()

    // 行尾「⋯」常用菜单（票 13）：动作名与右键菜单同一套 case，处理器完全复用 handleMenuClick
    const isShowRowMoreMenu = ref(false)
    const rowMoreMenuLocation = shallowReactive({ x: 0, y: 0 })
    const rowMoreMenus = computed(() => ([
      { name: t('lists__select_local_file'), action: 'local_file' },
      { name: t('playlists__export_wizard'), action: 'export_wizard' },
      { name: t('lists__duplicate'), action: 'duplicate' },
      { name: t('lists__remove'), action: 'remove' },
    ]))
    const handleRowMore = (event, index) => {
      // 与右键菜单互斥（真机截图咬过人：右键菜单开着时点「⋯」，@click.stop 挡住了
      // document 的点空白收起监听，两层菜单叠在一起）——开一个先关另一个
      isShowMenu.value = false
      rightClickItemIndex.value = index
      rowMoreMenuLocation.x = event.pageX
      rowMoreMenuLocation.y = event.pageY
      isShowRowMoreMenu.value = true
    }

    // 「全部本地音乐」节点徽标（票 13）：曲库数量随导入/删除同步
    const libraryCount = ref(0)
    const refreshLibraryCount = async() => {
      libraryCount.value = (await localLibraryGetAll()).length
    }
    void refreshLibraryCount()
    window.app_event.on('myListUpdate', refreshLibraryCount)
    onBeforeUnmount(() => {
      window.app_event.off('myListUpdate', refreshLibraryCount)
    })

    // 导出向导（票 11）：快照歌单条目进弹窗（导出只读，无并发问题）
    const showExportWizard = ref(false)
    const wizardListInfo = ref(null)
    const wizardMusics = ref([])
    const handleShowExportWizard = async(listInfo) => {
      wizardListInfo.value = listInfo
      wizardMusics.value = await getListMusics(listInfo.id)
      showExportWizard.value = true
    }
    const { isShowListUpdateModal } = useListUpdate()
    const { isShowListSortModal, sortListInfo, handleSortList } = useSort()
    const { isShowDuplicateMusicModal, duplicateListInfo, handleDuplicateList } = useDuplicate()
    const { handleRename, handleSaveListName, isShowNewList, isNewListLeave, handleCreateList } = useEditList({ dom_lists_list })
    useListScroll({ dom_lists_list })

    const handleRemove = (listInfo) => {
      void dialog.confirm({
        message: t('lists__remove_tip', { name: listInfo.name }),
        confirmButtonText: t('lists__remove_tip_button'),
      }).then(isRemove => {
        if (!isRemove) return
        void removeUserList([listInfo.id])
        if (props.listId == listInfo.id) {
          // 删掉的正是当前选中的那个 → 落到剩下的第一个自建列表；一个都不剩就清掉参数显示空态
          // （这里不等 userLists 更新，直接按 id 排除；也不再回落到试听列表——它已从界面退场，工单 07 / ADR 0006）
          const nextList = userLists.find(l => l.id != listInfo.id)
          void router.replace({ path: route.path, query: withTab(route.query, props.tab, { id: nextList?.id }) })
        }
      })
    }

    const {
      menus,
      menuLocation,
      isShowMenu,
      showMenu,
      hideMenu,
      menuClick,
    } = useMenu({
      emit,

      handleImportList,
      handleShowExportWizard,
      handleSortList,
      handleDuplicateList,
      handleRename,
      handleRemove,
    })

    const handleListsItemRigthClick = (event, index) => {
      // 与行尾「⋯」菜单互斥（同 handleRowMore 里的注释）
      isShowRowMoreMenu.value = false
      rightClickItemIndex.value = index
      showMenu(event, index)
    }

    const handleListToggle = (id) => {
      if (id == props.listId) return
      void router.replace({
        path: route.path,
        query: withTab(route.query, props.tab, { id }),
      })
    }

    const handleMenuClick = (action) => {
      if (rightClickItemIndex.value < -2) return
      let index = rightClickItemIndex.value
      rightClickItemIndex.value = -10
      menuClick(action, index)
    }

    const { isModDown } = useDarg({ dom_lists_list, handleMenuClick, handleSaveListName })


    watch(() => props.listId, (listId) => {
      if (listId) saveListPrevSelectId(listId)
    })

    // 监听源必须是 `userLists.slice()`：`userLists` 是 `reactive([])`（store/list/listManage/state.ts:23），
    // 增删都就地改（action.ts:201-202 的 splice），只写 `() => userLists` 读到的是同一个引用，回调一次都不会跑
    watch(() => userLists.slice(), (lists) => {
      if (lists.some(l => l.id == props.listId)) return
      // 一个自建列表都没有就清掉参数（页面显示空态），不回落到试听列表（工单 07 / ADR 0006）
      void router.replace({
        path: route.path,
        query: withTab(route.query, props.tab, { id: lists[0]?.id }),
      })
    })

    return {
      rightClickItemIndex,
      userLists,
      fetchingListStatus,
      dom_lists_list,
      isShowListUpdateModal,
      isShowListSortModal,
      sortListInfo,
      isShowDuplicateMusicModal,
      duplicateListInfo,
      handleSaveListName,
      isShowNewList,
      isNewListLeave,
      handleCreateList,
      handleListsItemRigthClick,
      isShowMenu,
      handleMenuClick,
      menus,
      menuLocation,
      handleListToggle,
      isModDown,
      hideMenu,
      libraryNodeId: LIST_IDS.LOCAL_LIBRARY,
      handleShowExportWizard,
      showExportWizard,
      wizardListInfo,
      wizardMusics,
      isShowRowMoreMenu,
      rowMoreMenuLocation,
      rowMoreMenus,
      handleRowMore,
      libraryCount,
    }
  },
}
</script>

<style lang="less" module>
@import './rail.less';
</style>
