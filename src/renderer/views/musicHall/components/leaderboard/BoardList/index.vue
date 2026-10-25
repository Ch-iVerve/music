<template>
  <ul ref="dom_lists_list" class="scroll" :class="$style.listsContent">
    <!-- 榜单列表取不到时不能只留空左栏：复用既有的 list__load_failed（store 的歌单/榜单两处同款），不自造新 key -->
    <li v-if="isLoadFailed" :class="$style.loadFailed">
      {{ $t('list__load_failed') }}
      <button type="button" :class="$style.retryBtn" @click="loadBoards(source)">{{ $t('list__retry') }}</button>
    </li>
    <li
      v-for="(item, index) in list"
      :key="item.id" :class="[$style.listsItem, { [$style.active]: item.id == boardId }, { [$style.clicked]: rightClickItemIndex == index }]"
      :aria-label="item.name" @click="handleToggleList(item.id)" @contextmenu="handleRigthClick($event, index)"
    >
      <span :class="$style.listsLabel">
        <transition name="list-active">
          <svg-icon v-if="item.id == boardId" name="angle-right-solid" :class="$style.activeIcon" />
        </transition>
        {{ item.name }}
      </span>
    </li>
  </ul>
  <base-menu
    v-model="isShowMenu"
    :menus="menus"
    :xy="menuLocation"
    item-name="name"
    @menu-click="handleMenuClick"
  />
</template>

<script setup>
import { watch, shallowReactive, ref } from '@common/utils/vueTools'
import { getBoardsList, setBoard } from '@renderer/store/leaderboard/action'
import { boards } from '@renderer/store/leaderboard/state'
import useMenu from './useMenu'
import { useRouter, useRoute } from '@common/utils/vueRouter'

const props = defineProps({
  source: {
    type: String,
    required: true,
  },
  boardId: {
    type: [String, undefined],
    default: undefined,
  },
})

const emit = defineEmits(['show-menu'])

const router = useRouter()
const route = useRoute()

const list = shallowReactive([])
const isLoadFailed = ref(false)
const rightClickItemIndex = ref(-1)

const handleToggleList = (id) => {
  // 保留 route.query 里其它键（`tab` 是乐馆的 Tab，丢了就跳回排行榜）
  void router.replace({
    path: route.path,
    query: {
      ...route.query,
      source: props.source,
      boardId: id,
    },
  })
}

const {
  menus,
  menuLocation,
  isShowMenu,
  showMenu,
  menuClick,
} = useMenu({ emit, list })

const handleRigthClick = (event, index) => {
  rightClickItemIndex.value = index
  showMenu(event, index)
}
const handleMenuClick = (action) => {
  if (rightClickItemIndex.value < 0) return
  let index = rightClickItemIndex.value
  rightClickItemIndex.value = -1
  menuClick(action, index, props.source)
}


// 取数从 watch 体里提出来:失败态的「重试」键(2026-10-25 UI 审查 P1)与 watch 走同一条路
const loadBoards = async(source) => {
  // const source = (await getLeaderboardSetting()).source as LX.OnlineSource
  let boardList = boards[source]
  if (boardList == null) {
    try {
      boardList = await getBoardsList(source)
    } catch (err) {
      // 取榜单失败原来只会在控制台留一行：左栏全空、用户看不出是失败还是没数据。
      // 这里收口 rejection（别漏到顶层弹全屏浮层，票 03b）并落一条可读文案，见模板的 isLoadFailed。
      console.log('[leaderboard] 获取榜单列表失败', err)
      isLoadFailed.value = true
      return
    }
    if (!boardList?.list?.length) {
      // 数据层取不到时会回退内置清单，正常不会走到这里；真走到了也按失败态给文案，别留空白左栏
      console.log('[leaderboard] 榜单列表为空', source)
      isLoadFailed.value = true
      return
    }
    setBoard(boardList, source)
  }
  isLoadFailed.value = false
  list.splice(0, list.length, ...boardList.list)
  if (!props.boardId && boardList.list.length) handleToggleList(boardList.list[0].id)
}

watch(() => props.source, source => {
  void loadBoards(source)
}, {
  immediate: true,
})

defineExpose({ hideMenu: handleMenuClick })

</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.listsContent {
  flex: auto;
  min-width: 0;
  overflow-y: scroll;
  // overflow-y: scroll !important;
  // border-right: 1px solid rgba(0, 0, 0, 0.12);
}
// 取榜单失败时的可读文案（与 store 的 list__load_failed 同款；别让左栏只剩空白）
.loadFailed {
  padding: 15px 10px;
  font-size: 13px;
  text-align: center;
  color: var(--color-font-label);
}
.retryBtn {
  display: block;
  margin: 10px auto 0;
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
.listsItem {
  position: relative;
  transition: .3s ease;
  transition-property: color, background-color;
  background-color: transparent;
  &:hover:not(.active) {
    background-color: var(--color-primary-background-hover);
    cursor: pointer;
  }
  &.active {
    // background-color:
    color: var(--color-primary);
  }
  &.selected {
    background-color: var(--color-primary-font-active);
  }
  &.clicked {
    background-color: var(--color-primary-background-hover);
  }
  &.editing {
    padding: 0 10px;
    background-color: var(--color-primary-background-hover);
    .listsLabel {
      display: none;
    }
    .listsInput {
      display: block;
    }
  }
}
.activeIcon {
  height: .9em;
  width: .9em;
  margin-left: -0.45em;
  vertical-align: -0.05em;
}
.listsLabel {
  display: block;
  height: 100%;
  padding: 0 10px;
  font-size: 13px;
  line-height: 36px;
  .mixin-ellipsis-1();
}


</style>

