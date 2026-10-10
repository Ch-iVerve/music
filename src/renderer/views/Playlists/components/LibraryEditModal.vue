<template>
  <material-modal :show="show" teleport="#view" width="60%" @close="$emit('close', $event)">
    <main :class="$style.main">
      <h2 :class="$style.title">{{ $t('playlists__edit_title') }}</h2>

      <div v-if="loading" :class="$style.tip">{{ $t('playlists__library_search') }}…</div>
      <template v-else>
        <div :class="$style.body">
          <div :class="$style.coverBox">
            <img v-if="coverUrl" :src="coverUrl" :class="$style.cover" alt="" />
            <span v-else :class="$style.coverEmpty" />
            <base-btn min @click="handleChangeCover">{{ $t('playlists__edit_change_cover') }}</base-btn>
          </div>

          <div :class="$style.form">
            <label :class="$style.field">
              <span :class="$style.label">{{ $t('playlists__edit_name') }}</span>
              <base-input v-model="form.name" :class="$style.input" type="text" />
            </label>
            <label :class="$style.field">
              <span :class="$style.label">{{ $t('playlists__edit_singer') }}</span>
              <base-input v-model="form.singer" :class="$style.input" type="text" />
            </label>
            <label :class="$style.field">
              <span :class="$style.label">{{ $t('playlists__edit_album') }}</span>
              <base-input v-model="form.album" :class="$style.input" type="text" />
            </label>
            <div :class="$style.row3">
              <label :class="$style.field">
                <span :class="$style.label">{{ $t('playlists__edit_year') }}</span>
                <base-input v-model="form.year" :class="$style.input" type="text" />
              </label>
              <label :class="$style.field">
                <span :class="$style.label">{{ $t('playlists__edit_genre') }}</span>
                <base-input v-model="form.genre" :class="$style.input" type="text" />
              </label>
            </div>
            <div :class="$style.row3">
              <label :class="$style.field">
                <span :class="$style.label">{{ $t('playlists__edit_track_num') }}</span>
                <base-input v-model="form.trackNum" :class="$style.input" type="text" />
              </label>
              <label :class="$style.field">
                <span :class="$style.label">{{ $t('playlists__edit_disc_num') }}</span>
                <base-input v-model="form.discNum" :class="$style.input" type="text" />
              </label>
            </div>
          </div>
        </div>

        <p v-if="errorText" :class="$style.error">{{ errorText }}</p>

        <div :class="$style.footer">
          <base-btn @click="$emit('close', true)">{{ $t('playlists__edit_cancel') }}</base-btn>
          <base-btn :disabled="saving" @click="handleSave">{{ $t('playlists__edit_save') }}</base-btn>
        </div>
      </template>
    </main>
  </material-modal>
</template>

<script>
import { ref, watch } from '@common/utils/vueTools'
import { showSelectDialog } from '@renderer/utils/ipc'
import { loadTrackEditInfo, saveTrackEdits } from '@renderer/core/localLibrary'

/**
 * 歌曲信息编辑弹窗（票 08，spec D11）。
 *
 * - 初始值 = **文件内 tag**（不是库行缓存），保存 = 写 tag → 库行+引用行同事务更新；
 * - 封面预览：内嵌封面 / 已选替换图，都走内存 ObjectURL（选图只是暂存路径，保存时才读字节写入）；
 * - 歌词区在票 09（逐行打轴编辑器）接管，这里只展示有无标记。
 */
