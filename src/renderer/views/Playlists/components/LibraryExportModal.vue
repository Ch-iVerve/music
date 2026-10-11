<template>
  <material-modal :show="show" teleport="#view" width="50%" @close="handleClose">
    <main :class="$style.main">
      <!-- 标题带曲目数：库视图入口导出的是「选中的 N 首」而非整表（体验走查 2026-10-11），歌单入口的 N 也属实 -->
      <h2 :class="$style.title">{{ $t('playlists__export_title_count', { name: listInfo?.name ?? '', num: musics.length }) }}</h2>

      <template v-if="!finished">
        <div :class="$style.row">
          <span :class="$style.label">{{ $t('playlists__export_dir') }}</span>
          <span :class="$style.dir" :title="targetDir">{{ targetDir || $t('playlists__export_pick_dir') }}</span>
          <base-btn min @click="handlePickDir">{{ $t('playlists__export_pick') }}</base-btn>
        </div>

        <label :class="$style.check" @click.prevent="options.json = !options.json">
          <base-checkbox id="export__json" :model-value="options.json" :label="''" @update:model-value="() => {}" />
          <span>{{ $t('playlists__export_json') }}</span>
        </label>
        <label :class="$style.check" @click.prevent="options.m3u8 = !options.m3u8">
          <base-checkbox id="export__m3u8" :model-value="options.m3u8" :label="''" @update:model-value="() => {}" />
          <span>{{ $t('playlists__export_m3u8') }}</span>
        </label>
        <label :class="$style.check" @click.prevent="options.copyFiles = !options.copyFiles">
          <base-checkbox id="export__copy" :model-value="options.copyFiles" :label="''" @update:model-value="() => {}" />
          <span>{{ $t('playlists__export_copy') }}</span>
        </label>

        <p v-if="running" :class="$style.progress">{{ $t('playlists__batch_edit_progress', { done: progress.done, total: progress.total }) }}</p>
        <div :class="$style.footer">
          <base-btn :disabled="running || !targetDir" @click="handleRun">{{ $t('playlists__export_run') }}</base-btn>
          <base-btn @click="handleClose">{{ $t('playlists__edit_cancel') }}</base-btn>
        </div>
      </template>
      <template v-else>
        <p :class="$style.summary">{{ $t('playlists__export_done', { copied: result.copied, missing: result.skipped.length, failed: result.skipped.filter(s => s.includes('复制失败')).length }) }}</p>
        <ul class="scroll" :class="$style.skipped">
          <li v-for="s in result.skipped" :key="s" :class="$style.skippedItem">{{ s }}</li>
        </ul>
        <div :class="$style.footer">
          <base-btn @click="handleClose">{{ $t('playlists__rescan_close') }}</base-btn>
        </div>
      </template>
    </main>
  </material-modal>
</template>

<script>
import { ref, watch } from '@common/utils/vueTools'
import { showSelectDialog } from '@renderer/utils/ipc'
import { exportListAsPackage } from '@renderer/core/localLibrary/export'

/**
 * 导出向导（票 11，spec D8）：三选勾（JSON / m3u8 / 复制文件）+ 目标目录，一次导出。
 * 至少勾一项才能执行；失效/在线条目跳过并进汇总。
 */
export default {
  name: 'LibraryExportModal',
  props: {
    show: {
      type: Boolean,
      default: false,
    },
    listInfo: {
      type: Object,
      default: null,
    },
    musics: {
      type: Array,
      default: () => [],
    },
  },
  emits: ['close'],
  setup(props, { emit }) {
    const targetDir = ref('')
    const options = ref({ json: true, m3u8: true, copyFiles: false })
    const running = ref(false)
    const finished = ref(false)
    const progress = ref({ total: 0, done: 0, current: '' })
    const result = ref({ copied: 0, skipped: [], written: [] })

    watch(() => props.show, (show) => {
      if (show) {
        targetDir.value = ''
        options.value = { json: true, m3u8: true, copyFiles: false }
        running.value = false
        finished.value = false
        result.value = { copied: 0, skipped: [], written: [] }
      }
    })

    const handlePickDir = async() => {
      const { canceled, filePaths } = await showSelectDialog({
        title: window.i18n.t('playlists__export_pick'),
        properties: ['openDirectory'],
      })
      if (canceled || !filePaths?.length) return
      targetDir.value = filePaths[0]
    }

    const handleClose = () => {
      if (!running.value) emit('close', true)
    }

    const handleRun = async() => {
      if (!props.listInfo) return
      running.value = true
      try {
        result.value = await exportListAsPackage(props.listInfo, props.musics, targetDir.value, {
          json: options.value.json,
          m3u8: options.value.m3u8,
          copyFiles: options.value.copyFiles,
        }, (p) => {
          progress.value = p
        })
        finished.value = true
      } catch (err) {
        console.log('[localLibrary.export] 导出失败:', err)
        result.value.skipped.push(String(err))
        finished.value = true
      } finally {
        running.value = false
      }
    }

    return {
      targetDir,
      options,
      running,
      finished,
      progress,
      result,
      handlePickDir,
      handleClose,
      handleRun,
    }
  },
}
</script>

<style lang="less" module>
.main {
  padding: 15px 20px;
}

.title {
  margin: 0 0 12px;
  font-size: 15px;
  color: var(--color-font);
}

.row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}

.label {
  flex: none;
  font-size: 13px;
  color: var(--color-font-label);
}

.dir {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  color: var(--color-font);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.check {
  display: block;
  margin-bottom: 8px;
}

.progress,
.summary {
  margin: 10px 0;
  font-size: 13px;
  color: var(--color-font);
}

.skipped {
  max-height: 140px;
  font-size: 12px;
  color: var(--color-font-label);
}

.skipped-item {
  line-height: 1.6;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.footer {
  margin-top: 12px;
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
</style>
