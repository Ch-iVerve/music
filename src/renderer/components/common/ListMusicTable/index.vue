<template>
  <div :class="$style.list">
    <!-- 本地列表的歌曲表（试听列表 / 我的收藏 / 本地自建列表共用同一份实现）。
         「我的收藏」页的歌曲表不在这里——它只有一路 QQ「我喜欢」，见
         views/Favorites/components/SongsPanel.vue。 -->
    <div class="thead">
      <table>
        <thead>
          <tr v-if="actionButtonsVisible">
            <th class="num" style="width: 5%;">#</th>
            <th class="nobreak">{{ $t('music_name') }}</th>
            <th class="nobreak" style="width: 22%;">{{ $t('music_singer') }}</th>
            <th class="nobreak" style="width: 22%;">{{ $t('music_album') }}</th>
            <th class="nobreak" style="width: 9%;">{{ $t('music_time') }}</th>
            <th class="nobreak" style="width: 16%;">{{ $t('action') }}</th>
          </tr>
          <tr v-else>
            <th class="num" style="width: 5%;">#</th>
            <th class="nobreak">{{ $t('music_name') }}</th>
            <th class="nobreak" style="width: 25%;">{{ $t('music_singer') }}</th>
            <th class="nobreak" style="width: 28%;">{{ $t('music_album') }}</th>
            <th class="nobreak" style="width: 10%;">{{ $t('music_time') }}</th>
          </tr>
        </thead>
      </table>
    </div>
    <div v-show="list.length" ref="dom_listContent" :class="$style.content">
      <base-virtualized-list
        v-if="actionButtonsVisible" ref="listRef" v-slot="{ item, index }" :list="list" key-name="id"
        :item-height="listItemHeight" container-class="scroll" content-class="list"
        @scroll="saveListPosition" @contextmenu.capture="handleListRightClick"
      >
        <div
          class="list-item" :class="[{ [$style.active]: playingRowIndex === index }, { selected: selectedIndex == index || rightClickSelectedIndex == index }, { active: selectedList.includes(item) }, { disabled: !assertApiSupport(item.source) || isUnavailableRow(item) }]"
          :title="isUnavailableRow(item) ? $t('list__unavailable_song') : null"
          @click="handleListItemClick($event, index)" @contextmenu="handleListItemRightClick($event, index)"
        >
          <div class="list-item-cell no-select" :class="$style.num" style="flex: 0 0 5%;">
            <transition name="play-active">
              <div v-if="playingRowIndex === index" :class="$style.playIcon">
                <svg version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" height="50%" viewBox="0 0 512 512" space="preserve">
                  <use xlink:href="#icon-play-outline" />
                </svg>
              </div>
              <div v-else class="num">{{ index + 1 }}</div>
            </transition>
          </div>
          <div class="list-item-cell auto name" :aria-label="item.name">
            <span class="select name">{{ item.name }}</span>
            <span v-if="isShowSource" class="no-select label-source">{{ getSourceName(item.source) }}</span>
            <span v-if="item.source == 'local' && isMediaPathMissing(item.meta.filePath)" :class="$style.missingBadge" :title="$t('playlists__missing_file_tip')">{{ $t('playlists__missing_file') }}</span>
          </div>
          <div class="list-item-cell" style="flex: 0 0 22%;">
            <span
              class="select" :class="{ [$style.jump]: canJumpToSinger(item) }"
              :title="canJumpToSinger(item) ? $t('list__jump_singer') : $t('list__jump_singer_disabled')"
              :aria-label="item.singer" @click.stop="handleSingerNameClick(item, $event)"
            >{{ item.singer }}</span>
          </div>
          <div class="list-item-cell" style="flex: 0 0 22%;">
            <span
              class="select" :class="{ [$style.jump]: canJumpToAlbum(item) }"
              :title="canJumpToAlbum(item) ? $t('list__jump_album') : $t('list__jump_album_disabled')"
              :aria-label="item.meta.albumName" @click.stop="handleAlbumNameClick(item, $event)"
            >{{ item.meta.albumName }}</span>
          </div>
          <div class="list-item-cell" style="flex: 0 0 9%;"><span class="no-select">{{ item.interval || '--/--' }}</span></div>
          <div class="list-item-cell" style="flex: 0 0 16%; padding-left: 0; padding-right: 0;">
            <!-- 心形键与在线歌曲表同一套（工单 06 的补丁）：能收藏的判据在 ListButtons 里，
                 本地文件这一首不显示死键；收藏态读 store/user，写成功后才就地变色 -->
            <material-list-buttons
              :index="index" :music-info="item" fav-btn
              :download-btn="assertApiSupport(item.source) && item.source != 'local'" @btn-click="handleListBtnClick"
            />
          </div>
        </div>
      </base-virtualized-list>
      <base-virtualized-list
        v-else ref="listRef" v-slot="{ item, index }" :list="list" key-name="id"
        :item-height="listItemHeight" container-class="scroll" content-class="list"
        @scroll="saveListPosition" @contextmenu.capture="handleListRightClick"
      >
        <div
          class="list-item"
          :class="[{ [$style.active]: playingRowIndex === index }, { selected: selectedIndex == index || rightClickSelectedIndex == index }, { active: selectedList.includes(item) }, { disabled: !assertApiSupport(item.source) || isUnavailableRow(item) }]"
          :title="isUnavailableRow(item) ? $t('list__unavailable_song') : null"
          @click="handleListItemClick($event, index)" @contextmenu="handleListItemRightClick($event, index)"
        >
          <div class="list-item-cell no-select" :class="$style.num" style="flex: 0 0 5%;">
            <transition name="play-active">
              <div v-if="playingRowIndex === index" :class="$style.playIcon">
                <svg version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" height="50%" viewBox="0 0 512 512" space="preserve">
                  <use xlink:href="#icon-play-outline" />
                </svg>
              </div>
              <div v-else class="num">{{ index + 1 }}</div>
            </transition>
          </div>
          <div class="list-item-cell auto name">
            <span class="select name" :aria-label="item.name">{{ item.name }}</span>
            <span v-if="isShowSource" class="no-select label-source">{{ getSourceName(item.source) }}</span>
            <span v-if="item.source == 'local' && isMediaPathMissing(item.meta.filePath)" :class="$style.missingBadge" :title="$t('playlists__missing_file_tip')">{{ $t('playlists__missing_file') }}</span>
          </div>
          <div class="list-item-cell" style="flex: 0 0 25%;">
            <span
              class="select" :class="{ [$style.jump]: canJumpToSinger(item) }"
              :title="canJumpToSinger(item) ? $t('list__jump_singer') : $t('list__jump_singer_disabled')"
              :aria-label="item.singer" @click.stop="handleSingerNameClick(item, $event)"
            >{{ item.singer }}</span>
          </div>
          <div class="list-item-cell" style="flex: 0 0 28%;">
            <span
              class="select" :class="{ [$style.jump]: canJumpToAlbum(item) }"
              :title="canJumpToAlbum(item) ? $t('list__jump_album') : $t('list__jump_album_disabled')"
              :aria-label="item.meta.albumName" @click.stop="handleAlbumNameClick(item, $event)"
            >{{ item.meta.albumName }}</span>
          </div>          <div class="list-item-cell" style="flex: 0 0 10%;"><span class="no-select">{{ item.interval || '--/--' }}</span></div>
        </div>
      </base-virtualized-list>
    </div>
    <div v-show="!list.length" :class="$style.noItem">
      <p v-text="$t('no_item')" />
    </div>
    <common-list-add-modal
      v-model:show="isShowListAdd" :is-move="isMove" :from-list-id="listId"
      :music-info="selectedAddMusicInfo" :exclude-list-id="excludeListIds" teleport="#view"
    />
    <common-list-add-multiple-modal
      v-model:show="isShowListAddMultiple" :from-list-id="listId"
      :is-move="isMoveMultiple" :music-list="selectedList" :exclude-list-id="excludeListIds" teleport="#view" @confirm="removeAllSelect"
    />
    <common-download-modal v-model:show="isShowDownload" :music-info="selectedDownloadMusicInfo" teleport="#view" :list-id="listId" />
    <common-download-multiple-modal v-model:show="isShowDownloadMultiple" :list="selectedList" teleport="#view" :list-id="listId" @confirm="removeAllSelect" />
    <search-list :list="list" :visible="isShowSearchBar" @action="handleMusicSearchAction" />
    <music-sort-modal v-model:show="isShowMusicSortModal" :music-info="selectedSortMusicInfo" :selected-num="selectedNum" @confirm="sortMusic" />
    <!-- 批量编辑（票 10）：行右键菜单在多选 ≥2 时出现；完成后发 myListUpdate 让表格重拉 -->
    <library-batch-edit-modal
      :show="isShowBatchEdit"
      :musics="batchEditMusics"
      teleport="#view"
      @close="isShowBatchEdit = false"
      @done="handleBatchEditDone"
    />
    <base-menu v-model="isShowItemMenu" :menus="menus" :xy="menuLocation" item-name="name" @menu-click="handleMenuClick" />
    <!-- 多位歌手时让用户挑（工单 02）：用仓库既有的 base-menu，不自造弹窗 -->
    <base-menu v-model="isShowSingerPicker" :menus="singerPickerMenus()" :xy="singerPickerXy" item-name="name" @menu-click="handleSingerPickerClick" />
  </div>