export default {
  name: 'LibraryEditModal',
  props: {
    show: {
      type: Boolean,
      default: false,
    },
    track: {
      type: Object,
      default: null,
    },
  },
  emits: ['close', 'saved'],
  setup(props, { emit }) {
    const loading = ref(false)
    const saving = ref(false)
    const errorText = ref('')
    const form = ref({ name: '', singer: '', album: '', year: '', genre: '', trackNum: '', discNum: '' })
    const coverUrl = ref('')
    const coverSourcePath = ref(null)
    let currentTrack = null
    let editInfo = null
    let coverRevoke = ''

    const setCoverFromBytes = (format, data) => {
      if (coverRevoke) URL.revokeObjectURL(coverRevoke)
      const blob = new Blob([data instanceof Blob ? data : new Uint8Array(data)], { type: format })
      coverRevoke = URL.createObjectURL(blob)
      coverUrl.value = coverRevoke
    }

    const load = async() => {
      if (!props.track) return
      loading.value = true
      errorText.value = ''
      coverSourcePath.value = null
      try {
        editInfo = await loadTrackEditInfo(props.track)
        currentTrack = editInfo.track
        form.value = {
          name: editInfo.tags.name,
          singer: editInfo.tags.singer,
          album: editInfo.tags.album ?? '',
          year: editInfo.tags.year ?? '',
          genre: editInfo.tags.genre ?? '',
          trackNum: editInfo.tags.trackNum ?? '',
          discNum: editInfo.tags.discNum ?? '',
        }
        if (editInfo.tags.cover) setCoverFromBytes(editInfo.tags.cover.format, editInfo.tags.cover.data)
        else coverUrl.value = ''
      } catch (err) {
        console.log('[localLibrary.edit] 读取 tag 失败:', err)
        errorText.value = window.i18n.t('playlists__edit_failed', { message: String(err) })
      } finally {
        loading.value = false
      }
    }
    watch(() => props.show, (show) => {
      if (show) void load()
    })

    const handleChangeCover = async() => {
      const { canceled, filePaths } = await showSelectDialog({
        title: window.i18n.t('playlists__edit_change_cover'),
        properties: ['openFile'],
        filters: [{ name: 'Image', extensions: ['png', 'jpg', 'jpeg'] }],
      })
      if (canceled || !filePaths?.length) return
      coverSourcePath.value = filePaths[0]
      // 预览直接读所选图（主线程有 node，读字节走内存，不产生任何临时文件）
      const fs = await import('node:fs')
      const bytes = fs.readFileSync(filePaths[0])
      setCoverFromBytes(
        filePaths[0].toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg',
        bytes,
      )
    }

    const handleSave = async() => {
      if (!currentTrack || !editInfo) return
      saving.value = true
      errorText.value = ''
      try {
        await saveTrackEdits(currentTrack, {
          name: form.value.name,
          singer: form.value.singer,
          album: form.value.album === '' ? null : form.value.album,
          year: form.value.year === '' ? null : form.value.year,
          genre: form.value.genre === '' ? null : form.value.genre,
          trackNum: form.value.trackNum === '' ? null : form.value.trackNum,
          discNum: form.value.discNum === '' ? null : form.value.discNum,
        }, coverSourcePath.value)
        emit('saved')
        emit('close', true)
      } catch (err) {
        console.log('[localLibrary.edit] 保存失败:', err)
        errorText.value = window.i18n.t('playlists__edit_failed', { message: String(err) })
      } finally {
        saving.value = false
      }
    }

    return {
      loading,
      saving,
      errorText,
      form,
      coverUrl,
      coverSourcePath,
      handleChangeCover,
      handleSave,
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

.tip {
  font-size: 13px;
  color: var(--color-font-label);
}

.body {
  display: flex;
  gap: 18px;
}

.cover-box {
  flex: none;
  display: flex;
  flex-flow: column nowrap;
  align-items: center;
  gap: 8px;
}

.cover {
  width: 120px;
  height: 120px;
  border-radius: 4px;
  object-fit: cover;
  display: block;
}

.cover-empty {
  width: 120px;
  height: 120px;
  border-radius: 4px;
  display: block;
  background-color: var(--color-primary-background);
}

.form {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-flow: column nowrap;
  gap: 10px;
}

.field {
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

.row3 {
  display: flex;
  gap: 12px;

  .field {
    flex: 1;
  }
}

.error {
  margin: 10px 0 0;
  font-size: 12px;
  color: var(--color-font-label);
  overflow-wrap: anywhere;
}

.footer {
  margin-top: 15px;
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
</style>
