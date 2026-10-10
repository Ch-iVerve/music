<template>
  <div :class="$style.container">
    <div :class="$style.toolbar">
      <span :class="$style.count">{{ $t('playlists__library_count', { num: tracks.length }) }}</span>
      <base-btn :class="$style.importBtn" :disabled="importing" @click="handleImportFolder">{{ $t('playlists__import_folder') }}</base-btn>
    </div>

    <div v-if="!tracks.length" :class="$style.empty">{{ $t('playlists__library_empty') }}</div>
    <virtualized-list
      v-else
      ref="dom_list"
      :list="viewTracks"
      :item-height="48"
      key-name="id"
      :class="$style.list"
    >
      <template #default="{ item, index }">
        <div :class="$style.row" :data-index="index" @dblclick="handlePlay(index)">
          <span :class="$style.num">{{ index + 1 }}</span>
          <library-cover :media-path="item.filePath" />
          <span :class="$style.name" :title="item.name">{{ item.name }}</span>
          <span :class="$style.singer" :title="item.singer">{{ item.singer }}</span>
          <span :class="$style.album" :title="item.album">{{ item.album }}</span>
          <span :class="$style.interval">{{ item.interval }}</span>
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
import { playMusicList } from '@renderer/core/player/action'

/**
 * 「全部本地音乐」视图（票 03）：库聚合视图——曲目表 + 文件夹导入入口。
 *
 * - 数据 = 库全量（`localLibraryGetAll`）；导入完成（弹窗汇总出现）后自动重拉。
 * - 行 = 库曲目，媒体路径由 `filePath`（哈希命名托管副本）取封面、`buildLocalEntry` 转成可播条目；
 *   双击整行即从该曲开始播放（`playMusicList` 挂在库伪列表 id 下，下一首/上一首在库内顺序走）。
 * - 行内封面由 `LibraryCover` 自取（虚拟列表只挂可见行 → 按需读盘），卸载时统一 revoke。
 * - 失效标记 / 分组 / 右键（编辑、删除、加入歌单）属后续票（06/05/08），本视图先立骨架。
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
    const { visible: importVisible, finished: importFinished } = useLocalImportState()

    const importing = computed(() => importVisible.value && !importFinished.value)

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

    // 行 → 可播条目（spec D4 的引用形态；播放链路与歌单条目完全一致）
    const entries = computed(() => tracks.value.map(track => buildLocalEntry(track, mediaDir.value)))
    const handlePlay = (index) => {
      void playMusicList(LIST_IDS.LOCAL_LIBRARY, entries.value, index)
    }

    // 视图行：Track + 合成的托管路径（封面按它读；Track 本身不存路径——哈希即可推导）
    const viewTracks = computed(() => tracks.value.map(track => ({
      ...track,
      filePath: mediaDir.value ? `${mediaDir.value}/${track.id}.${track.ext}` : '',
    })))

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
      viewTracks,
      dom_list,
      importing,
      handlePlay,
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
  font-size: 13px;
  color: var(--color-font-label);
}

.import-btn {
  margin-left: auto;
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

.row {
  height: 48px;
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
