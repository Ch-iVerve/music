<template>
  <material-modal :show="show" teleport="#view" width="80%" @close="handleClose">
    <main :class="$style.main">
      <h2 :class="$style.title">{{ $t('playlists__lyric_title', { name: track?.name ?? '' }) }}</h2>

      <!-- 试听条：独立音频实例，不劫持主播放器（spec D12） -->
      <div :class="$style.playerBar">
        <button :class="$style.playBtn" :aria-label="playing ? $t('playlists__lyric_pause') : $t('playlists__lyric_play')" :title="playing ? $t('playlists__lyric_pause') : $t('playlists__lyric_play')" @click="togglePlay">
          <svg-icon :name="playing ? 'fullscreen-exit' : 'play-outline'" :class="$style.playIcon" />
        </button>
        <span :class="$style.time">{{ formatTime(currentTime) }} / {{ formatTime(duration) }}</span>
        <input
          v-if="duration > 0"
          :class="$style.seek"
          type="range"
          min="0"
          :max="seekMax"
          :value="seekValue"
          :aria-label="$t('playlists__lyric_seek')"
          @input="handleSeek(Number($event.target.value) * 1000)"
        />
        <div :class="$style.modeCapsules">
          <button
            v-for="m in modes"
            :key="m.mode"
            :class="[$style.capsule, { [$style.active]: mode == m.mode }]"
            :aria-pressed="mode == m.mode"
            @click="mode = m.mode"
          >{{ m.label }}</button>
        </div>
      </div>

      <div :class="$style.actions">
        <base-btn min @click="handleImportLrc">{{ $t('playlists__lyric_import_lrc') }}</base-btn>
        <span :class="$style.hint">{{ mode == 'line' ? $t('playlists__lyric_line_hint') : $t('playlists__lyric_word_hint') }}</span>
      </div>

      <div class="scroll" :class="$style.list">
        <div
          v-for="(line, index) in lines"
          :key="index"
          :class="[$style.lineRow, { [$style.playing]: isCurrentLine(line) }]"
        >
          <span :class="$style.lineTime" :title="$t('playlists__lyric_stamp')">{{ line.time < 0 ? '--:--' : formatTime(line.time) }}</span>
          <button
            v-if="mode == 'line' || selectedLine == index"
            :class="$style.stampBtn"
            :title="$t('playlists__lyric_stamp')"
            @click="handleStamp(index)"
          >{{ $t('playlists__lyric_stamp') }}</button>
          <button
            v-else
            :class="$style.stampBtn"
            :title="$t('playlists__lyric_open_word')"
            @click="selectedLine = index"
          >{{ $t('playlists__lyric_word') }}</button>
          <input v-model="line.text" :class="$style.lineText" type="text" />

          <!-- 逐字面板：仅选中行展开；打点顺序推进字元 -->
          <div v-if="mode == 'word' && selectedLine == index" :class="$style.wordPanel">
            <div :class="$style.wordActions">
              <base-btn min @click="handleSplitWords(index)">{{ $t('playlists__lyric_split') }}</base-btn>
              <base-btn min @click="handleStampWord(index)">{{ $t('playlists__lyric_stamp_next') }}</base-btn>
              <span :class="$style.wordHint">{{ $t('playlists__lyric_word_progress', { done: stampedWordCount(index), total: wordCount(index) }) }}</span>
            </div>
            <div :class="$style.words">
              <span
                v-for="(word, wi) in line.words ?? []"
                :key="wi"
                :class="[$style.word, { [$style.wordStamped]: word.start >= 0 }]"
                :title="`${word.start}ms +${word.dur}ms`"
              >{{ word.text }}</span>
            </div>
          </div>
        </div>
      </div>

      <p v-if="errorText" :class="$style.error">{{ errorText }}</p>

      <div :class="$style.footer">
        <base-btn @click="$emit('close', true)">{{ $t('playlists__edit_cancel') }}</base-btn>
        <base-btn :disabled="saving" @click="handleSave">{{ $t('playlists__edit_save') }}</base-btn>
      </div>
    </main>
  </material-modal>
</template>

<script>
import { computed, ref, watch, onBeforeUnmount } from '@common/utils/vueTools'
import { encodePath } from '@common/utils/common'
import { showSelectDialog } from '@renderer/utils/ipc'
import {
  loadTrackLyricsInfo,
  saveTrackLyrics,
  readDroppedLrcText,
} from '@renderer/core/localLibrary'
import {
  parseLyricText,
  serializeLyricLines,
  splitWords,
  fillWordDurations,
} from '@renderer/core/localLibrary/lyricEdit'

