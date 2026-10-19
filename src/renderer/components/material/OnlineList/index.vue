<template>
  <div :class="[$style.songList, { [$style.autoHeight]: autoHeight }]">
    <!-- <transition enter-active-class="animated-fast fadeIn" leave-active-class="animated-fast fadeOut"> -->
    <div :class="$style.list">
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
              <th class="nobreak" style="width: 24%;">{{ $t('music_singer') }}</th>
              <th class="nobreak" style="width: 27%;">{{ $t('music_album') }}</th>
              <th class="nobreak" style="width: 10%;">{{ $t('music_time') }}</th>
            </tr>
          </thead>
        </table>
      </div>
      <div :class="$style.content">
        <div v-show="!noItem" ref="dom_listContent" :class="$style.content">
          <base-virtualized-list v-if="actionButtonsVisible" ref="listRef" :auto-height="autoHeight" :list="list" key-name="id" :item-height="listItemHeight" container-class="scroll" content-class="list" @contextmenu.capture="handleListRightClick">
            <template #default="{ item, index }">
              <div
                class="list-item" :class="[{ [$style.active]: playingRowIndex === index }, { selected: rightClickSelectedIndex == index }, { active: selectedList.includes(item) }, { disabled: isUnavailableRow(item) }]"
                :title="isUnavailableRow(item) ? $t('list__unavailable_song') : null"
                @click="handleListItemClick($event, index)" @contextmenu="handleListItemRightClick($event, index)"
              >
                <div class="list-item-cell no-select num" :class="$style.num" style="flex: 0 0 5%;" @click.stop>
                  <!-- 正在播放那一行：序号换成播放图标（与本地歌曲表同一个标记，见 ListMusicTable/index.vue） -->
                  <transition name="play-active">
                    <div v-if="playingRowIndex === index" :class="$style.playIcon">
                      <svg version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" height="50%" viewBox="0 0 512 512" space="preserve">
                        <use xlink:href="#icon-play-outline" />
                      </svg>
                    </div>
                    <div v-else>{{ index + 1 }}</div>
                  </transition>
                </div>
                <div class="list-item-cell auto name">
                  <span class="select name" :aria-label="item.name">{{ item.name }}</span>
                  <span v-if="item.meta._qualitys.flac24bit" class="no-select badge badge-theme-primary">{{ $t('tag__lossless_24bit') }}</span>
                  <span v-else-if="item.meta._qualitys.ape || item.meta._qualitys.flac || item.meta._qualitys.wav" class="no-select badge badge-theme-primary">{{ $t('tag__lossless') }}</span>
                  <span v-else-if="item.meta._qualitys['320k']" class="no-select badge badge-theme-secondary">{{ $t('tag__high_quality') }}</span>
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
                  <material-list-buttons :index="index" :music-info="item" fav-btn :remove-btn="showRemoveBtn" :remove-label="removeLabel" :download-btn="assertApiSupport(item.source)" :play-btn="checkApiSource ? assertApiSupport(item.source) : true" @btn-click="handleListBtnClick" />
                </div>
              </div>
            </template>
            <template #footer>
              <div v-if="!autoHeight" :class="$style.pagination">
                <material-pagination :count="total" :limit="limit" :page="page" @btn-click="$emit('togglePage', $event)" />
              </div>
            </template>
          </base-virtualized-list>
          <base-virtualized-list v-else ref="listRef" :auto-height="autoHeight" :list="list" key-name="id" :item-height="listItemHeight" container-class="scroll" content-class="list" @contextmenu.capture="handleListRightClick">
            <template #default="{ item, index }">
              <div
                class="list-item" :class="[{ [$style.active]: playingRowIndex === index }, { selected: rightClickSelectedIndex == index }, { active: selectedList.includes(item) }, { disabled: isUnavailableRow(item) }]"
                :title="isUnavailableRow(item) ? $t('list__unavailable_song') : null"
                @click="handleListItemClick($event, index)" @contextmenu="handleListItemRightClick($event, index)"
              >
                <div class="list-item-cell no-select num" :class="$style.num" style="flex: 0 0 5%;" @click.stop>
                  <!-- 正在播放那一行：序号换成播放图标（与本地歌曲表同一个标记，见 ListMusicTable/index.vue） -->
                  <transition name="play-active">
                    <div v-if="playingRowIndex === index" :class="$style.playIcon">
                      <svg version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" height="50%" viewBox="0 0 512 512" space="preserve">
                        <use xlink:href="#icon-play-outline" />
                      </svg>
                    </div>
                    <div v-else>{{ index + 1 }}</div>
                  </transition>
                </div>
                <div class="list-item-cell auto name">
                  <span class="select name" :aria-label="item.name">{{ item.name }}</span>
                  <span v-if="item.meta._qualitys.flac24bit" class="no-select badge badge-theme-primary">{{ $t('tag__lossless_24bit') }}</span>
                  <span v-else-if="item.meta._qualitys.ape || item.meta._qualitys.flac || item.meta._qualitys.wav" class="no-select badge badge-theme-primary">{{ $t('tag__lossless') }}</span>
                  <span v-else-if="item.meta._qualitys['320k']" class="no-select badge badge-theme-secondary">{{ $t('tag__high_quality') }}</span>
                </div>
                <div class="list-item-cell" style="flex: 0 0 24%;">
                  <span
                    class="select" :class="{ [$style.jump]: canJumpToSinger(item) }"
                    :title="canJumpToSinger(item) ? $t('list__jump_singer') : $t('list__jump_singer_disabled')"
                    :aria-label="item.singer" @click.stop="handleSingerNameClick(item, $event)"
                  >{{ item.singer }}</span>
                </div>
                <div class="list-item-cell" style="flex: 0 0 27%;">
                  <span
                    class="select" :class="{ [$style.jump]: canJumpToAlbum(item) }"
                    :title="canJumpToAlbum(item) ? $t('list__jump_album') : $t('list__jump_album_disabled')"
                    :aria-label="item.meta.albumName" @click.stop="handleAlbumNameClick(item, $event)"
                  >{{ item.meta.albumName }}</span>
                </div>
                <div class="list-item-cell" style="flex: 0 0 10%;"><span class="no-select">{{ item.interval || '--/--' }}</span></div>
                <!-- 只有调用方显式要「移除」时才补这一格：QQ 我喜欢页要的是「取消喜欢」，
                     而它不能依赖「显示操作按钮」这个显示设置（默认关闭） -->
                <div v-if="showRemoveBtn" class="list-item-cell" style="flex: 0 0 6%; padding: 0;">
                  <material-list-buttons
                    :index="index" remove-btn :remove-label="removeLabel"
                    :download-btn="false" :play-btn="false" :list-add-btn="false"
                    @btn-click="handleListBtnClick"
                  />
                </div>
              </div>
            </template>
            <template #footer>
              <div v-if="!autoHeight" :class="$style.pagination">
                <material-pagination :count="total" :limit="limit" :page="page" @btn-click="$emit('togglePage', $event)" />
              </div>
            </template>
          </base-virtualized-list>
        </div>
        <transition enter-active-class="animated fadeIn" leave-active-class="animated fadeOut">
          <div v-show="noItem" :class="$style.noitem">
            <p v-text="noItem" />
          </div>
        </transition>
      </div>
    </div>
    <!-- </transition> -->
    <!-- <material-flow-btn :show="isShowEditBtn && assertApiSupport(source)" :remove-btn="false" @btn-click="handleFlowBtnClick" /> -->
    <!-- <common-download-modal v-model:show="isShowDownload" :music-info="selectedDownloadMusicInfo" teleport="#view" />
    <common-download-multiple-modal v-model:show="isShowDownloadMultiple" :list="selectedList" teleport="#view" @confirm="removeAllSelect" /> -->
    <common-list-add-modal v-model:show="isShowListAdd" :music-info="selectedAddMusicInfo" teleport="#view" />
    <common-list-add-multiple-modal v-model:show="isShowListAddMultiple" :music-list="selectedList" teleport="#view" @confirm="removeAllSelect" />
    <common-download-modal v-model:show="isShowDownload" :music-info="selectedDownloadMusicInfo" teleport="#view" />
    <common-download-multiple-modal v-model:show="isShowDownloadMultiple" :list="selectedList" teleport="#view" @confirm="removeAllSelect" />
    <base-menu v-model="isShowItemMenu" :menus="menus" :xy="menuLocation" item-name="name" @menu-click="handleMenuClick" />
    <!-- 多位歌手时让用户挑（工单 02）：用仓库既有的 base-menu，不自造弹窗 -->
    <base-menu v-model="isShowSingerPicker" :menus="singerPickerMenus()" :xy="singerPickerXy" item-name="name" @menu-click="handleSingerPickerClick" />
  </div>