</template>

<script>
import { ref } from '@common/utils/vueTools'
import { clipboardWriteText } from '@common/utils/electron'
import { assertApiSupport } from '@renderer/store/utils'
import { getSourceName } from '@renderer/store'
import { isMediaPathMissing } from '@renderer/core/localLibrary/availability'
import SearchList from './components/SearchList.vue'
import MusicSortModal from './components/MusicSortModal.vue'
import LibraryBatchEditModal from '@renderer/views/Playlists/components/LibraryBatchEditModal.vue'
import useListInfo from './useListInfo'
import useList from './useList'
import useMenu from './useMenu'
import usePlay from './usePlay'
import useMusicDownload from './useMusicDownload'
import useMusicAdd from './useMusicAdd'
import useSort from './useSort'
import useMusicActions from './useMusicActions'
import useSearch from './useSearch'
import useListScroll from './useListScroll'
import usePlayingRowLocate from '@renderer/utils/compositions/usePlayingRowLocate'
import useFavSong from '@renderer/utils/compositions/useFavSong'
import { appSetting } from '@renderer/store/setting'
import { isUnavailableMusic } from '@renderer/core/music/unavailable'

export default {
  name: 'ListMusicTable',
  components: {
    SearchList,
    MusicSortModal,
    LibraryBatchEditModal,
  },
  props: {
    listId: {
      type: String,
      required: true,
    },
  },
  emits: ['show-menu'],
  setup(props, { emit }) {
    const actionButtonsVisible = appSetting['list.actionButtonsVisible']

    // 「我喜欢」的一键开关（工单 06 的补丁）：行内心形键点它切换，与在线歌曲表共用同一份
    // 判定与文案（`useFavSong`）；右键菜单那一份在 useMenu 里，也是同一个组合式
    const { toggleFav, loadFavState } = useFavSong()
    // 心形键要显示收藏态：一挂载就把它拉回来（store 里缓存，一次会话只真拉一次）。
    // 只在开着操作键时拉——关着的时候行内根本没有这颗心，白拉一次请求
    if (actionButtonsVisible) loadFavState()

    // 批量编辑（票 10）：快照当前多选（弹窗期间清选不影响名单）；完成发 myListUpdate 触发表格重拉
    const isShowBatchEdit = ref(false)
    const batchEditMusics = ref([])
    const handleShowBatchEditModal = () => {
      batchEditMusics.value = [...selectedList.value]
      isShowBatchEdit.value = true
    }
    const handleBatchEditDone = () => {
      removeAllSelect()
      window.app_event.emit('myListUpdate', [props.listId])
    }

    let scrollIndex = null
    let isAnimation = false
    let isCenter = false
    const handleRestoreScroll = (_scrollIndex, _isAnimation, _isCenter = false) => {
      scrollIndex = _scrollIndex
      isAnimation = _isAnimation
      isCenter = _isCenter
      if (isAnimation) void restoreScroll(scrollIndex, isAnimation, isCenter)
      // console.log('handleRestoreScroll', scrollIndex, isAnimation)
    }
    const onLoadedList = () => {
      // console.log('restoreScroll', scrollIndex, isAnimation)
      void restoreScroll(scrollIndex, isAnimation, isCenter)
    }

    const {
      rightClickSelectedIndex,
      selectedIndex,
      dom_listContent,
      listRef,
      list,
      playingRowIndex,
      setSelectedIndex,
      isShowSource,
      excludeListIds,
    } = useListInfo({ props, onLoadedList })

    const {
      selectedList,
      listItemHeight,
      handleSelectData,
      removeAllSelect,
    } = useList({ listRef, list })

    // 「定位到正在播放」：判定走 `playingRowIndex`，滚动与给播放栏的登记在这个组合式里（工单 08）
    const { scrollToIndexCentered } = usePlayingRowLocate({ listRef, listItemHeight, playingRowIndex })

    const {
      handlePlayMusic,
      handlePlayMusicLater,
      doubleClickPlay,
    } = usePlay({ props, selectedList, list, removeAllSelect })

    const {
      isShowListAdd,
      isMove,
      isShowListAddMultiple,
      isMoveMultiple,
      selectedAddMusicInfo,
      handleShowMusicAddModal,
      handleShowMusicMoveModal,
    } = useMusicAdd({ selectedList, list })

    const {
      isShowDownload,
      isShowDownloadMultiple,
      selectedDownloadMusicInfo,
      handleShowDownloadModal,
    } = useMusicDownload({ selectedList, list })

    const {
      isShowMusicSortModal,
      selectedNum,
      selectedSortMusicInfo,
      handleShowSortModal,
      sortMusic,
    } = useSort({ props, list, selectedList, removeAllSelect })

    const {
      handleSearch,
      handleOpenMusicDetail,
      handleCopyName,
      handleDislikeMusic,
      handleRemoveMusic,
      canJumpToAlbum,
      canJumpToSinger,
      handleSingerNameClick,
      handleAlbumNameClick,
      handleJumpAlbum,
      handleJumpSinger,
      handleCopyLink,
      handleOpenInQqMusic,
      isShowSingerPicker,
      singerPickerXy,
      singerPickerMenus,
      handleSingerPickerClick,
    } = useMusicActions({ props, list, removeAllSelect, selectedList })

    const {
      menus,
      menuLocation,
      isShowItemMenu,
      showMenu,
      menuClick,
    } = useMenu({
      assertApiSupport,
      emit,
      selectedList,
      handleShowBatchEditModal,

      handleShowDownloadModal,
      handlePlayMusic,
      handlePlayMusicLater,
      handleSearch,
      handleShowMusicAddModal,
      handleShowMusicMoveModal,
      handleShowSortModal,
      handleOpenMusicDetail,
      handleCopyName,
      handleDislikeMusic,
      handleRemoveMusic,

      handleJumpAlbum,
      handleJumpSinger,
      handleCopyLink,
      handleOpenInQqMusic,
    })

    const {
      isShowSearchBar,
      searchList,
      handleMusicSearchAction,
    } = useSearch({
      setSelectedIndex,
      handlePlayMusic,
      listRef,
    })

    const { saveListPosition, restoreScroll } = useListScroll({ props, listRef, list, handleRestoreScroll, scrollToIndexCentered })


    const handleListItemClick = (event, index) => {
      if (rightClickSelectedIndex.value > -1) return
      handleSelectData(index)
      doubleClickPlay(index)
    }
    const handleListItemRightClick = (event, index) => {
      rightClickSelectedIndex.value = index
      showMenu(event, list.value[index], index)
    }
    const handleMenuClick = (action) => {
      let index = rightClickSelectedIndex.value
      rightClickSelectedIndex.value = -1
      // 第三参是行菜单的位置：多位歌手的「选择歌手」菜单要出现在同一个位置
      menuClick(action, index, menuLocation)
    }
    const handleListRightClick = (event) => {
      if (!event.target.classList.contains('select')) return
      event.stopImmediatePropagation()
      let classList = dom_listContent.value.classList
      classList.add('copying')
      window.requestAnimationFrame(() => {
        let str = window.getSelection().toString()
        classList.remove('copying')
        str = str.split(/\n\n/).map(s => s.replace(/\n/g, '  ')).join('\n').trim()
        if (!str.length) return
        clipboardWriteText(str)
      })
    }
    const handleListBtnClick = ({ action, index }) => {
      switch (action) {
        case 'download':
          handleShowDownloadModal(index, true)
          break
        case 'play':
          handlePlayMusic(index, true)
          break
        case 'search':
          handleSearch(index)
          break
        case 'listAdd':
          handleShowMusicAddModal(index, true)
          break
        case 'fav':
          // 一键切换「我喜欢」（加入 / 移除由当前状态决定，失败在 toggleFav 里弹提示）
          void toggleFav(list.value[index])
          break
      }
    }
    const scrollToTop = () => {
      listRef.value.scrollTo(0, true)
    }

    /**
     * 这一行是不是失效曲（无版权 / 已下架，工单 01）：置灰 + 悬停说明（原生 `title`）。
     * 登记表在 `core/music/unavailable.ts`（会话级、只在真播到过且取流结论不可播时才登记）；
     * 本地文件与下载任务从来不在表里（判定收在 `isUnavailableMusic` 一处），点播入口在
     * `usePlay` 里统一拦。
     */
    const isUnavailableRow = item => isUnavailableMusic(item)

    return {
      listItemHeight,
      handleListItemClick,
      isUnavailableRow,
      isMediaPathMissing,
      isShowBatchEdit,
      batchEditMusics,
      handleShowBatchEditModal,
      handleBatchEditDone,
      selectedList,
      handleListItemRightClick,
      removeAllSelect,
      handleListBtnClick,
      rightClickSelectedIndex,
      selectedIndex,
      dom_listContent,
      listRef,
      excludeListIds,

      menus,
      isShowItemMenu,
      menuLocation,
      handleMenuClick,

      handleListRightClick,
      assertApiSupport,
      // 来源列写的是显示名（别名/原名），不是 `tx` 这种内部值——见 store/index.ts:104 的注释
      getSourceName,

      isShowListAdd,
      isMove,
      isShowListAddMultiple,
      isMoveMultiple,
      selectedAddMusicInfo,

      isShowMusicSortModal,
      selectedNum,
      selectedSortMusicInfo,
      sortMusic,

      isShowDownload,
      isShowDownloadMultiple,
      selectedDownloadMusicInfo,

      scrollToTop,

      isShowSearchBar,
      searchList,
      handleMusicSearchAction,

      list,
      playingRowIndex,

      saveListPosition,
      isShowSource,
      handleRestoreScroll,

      actionButtonsVisible,

      canJumpToAlbum,
      canJumpToSinger,
      handleSingerNameClick,
      handleAlbumNameClick,
      isShowSingerPicker,
      singerPickerXy,
      singerPickerMenus,
      handleSingerPickerClick,
    }
  },
}
</script>


