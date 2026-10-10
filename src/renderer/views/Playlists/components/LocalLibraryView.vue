<template>
  <div :class="$style.container">
    <div :class="$style.toolbar">
      <base-input
        v-model="query"
        :class="$style.search"
        type="text"
        :placeholder="$t('playlists__library_search')"
      />
      <!-- 分组胶囊与搜索同行（票 13）：胶囊可横向滚动，右侧动作常驻 -->
      <div :class="$style.capsules">
        <button
          v-for="capsule in capsules"
          :key="`${capsule.dim}`"
          :class="[$style.capsule, { [$style.active]: dim == capsule.dim }]"
          :aria-pressed="dim == capsule.dim"
          @click="handleDimChange(capsule.dim)"
        >{{ capsule.label }}</button>
      </div>
      <span :class="$style.count">{{ $t('playlists__library_count', { num: tracks.length }) }}</span>
      <base-btn min :disabled="importing" @click="handleRescan">{{ $t('playlists__rescan') }}</base-btn>
      <base-btn :class="$style.importBtn" :disabled="importing" @click="handleImportFolder">{{ $t('playlists__import_folder') }}</base-btn>
    </div>

    <div v-if="!rows.length" :class="$style.empty">{{ $t('playlists__library_empty') }}</div>
    <virtualized-list
      v-else
      ref="dom_list"
      :list="rows"
      :item-height="44"
      key-name="key"
      container-class="scroll"
      :class="$style.list"
    >
      <template #default="{ item }">
        <!-- 组头行：点击折叠/展开 -->
        <button
          v-if="item.type == 'header'"
          :class="$style.header"
          :aria-expanded="!item.collapsed"
          @click="handleToggleCollapse(item.key)"
        >
          <svg-icon name="angle-right-solid" :class="[$style.headerIcon, { [$style.expanded]: !item.collapsed }]" />
          <span :class="$style.headerLabel" :title="item.label">{{ item.label }}</span>
          <span :class="$style.headerCount">{{ item.count }}</span>
        </button>
        <!-- 曲目行 -->
        <div
          v-else
          :class="[$style.row, { [$style.missing]: isMediaPathMissing(item.track.filePath) }]"
          :data-index="item.playIndex"
          :title="isMediaPathMissing(item.track.filePath) ? $t('playlists__missing_file_tip') : null"
          @dblclick="handlePlay(item.playIndex)"
          @contextmenu.prevent="handleRowContextmenu($event, item.track)"
        >
          <span :class="$style.num">{{ (item.playIndex ?? 0) + 1 }}</span>
          <library-cover :media-path="item.track.filePath" />
          <span :class="$style.name" :title="item.track.name">{{ item.track.name }}</span>
          <span v-if="isMediaPathMissing(item.track.filePath)" :class="$style.missingBadge">{{ $t('playlists__missing_file') }}</span>
          <span :class="$style.singer" :title="item.track.singer">{{ item.track.singer }}</span>
          <span :class="$style.album" :title="item.track.album">{{ item.track.album }}</span>
          <span :class="$style.interval">{{ item.track.interval }}</span>
          <!-- 行尾浮现动作（票 13）：播放 / 编辑信息 -->
          <span :class="$style.rowActions">
            <button :class="$style.rowActionBtn" :aria-label="$t('list__play')" :title="$t('list__play')" @click.stop="handlePlay(item.playIndex)">
              <svg-icon name="play-outline" :class="$style.rowActionIcon" />
            </button>
            <button :class="$style.rowActionBtn" :aria-label="$t('playlists__edit_title')" :title="$t('playlists__edit_title')" @click.stop="handleEdit(item.track)">
              <svg-icon name="tune-variant" :class="$style.rowActionIcon" />
            </button>
          </span>
        </div>
      </template>
    </virtualized-list>

    <!-- 行右键菜单：播放 / 编辑信息（失效标记、删除等更多项在后续票接入同一菜单） -->
    <base-menu v-model="isShowItemMenu" :menus="itemMenus" :xy="itemMenuLocation" item-name="name" @menu-click="handleItemMenuClick" />
    <library-edit-modal :show="showEdit" :track="editTrack" @close="showEdit = false" @saved="load" @edit-lyrics="handleOpenLyric" />
    <library-lyric-modal :show="showLyric" :track="lyricTrack" @close="showLyric = false" @saved="load" />

    <library-rescan-modal :show="showRescan" :report="rescanReport" @close="showRescan = false" @changed="handleRescanChanged" />
  </div>
