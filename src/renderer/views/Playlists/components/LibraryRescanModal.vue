<template>
  <material-modal :show="show" teleport="#view" width="60%" @close="$emit('close', $event)">
    <main :class="$style.main">
      <h2 :class="$style.title">{{ $t('playlists__rescan_title') }}</h2>

      <p v-if="isEmpty" :class="$style.none">{{ $t('playlists__rescan_none') }}</p>

      <template v-else>
        <section v-if="report.junk.length" :class="[$style.section, $style.junkSection]">
          <div :class="$style.sectionHead">
            <span :class="$style.sectionTitle">{{ $t('playlists__rescan_junk') }}</span>
            <span :class="$style.sectionCount">{{ report.junk.length }}</span>
            <base-btn min @click="handleCleanJunk">{{ $t('playlists__rescan_junk_remove') }}</base-btn>
          </div>
          <ul class="scroll" :class="$style.list">
            <li v-for="p in report.junk" :key="p" :class="$style.item" :title="p">{{ fileName(p) }}</li>
          </ul>
        </section>

        <section :class="$style.section">
          <div :class="$style.sectionHead">
            <span :class="$style.sectionTitle">{{ $t('playlists__rescan_orphans') }}</span>
            <span :class="$style.sectionCount">{{ report.orphans.length }}</span>
            <template v-if="report.orphans.length">
              <base-btn min @click="handleAdopt">{{ $t('playlists__rescan_adopt') }}</base-btn>
              <base-btn min @click="handleClean">{{ $t('playlists__rescan_delete') }}</base-btn>
            </template>
          </div>
          <ul class="scroll" :class="$style.list">
            <li v-for="p in report.orphans" :key="p" :class="$style.item" :title="p">{{ fileName(p) }}</li>
          </ul>
        </section>

        <section :class="$style.section">
          <div :class="$style.sectionHead">
            <span :class="$style.sectionTitle">{{ $t('playlists__rescan_missing') }}</span>
            <span :class="$style.sectionCount">{{ report.missing.length }}</span>
            <base-btn v-if="report.missing.length" min @click="handleRemove(report.missing, 'missing')">{{ $t('playlists__rescan_remove') }}</base-btn>
          </div>
          <ul class="scroll" :class="$style.list">
            <li v-for="p in report.missing" :key="p" :class="$style.item" :title="p">{{ fileName(p) }}</li>
          </ul>
        </section>

        <section :class="$style.section">
          <div :class="$style.sectionHead">
            <span :class="$style.sectionTitle">{{ $t('playlists__rescan_mismatch') }}</span>
            <span :class="$style.sectionCount">{{ report.mismatched.length }}</span>
            <base-btn v-if="report.mismatched.length" min @click="handleRemove(report.mismatched, 'mismatch')">{{ $t('playlists__rescan_remove') }}</base-btn>
          </div>
          <ul class="scroll" :class="$style.list">
            <li v-for="p in report.mismatched" :key="p" :class="$style.item" :title="p">{{ fileName(p) }}</li>
          </ul>
        </section>
      </template>

      <div :class="$style.footer">
        <base-btn @click="$emit('close', true)">{{ $t('playlists__rescan_close') }}</base-btn>
      </div>
    </main>
  </material-modal>
</template>

<script>
import { computed } from '@common/utils/vueTools'
import { dialog } from '@renderer/plugins/Dialog'
import {
  adoptOrphanFiles,
  deleteOrphanFiles,
  removeLibraryTracksByPath,
} from '@renderer/core/localLibrary'
/**
 * 重扫描对账报告（票 07）：三类差异分区展示，处置动作带确认。
 *
 * 「收编入库」/「删除文件」只作用于孤儿区；「移除记录」作用于失效/不符区（级联清歌单引用，
 * **媒体文件不受影响**——删除文件与移除记录是两个不相交的动作，弹窗文案里各说各话）。
 * 动作完成后 emit changed，由父级重拉库并重新对账（报告自动刷新）。
 */
export default {
  name: 'LibraryRescanModal',
  props: {
    show: {
      type: Boolean,
      default: false,
    },
    report: {
      type: Object,
      default: null,
    },
  },
  emits: ['close', 'changed'],
  setup(props, { emit }) {
    const isEmpty = computed(() => !props.report ||
      (props.report.orphans.length + props.report.missing.length + props.report.mismatched.length + props.report.junk.length) === 0)

    const fileName = p => p.split(/\/|\\/).at(-1)

    const handleAdopt = async() => {
      const added = await adoptOrphanFiles(props.report.orphans)
      if (added) emit('changed')
    }

    // 垃圾条目（macOS `._*` 旧导入噪声）：托管副本是纯垃圾元数据，**记录+文件一起删**（原始文件不在话下）
    const handleCleanJunk = async() => {
      const confirm = await dialog.confirm({
        message: window.i18n.t('playlists__rescan_junk_confirm', { num: props.report.junk.length }),
        confirmButtonText: window.i18n.t('playlists__rescan_junk_remove'),
        cancelButtonText: window.i18n.t('lists__import_part_button_cancel'),
      })
      if (!confirm) return
      await deleteOrphanFiles(props.report.junk)
      await removeLibraryTracksByPath(props.report.junk)
      emit('changed')
    }

    const handleClean = async() => {
      const confirm = await dialog.confirm({
        message: window.i18n.t('playlists__rescan_clean_confirm', { num: props.report.orphans.length }),
        confirmButtonText: window.i18n.t('playlists__rescan_delete'),
        cancelButtonText: window.i18n.t('lists__import_part_button_cancel'),
      })
      if (!confirm) return
      await deleteOrphanFiles(props.report.orphans)
      emit('changed')
    }

    const handleRemove = async(paths) => {
      const confirm = await dialog.confirm({
        message: window.i18n.t('playlists__rescan_remove_confirm', { num: paths.length }),
        confirmButtonText: window.i18n.t('playlists__rescan_remove'),
        cancelButtonText: window.i18n.t('lists__import_part_button_cancel'),
      })
      if (!confirm) return
      await removeLibraryTracksByPath(paths)
      emit('changed')
    }

    return {
      isEmpty,
      fileName,
      handleAdopt,
      handleClean,
      handleCleanJunk,
      handleRemove,
    }
  },
}
</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.main {
  padding: 15px 20px;
  max-height: 80vh;
  display: flex;
  flex-flow: column nowrap;
}

.title {
  margin: 0 0 12px;
  font-size: 15px;
  color: var(--color-font);
}

.none {
  font-size: 13px;
  color: var(--color-font-label);
}

.section {
  margin-bottom: 12px;
}

// 垃圾条目区：给一个「建议处理」的视觉权重（底色微强调）
.junk-section {
  padding: 8px;
  background-color: var(--color-primary-background);
  border-radius: @radius-border;
}

.section-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.section-title {
  font-size: 13px;
  color: var(--color-font);
}

.section-count {
  font-size: 12px;
  color: var(--color-font-label);
}

.section-head button {
  margin-left: 4px;
}

.list {
  max-height: 120px;
  border: 1px solid var(--color-primary-light-500);
  border-radius: 3px;
  padding: 4px 8px;
}

.item {
  font-size: 12px;
  line-height: 1.6;
  color: var(--color-font-label);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.footer {
  margin-top: 10px;
  text-align: right;
}
</style>
