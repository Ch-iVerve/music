<template>
  <material-modal :show="state.visible.value" teleport="#view" width="50%" @close="handleClose">
    <main :class="$style.main">
      <h2 :class="$style.title">{{ $t('lists__local_import_title') }}</h2>

      <template v-if="!state.finished.value">
        <div :class="$style.progressRow">
          <span :class="$style.count">{{ state.progress.value?.done ?? 0 }}/{{ state.progress.value?.total ?? 0 }}</span>
          <span :class="$style.current" :title="state.progress.value?.current">{{ state.progress.value?.current }}</span>
        </div>
        <div :class="$style.footer">
          <base-btn @click="handleCancel">{{ $t('lists__local_import_cancel') }}</base-btn>
        </div>
      </template>
      <template v-else>
        <p :class="$style.summary">{{ summaryText }}</p>
        <p v-if="cancelledText" :class="$style.cancelled">{{ cancelledText }}</p>
        <p v-if="failedText" :class="$style.failed" :title="state.finished.value?.failed.join('、')">{{ failedText }}</p>
        <div :class="$style.footer">
          <base-btn @click="handleClose">{{ $t('lists__local_import_close') }}</base-btn>
        </div>
      </template>
    </main>
  </material-modal>
</template>

<script>
import { computed } from '@common/utils/vueTools'
import { cancelLocalImport, closeLocalImport, useLocalImportState } from '@renderer/core/localLibrary'

/**
 * 托管导入的进度/汇总弹窗（票 02）。
 *
 * 状态由 core/localLibrary 持有（导入期间同一时刻只允许一个），本组件只是它的呈现：
 * 进行中=进度 + 取消按钮；完成=汇总（新增/跳过/失败）+ 关闭。进行中点关闭按钮无效
 * （取消必须走取消按钮——语义是「停下手头未完成的」，不是「丢掉已完成」）。
 */
export default {
  name: 'LocalImportProgressModal',
  setup() {
    const state = useLocalImportState()

    const summaryText = computed(() => window.i18n.t('lists__local_import_summary', {
      added: state.finished.value?.added ?? 0,
      skipped: state.finished.value?.skipped ?? 0,
      failed: state.finished.value?.failed.length ?? 0,
    }))
    const cancelledText = computed(() => (state.finished.value?.cancelled ? window.i18n.t('lists__local_import_cancelled') : ''))
    const failedText = computed(() => (state.finished.value?.failed.length
      ? window.i18n.t('lists__local_import_failed', { names: state.finished.value.failed.join('、') })
      : ''))

    const handleCancel = () => {
      cancelLocalImport()
    }
    const handleClose = () => {
      if (state.finished.value) closeLocalImport()
    }

    return {
      state,
      summaryText,
      cancelledText,
      failedText,
      handleCancel,
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
  margin: 0 0 12px;
  font-size: 15px;
  color: var(--color-font);
}

.progress-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  margin-bottom: 15px;
  font-size: 13px;
}

.count {
  flex: none;
  color: var(--color-font-label);
}

.current {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-font);
}

.summary,
.cancelled,
.failed {
  margin: 0 0 8px;
  font-size: 13px;
  color: var(--color-font);
  overflow-wrap: anywhere;
}

.cancelled,
.failed {
  color: var(--color-font-label);
}

.footer {
  margin-top: 15px;
  text-align: right;
}
</style>
