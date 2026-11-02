<template>
  <div :class="$style.container">
    <div :class="[$style.search, {[$style.active]: isActive}, {[$style.big]: big}, {[$style.small]: small}]">
      <div :class="$style.inputRow">
        <div :class="$style.inputWrap">
          <input
            ref="dom_input"
            v-model.trim="text"
            :placeholder="placeholder || $t('search__placeholder')"
            @focus="handleFocus"
            @blur="handleBlur"
            @input="$emit('update:modelValue', text)"
            @change="sendEvent('change')"
            @keyup.enter="handleSearch"
            @keydown.arrow-down.arrow-up.prevent
            @keyup.arrow-down.prevent="handleKeyDown"
            @keyup.arrow-up.prevent="handleKeyUp"
            @contextmenu="handleContextMenu"
          >
          <transition enter-active-class="animated zoomIn" leave-active-class="animated zoomOut">
            <button v-show="text" type="button" :class="$style.clearBtn" @click="handleClearList">
              <svg version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" height="100%" viewBox="0 0 24 24" space="preserve">
                <use xlink:href="#icon-window-close" />
              </svg>
            </button>
          </transition>
        </div>
        <button type="button" :class="$style.searchBtn" @click="handleSearch">
          <slot>
            <svg version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" height="100%" viewBox="0 0 30.239 30.239" space="preserve">
              <use xlink:href="#icon-search" />
            </svg>
          </slot>
        </button>
      </div>
      <div v-if="list.length" :class="$style.list">
        <p v-if="listTitle" :class="$style.title">{{ listTitle }}</p>
        <ul :class="{[$style.numbered]: numbered}" @mouseleave="selectIndex = -1">
          <li
            v-for="(item, index) in list"
            :key="item"
            :class="{[$style.select]: selectIndex === index }"
            @mouseenter="selectIndex = index"
            @click="handleTemplistClick(index)"
          >
            <em v-if="numbered" :class="$style.rank">{{ index + 1 }}</em>
            <span>{{ item }}</span>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>

<script>
import { clipboardReadText } from '@common/utils/electron'
import { HOTKEY_COMMON } from '@common/hotKey'
import { appSetting } from '@renderer/store/setting'

export default {
  props: {
    placeholder: {
      type: String,
      // 空=回退 i18n(见模板)。写死英文串会让 zh-CN 顶栏出现英文占位(2026-10-25 UI 审查 P2)
      default: '',
    },
    list: {
      type: Array,
      default() {
        return []
      },
    },
    visibleList: {
      type: Boolean,
      default: false,
    },
    modelValue: {
      type: String,
      default: '',
    },
    // 热搜榜形态:条目带排名序号、双列排布(空词聚焦时的下拉形态)
    numbered: {
      type: Boolean,
      default: false,
    },
    listTitle: {
      type: String,
      default: '',
    },
    big: {
      type: Boolean,
      default: false,
    },
    small: {
      type: Boolean,
      default: false,
    },
  },
  emits: ['update:modelValue', 'event'],
  data() {
    return {
      text: '',
      selectIndex: -1,
      focus: false,
    }
  },
  computed: {
    isActive() {
      return this.focus || (this.visibleList && this.list.length > 0)
    },
  },
  watch: {
    list() {
      if (this.selectIndex > -1) this.selectIndex = -1
    },
    modelValue(n) {
      this.text = n
    },
  },
  mounted() {
    if (appSetting['search.isFocusSearchBox']) this.handleFocusInput()
    this.handleRegisterEvent('on')
  },
  beforeUnmount() {
    this.handleRegisterEvent('off')
  },
  methods: {
    handleRegisterEvent(action) {
      let eventHub = window.key_event
      let name = action == 'on' ? 'on' : 'off'
      // eslint-disable-next-line @typescript-eslint/unbound-method
      eventHub[name](HOTKEY_COMMON.focusSearchInput.action, this.handleFocusInput)
    },
    handleFocusInput() {
      this.$refs.dom_input.focus()
    },
    handleTemplistClick(index) {
      this.sendEvent('listClick', index)
    },
    handleFocus() {
      this.focus = true
      this.sendEvent('focus')
    },
    handleBlur() {
      setTimeout(() => {
        this.focus = false
        this.sendEvent('blur')
      }, 80)
    },
    handleSearch() {
      if (this.selectIndex < 0) {
        this.sendEvent('submit')
        return
      }
      this.sendEvent('listClick', this.selectIndex)
    },
    sendEvent(action, data) {
      this.$emit('event', {
        action,
        data,
      })
    },
    handleKeyDown() {
      if (this.list.length) {
        this.selectIndex = this.selectIndex + 1 < this.list.length ? this.selectIndex + 1 : 0
      } else if (this.selectIndex > -1) {
        this.selectIndex = -1
      }
    },
    handleKeyUp() {
      if (this.list.length) {
        this.selectIndex = this.selectIndex - 1 < -1 ? this.list.length - 1 : this.selectIndex - 1
      } else if (this.selectIndex > -1) {
        this.selectIndex = -1
      }
    },
    handleContextMenu() {
      let str = clipboardReadText()
      str = str.trim()
      str = str.replace(/\t|\r\n|\n|\r/g, ' ')
      str = str.replace(/\s+/g, ' ')
      let dom_input = this.$refs.dom_input
      this.text = this.text.substring(0, dom_input.selectionStart) + str + this.text.substring(dom_input.selectionEnd, this.text.length)
      this.$emit('update:modelValue', this.text)
    },
    handleClearList() {
      this.text = ''
      this.$emit('update:modelValue', this.text)
      this.sendEvent('submit')
    },
  },
}
</script>