</template>

<script>
import { clipboardWriteText } from '@common/utils/electron'
import { assertApiSupport } from '@renderer/store/utils'
import { computed, ref } from '@common/utils/vueTools'
import { playMusicInfo, playInfo } from '@renderer/store/player/state'
import { tempListMeta } from '@renderer/store/list/state'
import { LIST_IDS } from '@common/constants'
import { findPlayingRowIndex } from '@renderer/utils/playingRowLocate'
import usePlayingRowLocate from '@renderer/utils/compositions/usePlayingRowLocate'
import useList from './useList'
import useMenu from './useMenu'
import usePlay, { getQueueId } from './usePlay'
import useMusicDownload from './useMusicDownload'
import useMusicAdd from './useMusicAdd'
import useMusicActions from './useMusicActions'
import useFavSong from '@renderer/utils/compositions/useFavSong'
import { appSetting } from '@renderer/store/setting'
import { isUnavailableMusic } from '@renderer/core/music/unavailable'
export default {
  name: 'MaterialOnlineList',
  props: {
    list: {
      type: Array,
      default() {
        return []
      },
    },
    page: {
      type: Number,
      required: true,
    },
    limit: {
      type: Number,
      required: true,
    },
    total: {
      type: Number,
      required: true,
    },
    noItem: {
      type: String,
      default: '',
    },
    checkApiSource: {
      type: Boolean,
      default: false,
    },
    // 行内「移除」按钮：默认关闭（本地列表用它做移除，云端我喜欢用它做取消喜欢）
    showRemoveBtn: {
      type: Boolean,
      default: false,
    },
    removeLabel: {
      type: String,
      default: '',
    },
    // 播放队列的身份（ui-polish 工单 06）：宿主页传进来，与宿主自己那份 usePlay 用同一个值
    // （专辑 / 歌单 / 榜单 / 云端歌单有真实 id，搜索 / 新歌 / 收藏 / 歌手用自造的稳定标识，见各宿主）；
    // 不传则由 `usePlay.getQueueId` 兜底，见 usePlay.ts 的 handlePlayMusic
    listId: {
      type: String,
      default: '',
    },
    /**
     * 全量展开（2026-10-19 用户要求：专辑歌曲不分页、全部铺在页面里，不要内部滚动条）。
     * 置 true 时：不限高、一次渲染全部行、隐藏分页；高度由页面自己滚。
     * ⚠️ 没有虚拟化，行数几百时是拿性能换「不滚动」——只给确实需要全展开的页面用。
     */
    autoHeight: {
      type: Boolean,
      default: false,
    },
  },
  emits: ['show-menu', 'play-list', 'togglePage', 'remove-music'],
  setup(props, { emit }) {
    const actionButtonsVisible = appSetting['list.actionButtonsVisible']
    const rightClickSelectedIndex = ref(-1)
    const dom_listContent = ref(null)
    const listRef = ref(null)

    // 「我喜欢」的一键开关（工单 06）：行内的心形键点它就切换（右键菜单那份在 useMenu 里，
    // 但两处共用 `useFavSong` 的同一份文案与动作）
    const { toggleFav, loadFavState } = useFavSong()
    // 行内键要显示收藏态，所以列表一挂载就把它拉回来（store 里缓存，一次会话只真拉一次）。
    // 只在开着操作键时拉：关着的时候行内根本没有这个键，白拉一次请求
    if (actionButtonsVisible) loadFavState()

    const {
      selectedList,
      listItemHeight,
      handleSelectData,
      removeAllSelect,
    } = useList({ props, listRef })

    /**
     * 正在播放那首歌在本列表里的行号（不在本列表里是 -1）——行内高亮与播放栏的
     * 「定位到正在播放」都认它（判定在 `utils/playingRowLocate.ts`）。
     *
     * ⚠️ 队列身份要认 `tempListMeta.id`，**不是** `playMusicInfo.listId`：在线队列一律灌进临时列表
     * 播放，`playMusicList` 把 `playMusicInfo.listId` 置为 `temp`（`core/player/action.ts`），
     * 真正的「播的是哪个列表」记在 `tempListMeta.id` 上（同「雷达」「歌单详情」的判法）。
     * 没传 `listId` 的宿主页共用 `ONLINE_LIST_FALLBACK_QUEUE_ID`（`utils/queueIds`）这个兜底身份，
     * 光比身份不够，`findPlayingRowIndex` 还会按歌 id 认一遍行。
     */
    const playingRowIndex = computed(() => findPlayingRowIndex({
      list: props.list,
      isPlayingList: playInfo.playerListId == LIST_IDS.TEMP && tempListMeta.id == getQueueId(props.listId),
      playIndex: playInfo.playIndex,
      playingMusicId: playMusicInfo.musicInfo?.id,
    }))
    usePlayingRowLocate({ listRef, listItemHeight, playingRowIndex })

    const {
      handlePlayMusic,
      handlePlayMusicLater,
      doubleClickPlay,
    } = usePlay({ selectedList, props, removeAllSelect, emit })

    const {
      isShowListAdd,
      isShowListAddMultiple,
      selectedAddMusicInfo,
      handleShowMusicAddModal,
    } = useMusicAdd({ selectedList, props })

    const {
      isShowDownload,
      isShowDownloadMultiple,
      selectedDownloadMusicInfo,
      handleShowDownloadModal,
    } = useMusicDownload({ selectedList, props })

    const {
      handleSearch,
      handleOpenMusicDetail,
      handleDislikeMusic,
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
    } = useMusicActions({ props })

    const {
      menus,
      menuLocation,
      isShowItemMenu,
      showMenu,
      menuClick,
    } = useMenu({
      props,
      assertApiSupport,
      emit,

      handleShowDownloadModal,
      handlePlayMusic,
      handlePlayMusicLater,
      handleSearch,
      handleShowMusicAddModal,
      handleOpenMusicDetail,
      handleDislikeMusic,

      handleJumpAlbum,
      handleJumpSinger,
      handleCopyLink,
      handleOpenInQqMusic,
    })

    const handleListItemClick = (event, index) => {
      if (rightClickSelectedIndex.value > -1) return
      handleSelectData(index)
      doubleClickPlay(index)
    }
    const handleListItemRightClick = (event, index) => {
      rightClickSelectedIndex.value = index
      showMenu(event, props.list[index], index)
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
          void handlePlayMusic(index, true)
          break
        case 'search':
          handleSearch(index)
          break
        case 'listAdd':
          handleShowMusicAddModal(index, true)
          break
        case 'fav':
          // 一键切换「我喜欢」（加入 / 移除由当前状态决定，失败在 toggleFav 里弹提示）
          void toggleFav(props.list[index])
          break
        case 'remove':
          // 由调用方决定「移除」的含义（本地列表移除 / QQ 我喜欢取消喜欢）
          emit('remove-music', index)
          break
      }
    }
    const scrollToTop = () => {
      listRef.value.scrollTo(0, true)
    }

    /**
     * 这一行是不是失效曲（无版权 / 已下架，工单 01）：置灰 + 悬停说明（原生 `title`）。
     * 登记表在 `core/music/unavailable.ts`（会话级、只在真播到过且取流结论不可播时才登记），
     * 点播入口在 `usePlay` 里统一拦——本地文件不走这条路，永远不算失效。
     */
    const isUnavailableRow = item => isUnavailableMusic(item)

    return {
      listItemHeight,
      playingRowIndex,
      isUnavailableRow,
      handleListItemClick,
      selectedList,
      handleListItemRightClick,
      removeAllSelect,
      handleListBtnClick,
      rightClickSelectedIndex,
      dom_listContent,
      listRef,

      menus,
      isShowItemMenu,
      menuLocation,
      handleMenuClick,

      handleListRightClick,
      assertApiSupport,

      isShowListAdd,
      isShowListAddMultiple,
      selectedAddMusicInfo,

      isShowDownload,
      isShowDownloadMultiple,
      selectedDownloadMusicInfo,

      scrollToTop,
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
.songList {
  overflow: hidden;
  height: 100%;
  display: flex;
  flex-flow: column nowrap;
  position: relative;
}
// 全量展开（专辑页歌曲列表）：不占固定高、不出内部滚动条，所有行铺开，页面自己滚
.songList.autoHeight {
  height: auto;
  overflow: visible;

  .list {
    position: static;
    height: auto;
  }

  .content {
    flex: none;
    height: auto;
    min-height: 0;
  }
}

.list {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  display: flex;
  flex-flow: column nowrap;
  font-size: 14px;

  // 正在播放那一行的字色（与本地歌曲表同一套：判定见 utils/playingRowLocate.ts）
  :global(.list-item) {
    &.active {
      color: var(--color-button-font);
    }
  }
}

// 序号格里的「正在播放」图标（与 ListMusicTable/index.vue 的 `.num` / `.playIcon` 同构）
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
  flex: auto;
  min-height: 0;
  position: relative;
  height: 100%;
}

.pagination {
  text-align: center;
  padding: 15px 0;
  // left: 50%;
  // transform: translateX(-50%);
}
.noitem {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  width: 100%;
  display: flex;
  flex-flow: column nowrap;
  justify-content: center;
  align-items: center;
  // background-color: var(--color-000);

  p {
    font-size: 24px;
    color: var(--color-font-label);
  }
}

// 歌手名 / 专辑名可点（工单 02）：只加「可点」的提示，不改颜色（表格里颜色已经够花）
.jump {
  cursor: pointer;
  &:hover {
    text-decoration: underline;
  }
}

</style>
