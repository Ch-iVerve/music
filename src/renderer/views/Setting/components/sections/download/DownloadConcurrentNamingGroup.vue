<template lang="pug">
//- §4 并发与档位：两项（元数据顺序）——任务数 / 档位不可用时的行为
//- 2026-10-12 集合概念统一：同名跳过与文件名模板两项随下载托管化下架（暂存文件名固定为
//- 「歌曲 id + 实际档位」，落盘后收编进库、由库管理命名）
//- 根元素是 div：内容区样式 `.setting dd > div` 会给它左右 padding
div
  .p(data-setting-key="download.maxDownloadNum")
    | {{ $t('setting__download_max_num') }}
    common-setting-help-icon(:text="$t('setting__download_max_num_tooltip')" :label="$t('setting__download_max_num')")
    base-selection.gap-left(:class="$style.selectWidth" :model-value="appSetting['download.maxDownloadNum']" :list="maxNums" item-key="id" item-name="id" @change="handleUpdateMaxNum")
  .gap-top(data-setting-key="download.degradeWhenUnsupported")
    base-checkbox(id="setting_download_degrade_when_unsupported" :model-value="appSetting['download.degradeWhenUnsupported']" :label="$t('setting__download_degrade_when_unsupported')" @update:model-value="updateSetting({'download.degradeWhenUnsupported': $event})")
    common-setting-help-icon(:text="$t('setting__download_degrade_when_unsupported_tip')" :label="$t('setting__download_degrade_when_unsupported')")
</template>

<script>
import { appSetting, updateSetting } from '@renderer/store/setting'
import { dialog } from '@renderer/plugins/Dialog'
import { useI18n } from '@renderer/plugins/i18n'

/**
 * 下载 → 并发与档位（`download_concurrent_naming`，设置页重构票 07；集合概念统一后删掉两项）。
 *
 * 保留两项：
 * - `download.maxDownloadNum`：真并发放到 worker 的闸门（1–6）；>3 会先弹确认；
 * - `download.degradeWhenUnsupported`：默认 true = 改造前的静默降档行为；关掉后请求档位不可用的歌
 *   不建任务，由下载入队处弹提示（`store/download/action.ts`）。
 */
export default {
  name: 'DownloadConcurrentNamingGroup',
  setup() {
    const t = useI18n()

    const maxNums = new Array(6).fill(null).map((_, i) => ({ id: i + 1 }))
    const handleUpdateMaxNum = async({ id }) => {
      if (id > 3) {
        if (!await dialog.confirm(t('setting__download_max_num_tip'))) return
      }
      updateSetting({ 'download.maxDownloadNum': id })
    }

    return {
      appSetting,
      updateSetting,
      maxNums,
      handleUpdateMaxNum,
    }
  },
}
</script>

<style lang="less" module>
.selectWidth {
  width: 60px;
}
</style>