</template>

<script>
import { computed, onBeforeUnmount, onMounted, ref, watch } from '@common/utils/vueTools'
import VirtualizedList from '@renderer/components/base/VirtualizedList.vue'
import LibraryCover from './LibraryCover.vue'
import LibraryRescanModal from './LibraryRescanModal.vue'
import LibraryEditModal from './LibraryEditModal.vue'
import LibraryLyricModal from './LibraryLyricModal.vue'
import { LIST_IDS } from '@common/constants'
import { getEnvParams, localLibraryGetAll, showSelectDialog } from '@renderer/utils/ipc'
import {
  autoCleanJunk,
  buildLocalEntry,
  importFolderToNewList,
  reconcileLibrary,
  useLocalImportState,
} from '@renderer/core/localLibrary'
import { revokeCoverUrls } from '@renderer/core/localLibrary/covers'
import { checkAvailability, isMediaPathMissing } from '@renderer/core/localLibrary/availability'
import { groupLibraryTracks, filterLibraryTracks } from '@renderer/core/localLibrary/grouping'
import { playMusicList } from '@renderer/core/player/action'

/**
 * 「全部本地音乐」视图（票 03 立骨架；票 05 加搜索与分组胶囊）。
 *
 * - 数据 = 库全量（`localLibraryGetAll`）；导入完成（弹窗汇总出现）后自动重拉。
 * - 搜索：歌名/歌手/专辑子串过滤；分组胶囊：不分组 + 全量 tag 字段（spec D17），
 *   纯函数在 `core/localLibrary/grouping`（有单测），本组件只持三个状态：query / dim / 折叠组。
 * - 行 = 扁平序列（组头行 + 曲目行，统一行高交给虚拟列表）；双击曲目行在**当前可见顺序**里播放；
 *   组头点击折叠/展开（切维度清空折叠态）。
 * - 行内封面由 `LibraryCover` 自取（可见行才挂载 → 按需读盘），卸载时统一 revoke。
 * - 失效标记 / 右键（编辑、删除、加入歌单）属后续票（06/08），本视图先立骨架。
 */
