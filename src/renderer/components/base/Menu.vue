<template>
  <teleport to="#root">
    <!-- inert(收起时):菜单收起只有 opacity+pointerEvents,不把子项移出 Tab 序——
         键盘会掉进看不见的菜单项(2026-10-25 UI 审查实机踩到);inert 连无障碍树一起摘,
         也不打断收起过渡(visibility:hidden 会瞬间裁掉淡出) -->
    <ul ref="dom_menu" :class="$style.list" :style="menuStyles" role="toolbar" :aria-hidden="!modelValue" :inert="!modelValue">
      <li
        v-for="item in menus"
        v-show="!item.hide"
        :key="item.action"
        :class="$style.listItem"
        role="tab"
        tabindex="0"
        :aria-label="item[itemName]"
        :disabled="item.disabled ? true : null"
        @click="menuClick(item)"
      >
        {{ item[itemName] }}
      </li>
    </ul>
  </teleport>
</template>

<script>
import { computed } from '@common/utils/vueTools'
import useMenuLocation from '@renderer/utils/compositions/useMenuLocation'

import { appSetting } from '@renderer/store/setting'


export default {
  name: 'MenuToolBar',
  props: {
    modelValue: {
      type: Boolean,
      required: true,
    },
    xy: {
      type: Object,
      required: true,
    },
    menus: {
      type: Array,
      default() {
        return []
      },
    },
    itemName: {
      type: String,
      default: 'name',
    },
  },
  emits: ['update:modelValue', 'menu-click'],
  setup(props, { emit }) {
    const visible = computed(() => props.modelValue)
    const location = computed(() => props.xy)

    const onHide = () => {
      emit('update:modelValue', false)
      menuClick(null)
    }

    const { dom_menu, menuStyles } = useMenuLocation({
      visible,
      location,
      onHide,
    })

    const menuClick = (item) => {
      if (item?.disabled) return
      emit('menu-click', item)
    }

    return {
      dom_menu,
      menuStyles,
      menuClick,
      appSetting,
    }
  },
}
</script>


<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.list {
  font-size: 12px;
  position: absolute;
  opacity: 0;
  transform: scale(0);
  transform-origin: 0 0 0;
  transition: .14s ease;
  transition-property: transform, opacity;
  border-radius: @radius-border;
  background-color: var(--color-content-background);
  box-shadow: 0 1px 8px 0 rgba(0,0,0,.2);
  z-index: 10;
  overflow: hidden;
  // will-change: transform;
}
.listItem {
  cursor: pointer;
  min-width: 96px;
  line-height: 34px;
  // color: var(--color-button-font);
  padding: 0 10px;
  text-align: center;
  outline: none;
  transition: @transition-normal;
  transition-property: background-color, opacity;
  box-sizing: border-box;
  .mixin-ellipsis-1();
  // background-color: var(--color-primary-light-600-alpha-800);

  &:hover {
    background-color: var(--color-primary-background-hover);
  }
  &:active {
    background-color: var(--color-primary-background-active);
  }

  &[disabled] {
    cursor: default;
    opacity: .4;
    &:hover {
      background: none !important;
    }
  }
}

</style>