/**
 * 歌词编辑器（票 09，spec D12）：逐行打轴 + 逐字打轴（LX awlrc 逐字格式）双模式。
 *
 * - 试听 = **独立 Audio 实例**（file:// 读托管副本），不劫持主播放器；卸载即停。
 * - 逐行模式：每行「打点」= 当前试听时间写入行起点；打过的行高亮为正在唱的行。
 * - 逐字模式：选中行 →「拆词」（中文按字/英文按词）→ 大按钮按顺序推进打点（每字=当前时间，
 *   时长自动按下一字补齐，末字兜底 1s）；序列化满足播放器 awlrc 判定（每行都有 <起,时>）。
 * - 保存 = 序列化 → 写内嵌歌词 tag（USLT/LYRICS）→ 库行 hasLyric 同步；无旁车文件。
 */
export default {
  name: 'LibraryLyricModal',
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
    const lines = ref([])
    const mode = ref('line')
    const selectedLine = ref(-1)
    const saving = ref(false)
    const errorText = ref('')
    const playing = ref(false)
    const currentTime = ref(0)
    const duration = ref(0)
    let audio = null
    let mediaPath = ''
    let currentTrack = null

    const modes = [
      { mode: 'line', label: window.i18n.t('playlists__lyric_mode_line') },
      { mode: 'word', label: window.i18n.t('playlists__lyric_mode_word') },
    ]

    const isCurrentLine = (line) => {
      if (line.time < 0 || currentTime.value < line.time) return false
      const stamped = lines.value.filter(l => l.time >= 0 && l.time <= currentTime.value)
      const current = stamped[stamped.length - 1]
      return current == line
    }

    // 模板取不到 Math：seek 的 max/value 在这里预折算
    const seekMax = computed(() => Math.floor(duration.value))
    const seekValue = computed(() => Math.floor(currentTime.value))

    const formatTime = (ms) => {
      const total = Math.max(0, Math.floor(ms / 100) / 10)
      const min = Math.floor(total / 60)
      const sec = (total % 60).toFixed(1).padStart(4, '0')
      return `${String(min).padStart(2, '0')}:${sec}`
    }

    const stopAudio = () => {
      if (!audio) return
      audio.pause()
      playing.value = false
    }

    const togglePlay = () => {
      if (!audio) return
      if (playing.value) {
        audio.pause()
        playing.value = false
      } else {
        void audio.play().then(() => {
          playing.value = true
        }).catch(err => {
          console.log('[localLibrary.lyric] 试听失败:', err)
        })
      }
    }

    const handleSeek = (ms) => {
      if (!audio) return
      audio.currentTime = ms / 1000
      currentTime.value = ms
    }

    const handleStamp = (index) => {
      const line = lines.value[index]
      if (!line || !audio) return
      line.time = Math.floor(audio.currentTime * 1000)
      lines.value = [...lines.value].sort((a, b) => {
        if (a.time < 0) return 1
        if (b.time < 0) return -1
        return a.time - b.time
      })
    }

    const wordCount = index => lines.value[index]?.words?.length ?? 0
    const stampedWordCount = index => (lines.value[index]?.words ?? []).filter(w => w.start >= 0).length

    const handleSplitWords = (index) => {
      const line = lines.value[index]
      if (!line) return
      line.words = splitWords(line.text, line.time)
    }

    const handleStampWord = (index) => {
      const line = lines.value[index]
      if (!line || !audio) return
      const words = line.words ?? (line.words = splitWords(line.text, line.time < 0 ? -1 : line.time))
      const next = words.find(w => w.start < 0)
      if (!next) return
      next.start = Math.floor(audio.currentTime * 1000)
      fillWordDurations(words)
    }

    const handleImportLrc = async() => {
      const { canceled, filePaths } = await showSelectDialog({
        title: window.i18n.t('playlists__lyric_import_lrc'),
        properties: ['openFile'],
        filters: [{ name: 'LRC', extensions: ['lrc', 'txt'] }],
      })
      if (canceled || !filePaths?.length) return
      try {
        const text = await readDroppedLrcText(filePaths[0])
        lines.value = parseLyricText(text)
      } catch (err) {
        console.log('[localLibrary.lyric] 歌词导入失败:', err)
        errorText.value = String(err)
      }
    }

    const handleSave = async() => {
      if (!currentTrack) return
      saving.value = true
      errorText.value = ''
      try {
        stopAudio()
        await saveTrackLyrics(currentTrack, serializeLyricLines(lines.value, mode.value))
        emit('saved')
        emit('close', true)
      } catch (err) {
        console.log('[localLibrary.lyric] 保存失败:', err)
        errorText.value = window.i18n.t('playlists__edit_failed', { message: String(err) })
      } finally {
        saving.value = false
      }
    }

    const handleClose = () => {
      if (!saving.value) emit('close', true)
    }

    const cleanupAudio = () => {
      stopAudio()
      if (audio) {
        audio.src = ''
        audio = null
      }
    }

    watch(() => props.show, async(show) => {
      if (!show) {
        cleanupAudio()
        return
      }
      if (!props.track) return
      currentTrack = props.track
      errorText.value = ''
      selectedLine.value = -1
      mode.value = 'line'
      lines.value = []
      audio = new Audio()
      audio.addEventListener('timeupdate', () => {
        currentTime.value = audio.currentTime * 1000
      })
      audio.addEventListener('loadedmetadata', () => {
        duration.value = audio.duration * 1000
      })
      audio.addEventListener('ended', () => {
        playing.value = false
      })
      try {
        const info = await loadTrackLyricsInfo(props.track)
        mediaPath = info.mediaPath
        audio.src = encodePath(mediaPath)
        lines.value = info.lyricsText ? parseLyricText(info.lyricsText) : []
      } catch (err) {
        console.log('[localLibrary.lyric] 歌词读取失败:', err)
        errorText.value = String(err)
      }
    })

    onBeforeUnmount(cleanupAudio)

    return {
      lines,
      mode,
      selectedLine,
      saving,
      errorText,
      playing,
      currentTime,
      duration,
      seekMax,
      seekValue,
      modes,
      isCurrentLine,
      formatTime,
      togglePlay,
      handleSeek,
      handleStamp,
      wordCount,
      stampedWordCount,
      handleSplitWords,
      handleStampWord,
      handleImportLrc,
      handleSave,
      handleClose,
    }
  },
}
</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.main {
  padding: 15px 20px;
  height: 82vh;
  // 不算 padding 的话内容会垂直居中后向上溢出——标题被截成半截（票 14 真机截图）
  box-sizing: border-box;
  display: flex;
  flex-flow: column nowrap;
}

