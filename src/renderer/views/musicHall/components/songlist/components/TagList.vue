<template>
  <div :class="[$style.tagList, {[$style.active]: popupVisible}]">
    <div ref="dom_btn" :class="$style.label" @click.stop="handleShow">
      <span>{{ tagName }}</span>
      <div :class="$style.icon">
        <svg version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" height="100%" viewBox="0 0 451.847 451.847" space="preserve">
          <use xlink:href="#icon-down" />
        </svg>
      </div>
    </div>
    <div :class="$style.popup" :style="popupStyle" :aria-hidden="!popupVisible" @click.stop>
      <div :class="$style.list" class="scroll">
        <div :class="$style.tag" @click="handleToggleTag('')">{{ $t('default') }}</div>
        <!-- 标签取不到时不能只留空白：复用既有的 list__load_failed（store 的歌单/榜单两处同款），不自造新 key -->
        <div v-if="isLoadFailed" :class="$style.loadFailed">
          {{ $t('list__load_failed') }}
          <button type="button" :class="$style.retryBtn" @click="loadTags(source)">{{ $t('list__retry') }}</button>
        </div>
        <dl v-for="tagInfo in list" :key="tagInfo.name">
          <dt :class="$style.type">{{ tagInfo.name }}</dt>
          <dd v-for="tag in tagInfo.list" :key="tag.id" :class="$style.tag" @click="handleToggleTag(tag.id)">{{ tag.name }}</dd>
        </dl>
      </div>
    </div>
  </div>
</template>

<script setup>
import { watch, shallowReactive, ref, onMounted, onBeforeUnmount, computed, reactive } from '@common/utils/vueTools'
import { setTags, getTags } from '@renderer/store/songList/action'
import { tags } from '@renderer/store/songList/state'
import { useRouter, useRoute } from '@common/utils/vueRouter'
import { useI18n } from '@renderer/plugins/i18n'

const props = defineProps({
  source: {
    type: String,
    required: true,
  },
  tagId: {
    type: String,
    required: true,
  },
  sortId: {
    type: [String, undefined],
    default: undefined,
  },
})

const router = useRouter()
const route = useRoute()
const t = useI18n()

const list = shallowReactive([])
const isLoadFailed = ref(false)
const handleToggleTag = (id) => {
  // 保留 route.query 里其它键（`tab` 是乐馆的 Tab，丢了就跳回排行榜），并复位到第 1 页
  void router.replace({
    path: route.path,
    query: {
      ...route.query,
      source: props.source,
      tagId: id,
      sortId: props.sortId,
      page: 1,
    },
  })
  handleHide()
}
// 取数从 watch 体里提出来:失败态的「重试」键(2026-10-25 UI 审查 P1)与 watch 走同一条路
const loadTags = async(source) => {
  if (!source) return
  // const source = (await getLeaderboardSetting()).source as LX.OnlineSource
  let tagInfo = tags[source]
  // console.log(await getTags(source))
  if (tagInfo == null) {
    try {
      tagInfo = await getTags(source)
    } catch (err) {
      // 取标签失败原来只会在控制台留一行：标签下拉永远空白、用户看不出是失败还是没数据。
      // 这里收口 rejection（别漏到顶层弹全屏浮层，票 03b）并落一条可读文案，见模板的 isLoadFailed。
      console.log('[songlist] 获取歌单标签失败', err)
      isLoadFailed.value = true
      return
    }
    if (!tagInfo?.tags?.length) {
      console.log('[songlist] 歌单标签为空', source)
      isLoadFailed.value = true
      return
    }
    setTags(tagInfo, source)
  }
  isLoadFailed.value = false

  list.splice(0, list.length, ...[{ name: window.i18n.t('songlist__tag_info_hot_tag'), list: [...tagInfo.hotTag] }, ...tagInfo.tags])
}

watch(() => props.source, source => {
  void loadTags(source)
}, {
  immediate: true,
})
const tagName = computed(() => {
  if (!props.tagId) return t('default')
  for (const tags of list) {
    const tag = tags.list.find(t => t.id == props.tagId)
    if (tag) return tag.name
  }
  return props.tagId
})

const popupStyle = reactive({
  width: '645px',
  maxHeight: '250px',
})