export default {
  name: 'LocalLibraryView',
  components: {
    VirtualizedList,
    LibraryCover,
    LibraryRescanModal,
    LibraryEditModal,
    LibraryLyricModal,
  },
  setup() {
    const tracks = ref([])
    const mediaDir = ref('')
    const dom_list = ref(null)
    const query = ref('')
    const dim = ref(null)
    const collapsedKeys = ref(new Set())
    const { visible: importVisible, finished: importFinished } = useLocalImportState()

    const importing = computed(() => importVisible.value && !importFinished.value)

    // 维度切换清空折叠态：上一组维度的折叠键对新维度没有意义
    watch(dim, () => {
      collapsedKeys.value = new Set()
    })

    const handleToggleCollapse = (key) => {
      const next = new Set(collapsedKeys.value)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      collapsedKeys.value = next
    }

    // 视图行：Track + 合成的托管路径（封面按它读；Track 本身不存路径——哈希即可推导）
    const viewTracks = computed(() => tracks.value.map(track => ({
      ...track,
      filePath: mediaDir.value ? `${mediaDir.value}/${track.id}.${track.ext}` : '',
    })))

    const capsules = computed(() => ([
      { dim: null, label: window.i18n.t('playlists__group_none') },
      { dim: 'singer', label: window.i18n.t('playlists__group_singer') },
      { dim: 'album', label: window.i18n.t('playlists__group_album') },
      { dim: 'genre', label: window.i18n.t('playlists__group_genre') },
      { dim: 'year', label: window.i18n.t('playlists__group_year') },
      { dim: 'trackNum', label: window.i18n.t('playlists__group_track_num') },
      { dim: 'discNum', label: window.i18n.t('playlists__group_disc_num') },
      { dim: 'ext', label: window.i18n.t('playlists__group_ext') },
    ]))
    const handleDimChange = (value) => {
      dim.value = value
    }

    const rows = computed(() => groupLibraryTracks(
      viewTracks.value,
      dim.value,
      query.value,
      collapsedKeys.value,
      window.i18n.t('playlists__group_unknown'),
    ))
    // 双击播放 = 在**当前过滤可见序**里播（与所见一致，而不是库里隐藏的顺序）
    const playEntries = computed(() => filterLibraryTracks(viewTracks.value, query.value)
      .map(track => buildLocalEntry(track, mediaDir.value)))
    const handlePlay = (playIndex) => {
      void playMusicList(LIST_IDS.LOCAL_LIBRARY, playEntries.value, playIndex)
    }

    const load = async() => {
      // 垃圾条目自动清（票 14）：静默移除 macOS `._*` 误导入的噪声（记录+歌单引用+垃圾副本），
      // 再拉全量——用户永远看不到垃圾行
      await autoCleanJunk().catch(err => { console.log('[localLibrary] 垃圾清理失败:', err) })
      tracks.value = await localLibraryGetAll()
      // 失效核对（票 06）：打开库即异步核对，标记是响应式的（scoped slot 追踪），丢了会在行上出现徽标
      void checkAvailability(tracks.value.map(track => `${mediaDir.value}/${track.id}.${track.ext}`))
    }
    onMounted(async() => {
      mediaDir.value = (await getEnvParams()).mediaDir
      await load()
    })
    // 导入完成（弹窗出现汇总）即重拉；进行中不拉（进度走弹窗，不闪列表）
    watch(importFinished, (summary) => {
      if (summary) void load()
    })
    onBeforeUnmount(() => {
      revokeCoverUrls()
    })

    const handleImportFolder = async() => {
      const { canceled, filePaths } = await showSelectDialog({
        title: window.i18n.t('playlists__import_folder'),
        properties: ['openDirectory'],
      })
      if (canceled || !filePaths?.length) return
      await importFolderToNewList(filePaths[0])
    }

    // 重扫描对账（票 07）：按钮 → 报告弹窗；弹窗内处置完成（changed）→ 重拉库 + 刷新报告
    const showRescan = ref(false)
    const rescanReport = ref(null)
    const handleRescan = async() => {
      showRescan.value = true
      rescanReport.value = await reconcileLibrary()
    }
    const handleRescanChanged = async() => {
      await load()
      rescanReport.value = await reconcileLibrary()
    }

    // 行右键菜单（票 08）：播放 / 编辑信息
    const isShowItemMenu = ref(false)
    const itemMenuLocation = ref({ x: 0, y: 0 })
    const editTrack = ref(null)
    const showEdit = ref(false)
    const itemMenus = computed(() => ([
      { name: window.i18n.t('list__play'), action: 'play' },
      { name: window.i18n.t('playlists__edit_title'), action: 'edit' },
    ]))
    const handleRowContextmenu = (event, track) => {
      itemMenuLocation.value = { x: event.clientX, y: event.clientY }
      editTrack.value = track
      isShowItemMenu.value = true
    }
    const handleItemMenuClick = (action) => {
      if (action == 'play') {
        const row = rows.value.find(row => row.type == 'track' && row.key == editTrack.value?.id)
        if (row) handlePlay(row.playIndex)
        return
      }
      if (action == 'edit') showEdit.value = true
    }

    // 行尾浮现的「编辑」快捷键（票 13）：与右键菜单的编辑同一弹窗
    const handleEdit = (track) => {
      editTrack.value = track
      showEdit.value = true
    }

    // 歌词编辑器（票 09）：从信息编辑弹窗跳入；保存后重拉列表（hasLyric/size 变化）
    const showLyric = ref(false)
    const lyricTrack = ref(null)
    const handleOpenLyric = () => {
      lyricTrack.value = editTrack.value
      showEdit.value = false
      showLyric.value = true
    }

    return {
      tracks,
      viewTracks,
      dom_list,
      query,
      dim,
      capsules,
      rows,
      importing,
      isMediaPathMissing,
      handleEdit,
      showRescan,
      rescanReport,
      isShowItemMenu,
      itemMenuLocation,
      itemMenus,
      editTrack,
      showEdit,
      showLyric,
      lyricTrack,
      handleOpenLyric,
      handleRowContextmenu,
      handleItemMenuClick,
      load,
      handlePlay,
      handleDimChange,
      handleToggleCollapse,
      handleImportFolder,
      handleRescan,
      handleRescanChanged,
    }
  },
}
</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.container {
  height: 100%;
  display: flex;
  flex-flow: column nowrap;
  min-width: 0;
}