<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

@search-radius: 10px;

.container {
  position: relative;
  width: 35%;
  height: @height-toolbar * 0.52;
  -webkit-app-region: no-drag;
}

.search {
  position: absolute;
  width: 100%;
  // 不设 overflow:hidden:下拉面板是浮层,要露出容器

  .inputRow {
    display: flex;
    flex-flow: row nowrap;
    height: @height-toolbar * 0.52;
    border-radius: @search-radius;
    background-color: var(--color-primary-light-300-alpha-700);
    // 圆角裁切统一交给行容器:按钮 hover 底色不用自己描圆角,避免与胶囊圆角拼接露馅
    // (下拉面板是本行的兄弟节点,不受裁切影响)
    overflow: hidden;
    transition: background-color @transition-normal;
  }

  .inputWrap {
    flex: auto;
    display: flex;
    align-items: center;
    min-width: 0;
    border-radius: @search-radius;
    border: 1px solid transparent;
    // 同 inputRow:内部清除键的 hover 底色交由本层裁切,不自带圆角
    overflow: hidden;
    transition: background-color @transition-normal, border-color @transition-normal, box-shadow @transition-normal;
  }

  input {
    flex: auto;
    min-width: 0;
    background-color: transparent;
    border: none;
    outline: none;
    padding: 0 5px 0 14px;
    overflow: hidden;
    font-size: 13.5px;
    line-height: @height-toolbar * 0.52 + 5px;
    // 文本框任意方式聚焦都命中全局 :focus-visible(index.less),会在裸 input 外再画一圈
    // 2px+2px offset 的框,与本组件的描边环叠成双层——聚焦指示由容器统一承担,此处压掉
    &:focus-visible {
      outline: none !important;
    }
    &::placeholder {
      color: var(--color-button-font);
      font-size: .98em;
    }
  }

  .clearBtn,
  .searchBtn {
    flex: none;
    border: none;
    background-color: transparent;
    outline: none;
    cursor: pointer;
    height: 100%;
    padding: 4px 9px;
    color: var(--color-button-font);
    // 四角同一圆角:未聚焦时被 inputRow 裁成胶囊端部;聚焦悬浮在框外时是完整圆角块
    border-radius: @search-radius;
    transition: background-color .2s ease;

    &:hover {
      background-color: var(--color-button-background-hover);
    }
    &:active {
      background-color: var(--color-button-background-active);
    }
  }

  // 聚焦形态(参考 bilibili 搜索框):胶囊背景退场,输入区自带深色底 + 2px 主色描边环,
  // 放大镜露在框外右侧
  &.active {
    .inputRow {
      background-color: transparent;
    }
    .inputWrap {
      background-color: var(--color-primary-light-600-alpha-100);
      border-color: var(--color-primary-alpha-200);
      box-shadow: 0 0 0 1px var(--color-primary-alpha-200);
    }
  }

  // 下拉面板:独立浮层(留缝、圆角、投影),不再是输入框的延伸
  .list {
    position: absolute;
    top: @height-toolbar * 0.52 + 6px;
    left: 0;
    right: 0;
    background-color: var(--color-main-background);
    border-radius: @search-radius;
    box-shadow: 0 4px 14px rgba(0, 0, 0, .25);
    padding: 4px 0 6px;
    font-size: 13px;
    opacity: 0;
    transform: translateY(-4px);
    transition: opacity .18s ease, transform .18s ease;
    pointer-events: none;

    .title {
      margin: 0;
      padding: 8px 14px 4px;
      font-size: 12px;
      color: var(--color-font-label);
    }

    ul {
      margin: 0;
      padding: 0;
      list-style: none;

      &.numbered {
        display: grid;
        grid-template-columns: 1fr 1fr;
        column-gap: 8px;
      }
    }

    li {
      cursor: pointer;
      display: flex;
      align-items: center;
      padding: 7px 14px;
      line-height: 1.3;
      transition: background-color .2s ease;

      .rank {
        flex: none;
        width: 1.8em;
        font-style: normal;
        font-size: 12px;
        color: var(--color-font-label);
      }

      span {
        flex: auto;
        min-width: 0;
        .mixin-ellipsis-1();
      }

      &.select {
        background-color: var(--color-primary-background-active);
      }
    }
  }

  &.active .list {
    opacity: 1;
    transform: translateY(0);
    pointer-events: auto;
  }
}

.big {
  width: 100%;

  .inputRow {
    height: 30px;
  }

  input {
    padding-left: 10px;
  }

  .searchBtn {
    padding: 4px 10px;
  }
}


</style>
