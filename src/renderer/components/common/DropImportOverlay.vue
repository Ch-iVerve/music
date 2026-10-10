<template>
  <transition name="fade">
    <div v-if="state.dragDepth.value > 0" :class="$style.overlay">
      <div :class="$style.box">
        <svg-icon name="music" :class="$style.icon" />
        <span :class="$style.hint">{{ $t('playlists__drop_import_hint') }}</span>
      </div>
    </div>
  </transition>
</template>

<script>
import { useDragOverlayState } from '@renderer/core/localLibrary/dragImport'

/**
 * 拖拽导入的**全屏反馈遮罩**（票 04）。状态在 core/localLibrary/dragImport；
 * `pointer-events: none`——drop 事件必须落到下层元素再由 window 统一接，遮罩只负责「看得见」。
 */
export default {
  name: 'DropImportOverlay',
  setup() {
    return { state: useDragOverlayState() }
  },
}
</script>

<style lang="less" module>
.overlay {
  position: fixed;
  inset: 0;
  z-index: 900;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  background-color: var(--color-primary-background);
}

.box {
  display: flex;
  flex-flow: column nowrap;
  align-items: center;
  gap: 12px;
  padding: 32px 48px;
  border: 2px dashed var(--color-primary-light-500);
  border-radius: 8px;
}

.icon {
  width: 40px;
  height: 40px;
  color: var(--color-theme);
}

.hint {
  font-size: 15px;
  color: var(--color-font);
}
</style>
