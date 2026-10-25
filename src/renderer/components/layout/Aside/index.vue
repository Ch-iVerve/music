<template>
  <div :class="[$style.aside, { [$style.fullscreen]: isFullscreen }]">
    <ControlBtns v-if="appSetting['common.controlBtnPosition'] == 'left'" />
    <!--
      品牌字标（用户可见显示名的变体规则见 AGENTS §8）：窄栏里上下两行——短名 `Ch'iverve` + 副行 `MUSIC`。
      用户 2026-09-23 明确「Ch'iverve / Music / Ch'iverve Music / MUSIC 在不同地方都可以用」，
      所以这里不是单一字符串，按场景挑。
    -->
    <div v-else :class="$style.logo">
      <span :class="$style.logoBrand">Ch'iverve</span>
      <span :class="$style.logoSub">MUSIC</span>
    </div>
    <NavBar />
  </div>
</template>

<script setup>
import { isFullscreen } from '@renderer/store'
import { appSetting } from '@renderer/store/setting'

import ControlBtns from './ControlBtns.vue'
import NavBar from './NavBar.vue'

</script>


<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.aside {
  // box-shadow: 0 0 5px rgba(0, 0, 0, .3);
  transition: @transition-normal;
  transition-property: background-color;
  // background-color: @color-theme-sidebar;
  // background-color: @color-aside-background;
  // border-right: 2px solid var(--color-primary);
  -webkit-app-region: drag;
  -webkit-user-select: none;
  display: flex;
  flex-flow: column nowrap;

  &.fullscreen {
    -webkit-app-region: no-drag;
    .logo {
      display: none;
    }
  }
}

.logo {
  box-sizing: border-box;
  padding: 4px 2px 0;
  height: 50px;
  // 字标用主色深一档而不是「主色 + 85% 透明」:透明合成的实测对比度 3.1:1,不达 4.5:1
  // (2026-10-25 UI 审查;token 按主题派生,不写死色值)
  color: var(--color-primary-dark-100);
  flex: none;
  text-align: center;
  display: flex;
  flex-flow: column nowrap;
  align-items: center;
  justify-content: center;
  // 左栏只有 @width-app-left（6.6%），两行小字才放得下
  white-space: nowrap;
  overflow: hidden;
  // -webkit-app-region: no-drag;
}
.logoBrand {
  // 10px 是检测器 undersized-ui-text 的判据线,+1px 仍放得下两行
  font-size: 11px;
  font-weight: bold;
  line-height: 1.2;
}
.logoSub {
  // 副行做字距展开的小字，像唱片厂牌的行标
  // 8px 同样过小;颜色 450 档对比度 ~2.5:1,提到 700 档(≈5.4:1),仍比主行浅
  font-size: 9px;
  letter-spacing: .18em;
  line-height: 1.4;
  color: var(--color-700);
}

</style>