.toolbar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 0 8px;
}

.count {
  flex: none;
  font-size: 12px;
  color: var(--color-font-label);
  font-variant-numeric: tabular-nums;
}

.search {
  flex: none;
  width: 200px;
}

.capsules {
  flex: 1;
  min-width: 0;
  display: flex;
  gap: 6px;
  overflow-x: auto;
  scrollbar-width: none;

  &::-webkit-scrollbar {
    display: none;
  }
}

.capsule {
  flex: none;
  padding: 3px 12px;
  border: 1px solid var(--color-primary-light-500);
  border-radius: 999px;
  font-size: 12px;
  color: var(--color-font-label);
  background-color: transparent;
  cursor: pointer;
  white-space: nowrap;

  &:hover {
    color: var(--color-font);
  }

  &.active {
    color: var(--color-theme);
    border-color: var(--color-theme);
    background-color: var(--color-primary-background);
  }
}

.empty {
  flex: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  color: var(--color-font-label);
}

.list {
  flex: auto;
  min-height: 0;
  // 右侧留出滚动带，时长/操作钮不被滚动条压住
  padding-right: 8px;
}

.header {
  height: 40px;
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  font-size: 13px;
  font-weight: bold;
  color: var(--color-font);
  background-color: var(--color-primary-background);
  border: none;
  cursor: pointer;
  text-align: left;
}

.header-icon {
  width: 12px;
  height: 12px;
  transition: transform @transition-normal;

  &.expanded {
    transform: rotate(90deg);
  }
}

.header-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.header-count {
  flex: none;
  color: var(--color-font-label);
  font-weight: normal;
}

.row {
  height: 44px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 10px;
  cursor: default;

  &:hover {
    background-color: var(--color-primary-background);

    .row-actions {
      opacity: 1;
    }
  }
}

.row-actions {
  flex: none;
  display: flex;
  gap: 2px;
  opacity: 0;
  transition: opacity @transition-normal;
}

.row-action-btn {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: @radius-border;
  background-color: transparent;
  color: var(--color-font-label);
  cursor: pointer;

  &:hover {
    color: var(--color-theme);
    background-color: var(--color-primary-background-hover);
  }
}

.row-action-icon {
  width: 14px;
  height: 14px;
}

.num {
  flex: none;
  width: 28px;
  text-align: right;
  font-size: 12px;
  color: var(--color-font-label);
  font-variant-numeric: tabular-nums;
}

.name {
  flex: 1.4;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  color: var(--color-font);
}

.singer,
.album {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--color-font-label);
}

.interval {
  flex: none;
  width: 44px;
  text-align: right;
  font-size: 12px;
  color: var(--color-font-label);
  font-variant-numeric: tabular-nums;
}

.missing {
  .name,
  .singer,
  .album {
    opacity: 0.5;
  }
}

.missing-badge {
  flex: none;
  padding: 1px 6px;
  border: 1px solid var(--color-primary-light-500);
  border-radius: 3px;
  font-size: 11px;
  color: var(--color-font-label);
}
</style>
