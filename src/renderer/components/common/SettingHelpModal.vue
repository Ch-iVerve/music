<template lang="pug">
//- 帮助弹窗。只挂一份（设置页根部），60+ 个 `?` 共用这一份状态 —— 见 useSettingHelp.ts
material-modal(:show="helpVisible" bg-close teleport="#view" max-width="60%" @close="closeSettingHelp")
  main(:class="$style.main")
    h2(:class="$style.title") {{ helpLabel || $t('setting__help_title') }}
    p(:class="$style.text") {{ helpText }}
    div(:class="$style.footer")
      //- 长文案看完了要有个明确的出口：✕（material-modal 自带）/ 点背景 / Esc 都能关，
      //- 但用户找的是「关掉」这个键
      base-btn(:class="$style.footerBtn" :aria-label="$t('btn_close')" :title="$t('btn_close')" @click="closeSettingHelp") {{ $t('btn_close') }}
</template>

<script>
import { onBeforeUnmount } from '@common/utils/vueTools'
import { helpLabel, helpText, helpVisible, closeSettingHelp } from './useSettingHelp'

// Esc 关闭由 material-modal 统一处理(2026-10-25 起,原来自建的 document 监听已删——见 docs/adr/0014)。
export default {
  name: 'SettingHelpModal',
  setup() {
    onBeforeUnmount(() => {
      // 页面切走时状态要清掉：状态是模块级的，留着会在切回设置页时凭空弹出来
      closeSettingHelp()
    })

    return {
      helpLabel,
      helpText,
      helpVisible,
      closeSettingHelp,
    }
  },
}
</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.main {
  padding: 15px;
  min-width: 0;
  h2 {
    font-size: 14px;
    color: var(--color-font);
    line-height: 1.3;
    text-align: center;
  }
}
.text {
  padding-top: 12px;
  font-size: 13px;
  color: var(--color-font);
  line-height: 1.5;
  // 帮助文案可能是一段说明，换行照原样断，不缩进
  white-space: pre-wrap;
  word-break: break-word;
}
.footer {
  margin-top: 20px;
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