let popupWidthTimer = 0
const setTagPopupWidth = () => {
  // 每次重排（含 resize）先清掉上一枚，别让它们叠着排队；卸载时也要取消——
  // 回调漏到卸载之后就是未捕获异常（jsdom 里没有 #view，CI 上红过）
  window.clearTimeout(popupWidthTimer)
  popupWidthTimer = window.setTimeout(() => {
    const dom_view = document.getElementById('view')
    // #view 是应用根容器（App.vue），组件卸载 / 测试环境里都不在，读它之前先判空
    if (dom_view == null) return
    popupStyle.width = dom_view.clientWidth * 0.96 + 'px'
    popupStyle.maxHeight = dom_view.clientHeight * 0.65 + 'px'
  }, 50)
}

const dom_btn = ref<HTMLElement | null>(null)
const popupVisible = ref(false)
const handleShow = () => popupVisible.value = !popupVisible.value
const handleHide = (evt) => {
  // if (e && e.target.parentNode != this.$refs.dom_popup && this.show) return this.show = false
  // console.log(this.$refs)
  if (evt && (evt.target == dom_btn.value || dom_btn.value?.contains(evt.target))) return
  popupVisible.value = false
}


onMounted(() => {
  setTagPopupWidth()
  document.addEventListener('click', handleHide)
  window.addEventListener('resize', setTagPopupWidth)
})

onBeforeUnmount(() => {
  window.clearTimeout(popupWidthTimer)
  document.removeEventListener('click', handleHide)
  window.removeEventListener('resize', setTagPopupWidth)
})

</script>


<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.tagList {
  font-size: 12px;
  position: relative;

  &.active {
    .label {
      .icon {
        svg{
          transform: rotate(180deg);
        }
      }
    }
    .popup {
      opacity: 1;
      transform: scale(1);
      pointer-events: initial;
    }
  }
}

.label {
  padding: 8px 15px;
  // background-color: var(--color-button-background);
  transition: color @transition-normal;
  // border-top: 2px solid @color-tab-border-bottom;
  // border-left: 2px solid @color-tab-border-bottom;
  box-sizing: border-box;
  text-align: center;
  // border-top-left-radius: 3px;
  color: var(--color-font);
  cursor: pointer;

  display: flex;

  span {
    flex: auto;
  }
  .icon {
    flex: none;
    margin-left: 7px;
    line-height: 0;
    svg {
      width: .8em;
      transition: transform .2s ease;
      transform: rotate(0);
    }
  }

  &:hover {
    color: var(--color-primary-font-hover);
  }
  &:active {
    color: var(--color-primary-font-active);
  }
}

.popup {
  position: absolute;
  top: 100%;
  width: 645px;
  left: 8px;
  margin-top: 12px;
  border-radius: 4px;
  background-color: var(--color-content-background);
  opacity: 0;
  transform: scale(.95, .8);
  transform-origin: 0 0 0;
  transition: .25s ease;
  transition-property: transform, opacity;
  max-height: 250px;
  z-index: 10;
  pointer-events: none;
  filter: drop-shadow(0px 0px 4px rgba(0, 0, 0, .15));
  display: flex;

  &:before {
    content: " ";
    position: absolute;
    top: -6px;
    left: 20px;
    width: 0;
    height: 0;
    border-left: 8px solid transparent;
    border-right: 8px solid transparent;
    border-bottom: 8px solid var(--color-content-background);
  }
}
.list {
  padding: 10px;
  box-sizing: border-box;
  // box-shadow: 0 0 4px rgba(0, 0, 0, .2);
}

// 取标签失败时的可读文案（与 store 的 list__load_failed 同款；别让下拉只剩一个「默认」标签）
.loadFailed {
  padding: 12px 5px 4px;
  color: var(--color-font-label);
}
.retryBtn {
  display: block;
  margin: 8px auto 10px;
  padding: 4px 18px;
  border: 1px solid var(--color-primary-alpha-900);
  border-radius: 3px;
  background-color: transparent;
  color: var(--color-primary-font);
  cursor: pointer;
  transition: @transition-fast;
  transition-property: background-color, color;

  &:hover {
    background-color: var(--color-button-background-hover);
  }
}

.type {
  padding-top: 10px;
  padding-bottom: 3px;
  color: var(--color-font-label);
}

.tag {
  display: inline-block;
  margin: 5px;
  background-color: var(--color-button-background);
  padding: 8px 10px;
  border-radius: @radius-progress-border;
  transition: background-color @transition-normal;
  cursor: pointer;
  &:hover {
    background-color: var(--color-button-background-hover);
  }
  &:active {
    background-color: var(--color-button-background-active);
  }
}

</style>
