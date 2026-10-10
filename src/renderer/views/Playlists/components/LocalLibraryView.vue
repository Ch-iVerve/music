<template>
  <div :class="$style.container">
    <div :class="$style.toolbar">
      <span :class="$style.count">{{ $t('playlists__library_count', { num: tracks.length }) }}</span>
      <base-input
        v-model="query"
        :class="$style.search"
        type="text"
        :placeholder="$t('playlists__library_search')"
      />
      <base-btn :class="$style.importBtn" :disabled="importing" @click="handleImportFolder">{{ $t('playlists__import_folder') }}</base-btn>
    </div>

    <!-- 分组胶囊（票 05）：点谁按谁分组，「全部」=不分组；一次只激活一个 -->
    <div :class="$style.capsules">
      <button
        v-for="capsule in capsules"
        :key="`${capsule.dim}`"
        :class="[$style.capsule, { [$style.active]: dim == capsule.dim }]"
        :aria-pressed="dim == capsule.dim"
        @click="handleDimChange(capsule.dim)"
      >{{ capsule.label }}</button>
    </div>

    <div v-if="!rows.length" :class="$style.empty">{{ $t('playlists__library_empty') }}</div>
    <virtualized-list
      v-else
      ref="dom_list"
      :list="rows"
      :item-height="40"
      key-name="key"
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
        <div v-else :class="$style.row" :data-index="item.playIndex" @dblclick="handlePlay(item.playIndex)">
          <span :class="$style.num">{{ (item.playIndex ?? 0) + 1 }}</span>
          <library-cover :media-path="item.track.filePath" />
          <span :class="$style.name" :title="item.track.name">{{ item.track.name }}</span>
          <span :class="$style.singer" :title="item.track.singer">{{ item.track.singer }}</span>
          <span :class="$style.album" :title="item.track.album">{{ item.track.album }}</span>
          <span :class="$style.interval">{{ item.track.interval }}</span>
        </div>
      </template>
    </virtualized-list>
  </div>
</template>

<script>
import { computed, onBeforeUnmount, onMounted, ref, watch } from '@common/utils/vueTools'
import VirtualizedList from '@renderer/components/base/VirtualizedList.vue'
import LibraryCover from './LibraryCover.vue'
import { LIST_IDS } from '@common/constants'
import { getEnvParams, localLibraryGetAll, showSelectDialog } from '@renderer/utils/ipc'
import { buildLocalEntry, importFolderToNewList, useLocalImportState } from '@renderer/core/localLibrary'
import { revokeCoverUrls } from '@renderer/core/localLibrary/covers'
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
      tracks.value = await localLibraryGetAll()
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

    return {
      tracks,
      dom_list,
      query,
      dim,
      capsules,
      rows,
      importing,
      handlePlay,
      handleDimChange,
      handleToggleCollapse,
      handleImportFolder,
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
  gap: 12px;
  padding: 0 0 8px;
}

.count {
  flex: none;
  font-size: 13px;
  color: var(--color-font-label);
}

.search {
  flex: 1;
  max-width: 260px;
}

.import-btn {
  margin-left: auto;
}

.capsules {
  flex: none;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 0 0 10px;
}

.capsule {
  padding: 3px 12px;
  border: 1px solid var(--color-primary-light-500);
  border-radius: 999px;
  font-size: 12px;
  color: var(--color-font-label);
  background-color: transparent;
  cursor: pointer;

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
  height: 40px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 10px;
  font-size: 13px;
  cursor: default;

  &:hover {
    background-color: var(--color-primary-background);
  }
}

.num {
  flex: none;
  width: 28px;
  text-align: right;
  color: var(--color-font-label);
}

.name {
  flex: 1.4;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-font);
}

.singer,
.album {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-font-label);
}

.interval {
  flex: none;
  width: 44px;
  text-align: right;
  color: var(--color-font-label);
}
</style>