<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.list {
  overflow: hidden;
  height: 100%;
  flex: auto;
  display: flex;
  flex-flow: column nowrap;

  :global(.list-item) {
    &.active {
      color: var(--color-button-font);
    }
  }
  :global {
    .label-source {
      color: var(--color-primary);
      padding: 5px;
      font-size: .8em;
      line-height: 1.2;
      opacity: .75;
      display: inline-block;
      // 单元格是 flex 行且 white-space 被重置为 normal：不锁死的话，歌名一长
      // 标签会被 flex 压缩到逐字换行（CJK 最小内容宽 = 一个字，竖排）
      flex: none;
      white-space: nowrap;
    }
  }
}
.num {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
}
.playIcon {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;

  color: var(--color-button-font);
  opacity: .7;
}
.content {
  min-height: 0;
  font-size: 14px;
  display: flex;
  flex-flow: column nowrap;
  flex: auto;
}

.noItem {
  position: relative;
  height: 100%;
  display: flex;
  flex-flow: column nowrap;
  justify-content: center;
  align-items: center;

  p {
    font-size: 24px;
    color: var(--color-font-label);
  }
}

// 「我的收藏」的来源切换（base-tab 自带下划线指示器）现在在 views/Favorites/components/SongsPanel.vue

// 歌手名 / 专辑名可点（工单 02）：只加「可点」的提示，不改颜色（表格里颜色已经够花）
.jump {
  cursor: pointer;
  &:hover {
    text-decoration: underline;
  }
}

// 托管文件丢失徽标（票 06）：中性描边（仓库无 error 语义 token，不造红色），悬停看 tip
.missing-badge {
  flex: none;
  padding: 1px 6px;
  margin-left: 6px;
  border: 1px solid var(--color-primary-light-500);
  border-radius: 3px;
  font-size: 11px;
  color: var(--color-font-label);
}
</style>