.title {
  margin: 0 0 10px;
  font-size: 15px;
  color: var(--color-font);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.player-bar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
}

.play-btn {
  flex: none;
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--color-primary-light-500);
  border-radius: 50%;
  background-color: transparent;
  color: var(--color-font);
  cursor: pointer;
}

.play-icon {
  width: 14px;
  height: 14px;
}

.time {
  flex: none;
  font-size: 12px;
  color: var(--color-font-label);
  font-variant-numeric: tabular-nums;
}

.seek {
  flex: 1;
  min-width: 0;
}

.mode-capsules {
  flex: none;
  display: flex;
  gap: 6px;
}

.capsule {
  padding: 3px 12px;
  border: 1px solid var(--color-primary-light-500);
  border-radius: 999px;
  font-size: 12px;
  color: var(--color-font-label);
  background-color: transparent;
  cursor: pointer;

  &.active {
    color: var(--color-theme);
    border-color: var(--color-theme);
    background-color: var(--color-primary-background);
  }
}

.actions {
  flex: none;
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}

.hint {
  font-size: 12px;
  color: var(--color-font-label);
}

.list {
  flex: auto;
  min-height: 0;
  border: 1px solid var(--color-primary-light-500);
  border-radius: 3px;
  padding: 4px 6px;
}

.line-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 2px 4px;
  flex-wrap: wrap;

  &.playing .line-time {
    color: var(--color-theme);
    font-weight: bold;
  }
}

.line-time {
  flex: none;
  width: 58px;
  font-size: 12px;
  color: var(--color-font-label);
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.stamp-btn {
  flex: none;
  padding: 1px 8px;
  font-size: 11px;
  border: 1px solid var(--color-primary-light-500);
  border-radius: 3px;
  background-color: transparent;
  color: var(--color-font-label);
  cursor: pointer;

  &:hover {
    color: var(--color-theme);
    border-color: var(--color-theme);
  }
}

.line-text {
  flex: 1;
  min-width: 200px;
  font-size: 13px;
  color: var(--color-font);
  background-color: transparent;
  border: none;
  border-bottom: 1px solid transparent;
  outline: none;

  &:focus {
    border-bottom-color: var(--color-primary-light-500);
  }
}

.word-panel {
  flex: 1 1 100%;
  padding: 6px 8px;
  background-color: var(--color-primary-background);
  border-radius: 3px;
}

.word-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.word-hint {
  font-size: 12px;
  color: var(--color-font-label);
}

.words {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.word {
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 12px;
  color: var(--color-font-label);
  border: 1px solid var(--color-primary-light-500);
}

.word-stamped {
  color: var(--color-theme);
  border-color: var(--color-theme);
}

.error {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--color-font-label);
}

.footer {
  flex: none;
  margin-top: 10px;
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
</style>
