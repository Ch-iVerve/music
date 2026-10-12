<template>
  <div v-if="tasks.length" :class="$style.bar">
    <div v-for="task in tasks" :key="task.id" :class="$style.task">
      <span :class="$style.name" :title="task.metadata.musicInfo.name">{{ task.metadata.musicInfo.name }}</span>
      <span :class="$style.progress">{{ task.progress }}%<template v-if="task.speed"> · {{ task.speed }}/s</template></span>
      <span :class="$style.status" :title="task.statusText">{{ task.statusText }}</span>
      <button v-if="isRunning(task)" :class="$style.btn" type="button" @click="pauseDownloadTasks([task])">{{ $t('list__pause') }}</button>
      <button v-else :class="$style.btn" type="button" @click="startDownloadTasks([task])">{{ $t('list__start') }}</button>
      <button :class="$style.btn" type="button" @click="removeDownloadTasks([task.id])">{{ $t('list__remove') }}</button>
    </div>
  </div>
</template>

<script lang="ts">
import { computed } from '@common/utils/vueTools'
import { downloadList, downloadStatus } from '@renderer/store/download/state'
import { startDownloadTasks, pauseDownloadTasks, removeDownloadTasks } from '@renderer/store/download/action'

/**
 * 下载任务条（集合概念统一 D3/票 04）：本地音乐页顶部的进行中任务条。
 *
 * 下载完成即收编入库并从任务列表移除（票 03），所以这里只会出现「进行中 / 等待 / 暂停 / 失败」
 * 的任务；无任务时整块不渲染（库是页面主体，任务条只在有任务时出现）。操作三个：暂停/继续、
 * 移除（与下载页右键「移除」同口径：直接执行，文件残留由重扫描兜）。
 */
export default {
  name: 'DownloadTaskBar',
  setup() {
    // 只显示未完成的任务：已完成的行会被完成编排移出 downloadList（票 03）
    const tasks = computed(() => downloadList.filter(task => !task.isComplate))
    const isRunning = (task: LX.Download.ListItem) =>
      task.status == downloadStatus.RUN || task.status == downloadStatus.WAITING

    return {
      tasks,
      isRunning,
      startDownloadTasks,
      pauseDownloadTasks,
      removeDownloadTasks,
    }
  },
}
</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.bar {
  flex: none;
  margin-bottom: 8px;
  border: 1px solid var(--color-primary-light-500);
  border-radius: @radius-border;
  overflow: hidden;
}

.task {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  font-size: 12px;
  color: var(--color-font);

  & + & {
    border-top: 1px solid var(--color-primary-light-500);
  }
}

.name {
  flex: 1.4;
  min-width: 0;
  .mixin-ellipsis-1();
}

.progress {
  flex: none;
  width: 96px;
  color: var(--color-font-label);
  font-variant-numeric: tabular-nums;
}

.status {
  flex: 1;
  min-width: 0;
  .mixin-ellipsis-1();
  color: var(--color-font-label);
}

.btn {
  flex: none;
  padding: 2px 8px;
  border: 1px solid var(--color-primary-light-500);
  border-radius: @radius-border;
  background-color: transparent;
  color: var(--color-font-label);
  font-size: 12px;
  cursor: pointer;

  &:hover {
    color: var(--color-theme);
    border-color: var(--color-theme);
  }
}
</style>
