<template lang="pug">
.search(:class="$style.search")
  .form(:class="$style.form")
    //- 用 base-input 而不是 material-search-input：后者会挂全局「聚焦搜索框」快捷键、
    //- 还会读 search.isFocusSearchBox 自动聚焦（那是搜索页的语义，放设置页会抢焦点）
    base-input(
      :class="$style.input"
      :model-value="keyword" :placeholder="t('setting__search_placeholder')"
      @update:model-value="emit('update:keyword', $event)")
    button(
      v-if="keyword" type="button" :class="$style.clear"
      :aria-label="t('setting__search_clear')" :title="t('setting__search_clear')"
      @click="emit('update:keyword', '')")
      svg(:class="$style.clearIcon" version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" width="100%" viewBox="0 0 24 24" space="preserve")
        use(xlink:href="#icon-window-close")
  //- 关键词为空就不显示结果区：没输入 ≠ 无结果
  //- class="scroll"：结果多时自滚，滚动条走全局细条样式（同 Album/index.vue 的说明）
  ul.scroll(v-if="keyword" :class="$style.list")
    li(v-for="hit in hits" :key="hitKey(hit)")
      button(type="button" :class="$style.item" @click="emit('select', hit)") {{ hitLabel(hit) }}
    li(v-if="!hits.length" :class="$style.empty") {{ t('setting__search_no_result') }}
</template>

<script>
import { useI18n } from '@renderer/plugins/i18n'

export default {
  name: 'SettingSearchBox',
  props: {
    keyword: {
      type: String,
      default: '',
    },
    // useSettingSearch.ts 的 SearchHit[]（三级命中，同分支只留最深一条）
    hits: {
      type: Array,
      default: () => [],
    },
  },
  emits: ['update:keyword', 'select'],
  setup(props, { emit }) {
    const t = useI18n()

    // 结果行的路径：节 › 分组 › 项（节级/分组级命中少一段）
    const hitLabel = (hit) => [hit.sectionI18nKey, hit.groupI18nKey, hit.itemI18nKey]
      .filter(Boolean)
      .map(key => t(key))
      .join(' › ')

    // 列表 key：三级 id 拼起来，天然唯一（`''` 占位避免相邻两级撞串）
    const hitKey = (hit) => `${hit.sectionId}/${hit.groupId || ''}/${hit.itemId || ''}`

    return {
      t,
      emit,
      hitLabel,
      hitKey,
    }
  },
}
</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.search {
  flex: none;
  padding: 8px 10px 4px;
  // 根容器带左右 padding：不写 border-box 整块会比左栏宽出 2×padding（AGENTS §2.5.1 第 10 条）
  box-sizing: border-box;
}
.form {
  display: flex;
  flex-flow: row nowrap;
  align-items: center;
  // 清空按钮叠在输入框右侧（输入框让出按钮宽度）
  position: relative;
}
.input {
  width: 100%;
  padding-right: 26px;
}
.clear {
  position: absolute;
  right: 4px;
  top: 50%;
  transform: translateY(-50%);
  border: none;
  background: none;
  padding: 2px;
  width: 18px;
  height: 18px;
  color: var(--color-button-font);
  cursor: pointer;
  transition: @transition-fast;
  transition-property: color;

  &:hover {
    color: var(--color-primary);
  }
}
.clearIcon {
  width: 100%;
  height: 100%;
}
.list {
  margin: 6px 0 0;
  padding: 0;
  list-style: none;
  // 结果多时自己滚，别顶掉下面的左栏
  max-height: 50vh;
  overflow-y: auto;
}
.item {
  .mixin-ellipsis-2();
  display: block;
  width: 100%;
  padding: 6px;
  border: none;
  background: none;
  text-align: left;
  font-size: 12px;
  line-height: 1.4;
  color: var(--color-font);
  cursor: pointer;
  transition: @transition-fast;
  transition-property: background-color, color;

  &:hover {
    background-color: var(--color-button-background-hover);
    color: var(--color-primary);
  }
}
.empty {
  padding: 6px;
  font-size: 12px;
  color: var(--color-font-label);
}
</style>
