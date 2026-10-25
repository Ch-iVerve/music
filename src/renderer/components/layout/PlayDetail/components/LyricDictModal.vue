<template>
  <material-modal :show="show" bg-close teleport="#root" max-width="60%" @close="handleClose">
    <main :class="$style.main">
      <h2 :class="$style.title">{{ $t('player__lyric_dict_title') }}</h2>
      <p :class="$style.word">{{ word }}</p>
      <p v-if="loading" :class="$style.tip">{{ $t('player__lyric_dict_loading') }}</p>
      <div v-else-if="entries.length" :class="['scroll', $style.list]">
        <div v-for="(item, index) in entries" :key="index" :class="$style.entry">
          <p :class="$style.phrase">{{ item.phrase }}</p>
          <p :class="$style.explain">{{ item.explain }}</p>
          <p v-if="item.lyric_text" :class="$style.source">
            <span :class="$style.time">{{ item.lyric_timestamp }}</span>
            <span>{{ item.lyric_text }}</span>
            <template v-if="item.trans_lyric_text">
              <br>
              <span :class="$style.trans">{{ item.trans_lyric_text }}</span>
            </template>
          </p>
        </div>
      </div>
      <!-- 查不到时给一句明确的「没有」，不留空白：中文歌 / 日文歌实测都没有词典，这是主路径之一 -->
      <p v-else :class="$style.tip">{{ $t('player__lyric_dict_empty', { word }) }}</p>
      <div :class="$style.footer">
        <base-btn :class="$style.footerBtn" :aria-label="$t('btn_close')" :title="$t('btn_close')" @click="handleClose">{{ $t('btn_close') }}</base-btn>
      </div>
    </main>
  </material-modal>
</template>

<script>
/**
 * 歌词词典（双击歌词里的词查释义）弹窗。
 *
 * 三件事照仓库既有约定办（不在材料上自己发明）：
 * - 弹窗一律 `material-modal`（背景压暗联动依赖它）；`teleport="#root"` 而不是 `#view`——
 *   播放详情页是 `#container` 里的整屏浮层（z-index 10，见 `PlayDetail/index.vue`），
 *   `#root` 才能压住它并让 `#root.show-modal > .view-container` 的压暗生效。
 * - `bg-close` + 底部「关闭」键：弹窗占满屏幕，必须有明确的出口。
 * - Esc 关闭由 `material-modal` 统一处理（2026-10-25 起，此前本组件自建 document 监听，已删）。
 */
export default {
  name: 'LyricDictModal',
  props: {
    show: {
      type: Boolean,
      default: false,
    },
    word: {
      type: String,
      default: '',
    },
    entries: {
      type: Array,
      default: () => [],
    },
    loading: {
      type: Boolean,
      default: false,
    },
  },
  emits: ['update:show'],
  setup(props, { emit }) {
    // Esc 关闭由 material-modal 统一处理(2026-10-25 起,自建的 document 监听已删——见 docs/adr/0014);
    // 本组件的 @close 由 material-modal 的 Esc / ✕ 都会触发,统一走 update:show 收口。
    const handleClose = () => {
      emit('update:show', false)
    }

    return {
      handleClose,
    }
  },
}
</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.main {
  padding: 15px;
  min-width: 0;
}
.title {
  font-size: 13px;
  color: var(--color-450);
  line-height: 1.3;
  text-align: center;
}
.word {
  padding-top: 6px;
  font-size: 15px;
  color: var(--color-font);
  font-weight: 700;
  line-height: 1.4;
  text-align: center;
  word-break: break-word;
}
/**
 * 释义可以长到几百字，必须自己滚。
 * ⚠️ 高度用 `vh` 写死而不是靠 `.main` 的 flex 链：`material-modal` 的 `.content` 高度是
 * 「内容撑开 + max-height 76%」的 auto 高度，百分比 max-height 在这种父高度里解析不出确定值
 * （本仓被这个坑咬过：MvPlayerModal 的底部按钮整排看不见）。45vh + 固定头尾 ≈ 76% 内放得下。
 */
.list {
  margin-top: 12px;
  max-height: 45vh;
  overflow-y: auto;
}
.entry {
  & + & {
    margin-top: 14px;
    padding-top: 14px;
    border-top: 1px solid var(--color-primary-light-100-alpha-100);
  }
}
.phrase {
  font-size: 14px;
  color: var(--color-primary);
  line-height: 1.4;
  word-break: break-word;
}
.explain {
  padding-top: 6px;
  font-size: 13px;
  color: var(--color-font);
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}
.source {
  padding-top: 8px;
  font-size: 12px;
  color: var(--color-450);
  line-height: 1.5;
  word-break: break-word;
}
.time {
  margin-right: 6px;
  color: var(--color-primary-dark-100);
}
.trans {
  color: var(--color-450);
  opacity: .8;
}
.tip {
  padding-top: 12px;
  font-size: 13px;
  color: var(--color-450);
  line-height: 1.5;
  text-align: center;
  word-break: break-word;
}
.footer {
  margin-top: 16px;
  display: flex;
  flex-flow: row nowrap;
}
.footerBtn {
  flex: auto;
  height: 36px;
  line-height: 36px;
  padding: 0 10px !important;
  .mixin-ellipsis-1();
}
</style>
