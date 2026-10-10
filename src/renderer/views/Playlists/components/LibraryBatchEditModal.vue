<template>
  <material-modal :show="show" teleport="#view" width="50%" @close="handleClose">
    <main :class="$style.main">
      <h2 :class="$style.title">{{ $t('playlists__batch_edit') }}</h2>
      <p :class="$style.tip">{{ $t('playlists__batch_edit_tip') }}</p>
      <p v-if="skipNum > 0" :class="$style.skip">{{ $t('playlists__batch_edit_skip', { num: skipNum }) }}</p>

      <template v-if="!finished">
        <div :class="$style.form">
          <label :class="$style.field">
            <span :class="$style.label">{{ $t('playlists__edit_singer') }}</span>
            <base-input v-model="form.singer" :class="$style.input" type="text" :placeholder="'—'" />
          </label>
          <label :class="$style.field">
            <span :class="$style.label">{{ $t('playlists__edit_album') }}</span>
            <base-input v-model="form.album" :class="$style.input" type="text" :placeholder="'—'" />
          </label>
          <label :class="$style.field">
            <span :class="$style.label">{{ $t('playlists__edit_genre') }}</span>
            <base-input v-model="form.genre" :class="$style.input" type="text" :placeholder="'—'" />
          </label>
          <label :class="$style.field">
            <span :class="$style.label">{{ $t('playlists__edit_year') }}</span>
            <base-input v-model="form.year" :class="$style.input" type="text" :placeholder="'—'" />
          </label>
        </div>
        <p :class="$style.progress">{{ $t('playlists__batch_edit_progress', { done, total }) }}</p>
        <div :class="$style.footer">
          <base-btn :disabled="running || done >= total" @click="handleStart">{{ $t('playlists__edit_save') }}</base-btn>
          <base-btn @click="handleClose">{{ $t('playlists__edit_cancel') }}</base-btn>
        </div>
      </template>
      <template v-else>
        <p :class="$style.summary">{{ $t('playlists__batch_edit_summary', { ok: result.ok, fail: result.failed.length }) }}</p>
        <p v-if="result.failed.length" :class="$style.failed">{{ $t('playlists__batch_edit_failed_list', { names: result.failed.join('、') }) }}</p>
        <div :class="$style.footer">
          <base-btn @click="handleClose">{{ $t('playlists__rescan_close') }}</base-btn>
        </div>
      </template>
    </main>
  </material-modal>
</template>

<script>
import { computed, ref, watch } from '@common/utils/vueTools'
import { localLibraryGetByIds } from '@renderer/utils/ipc'
import { saveTrackEdits } from '@renderer/core/localLibrary'

/**
 * 批量编辑（票 10）：只改**填写了**的字段，留空不动；逐首走与单首相同的保存管线
 * （写托管副本 tag → 库行+引用歌单行同事务）。在线歌与旧式直读条目（无 trackId）跳过并在
 * 弹窗里说明；每首写完立即落盘（部分失败不影响已完成的首）。
 */
export default {
  name: 'LibraryBatchEditModal',
  props: {
    show: {
      type: Boolean,
      default: false,
    },
    /** 选中的本地条目（MusicInfoLocal）；在线歌/旧条目将被跳过 */
    musics: {
      type: Array,
      default: () => [],
    },
  },
  emits: ['close', 'done'],
  setup(props, { emit }) {
    const form = ref({ singer: '', album: '', genre: '', year: '' })
    const running = ref(false)
    const done = ref(0)
    const total = ref(0)
    const finished = ref(false)
    const result = ref({ ok: 0, failed: [] })

    const skipNum = computed(() => props.musics.filter(m => m.source != 'local' || !m.meta.trackId).length)

    const reset = () => {
      form.value = { singer: '', album: '', genre: '', year: '' }
      running.value = false
      done.value = 0
      total.value = 0
      finished.value = false
      result.value = { ok: 0, failed: [] }
    }
    watch(() => props.show, (show) => {
      if (show) reset()
    })

    const buildEdits = () => {
      const edits = {}
      if (form.value.singer !== '') edits.singer = form.value.singer
      if (form.value.album !== '') edits.album = form.value.album
      if (form.value.genre !== '') edits.genre = form.value.genre
      if (form.value.year !== '') edits.year = form.value.year
      return edits
    }

    const handleClose = () => {
      if (finished.value && result.value.ok > 0) emit('done')
      emit('close', true)
    }

    const handleStart = async() => {
      const edits = buildEdits()
      if (!Object.keys(edits).length) return
      const targets = props.musics.filter(m => m.source == 'local' && m.meta.trackId)
      total.value = targets.length
      running.value = true
      const failed = []
      for (const music of targets) {
        try {
          const [track] = await localLibraryGetByIds([music.meta.trackId])
          if (!track) throw new Error('track not found')
          await saveTrackEdits(track, edits, null)
          result.value.ok++
        } catch (err) {
          console.log('[localLibrary.batchEdit] 失败:', music.name, err)
          failed.push(music.name)
        }
        done.value++
      }
      result.value.failed = failed
      running.value = false
      finished.value = true
    }

    return {
      form,
      running,
      done,
      total,
      finished,
      result,
      skipNum,
      handleStart,
      handleClose,
    }
  },
}
</script>

<style lang="less" module>
.main {
  padding: 15px 20px;
}

.title {
  margin: 0 0 8px;
  font-size: 15px;
  color: var(--color-font);
}

.tip,
.skip,
.progress,
.summary,
.failed {
  margin: 0 0 10px;
  font-size: 12px;
  color: var(--color-font-label);
}

.skip {
  color: var(--color-theme);
}

.form {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 14px;
  margin-bottom: 10px;
}

.field {
  flex: 1 1 40%;
  display: flex;
  flex-flow: column nowrap;
  gap: 4px;
  min-width: 0;
}

.label {
  font-size: 12px;
  color: var(--color-font-label);
}

.input {
  width: 100%;
}

.summary {
  color: var(--color-font);
}

.failed {
  overflow-wrap: anywhere;
}

.footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 6px;
}
</style>
