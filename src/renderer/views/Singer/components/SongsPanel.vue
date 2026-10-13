<template>
  <div :class="$style.container">
    <!-- 列表自带滚动（内部绝对定位 + 自滚动），父级给确定高度；
         「加载更多」钉在列表下方，不随列表滚走（与 components/common/QqFavList.vue 同形） -->
    <div :class="$style.listPane">
      <material-online-list
        :list="songs.list"
        :page="songs.page"
        :limit="songs.limit"
        :total="songs.list.length"
        :no-item="songs.noItemLabel"
        :list-id="queueListId()"
        check-api-source
        @play-list="handlePlaySongs"
      />
    </div>
    <div v-if="songs.hasMore" :class="$style.more">
      <base-btn min :disabled="songs.isLoading" @click="loadMoreSongs">{{ $t('singer__load_more') }}</base-btn>
    </div>
    <p v-if="songs.moreError" :class="$style.error">{{ songs.moreError }}</p>
  </div>
</template>

<script lang="ts">
import { ref, watch } from '@common/utils/vueTools'
import usePlay from '@renderer/components/material/OnlineList/usePlay'
import { singerSongsQueueId } from '@renderer/utils/queueIds'
import useSinger from '../useSinger'

/**
 * 歌手页 → 歌曲 tab（工单 02）。
 *
 * 取数全在 `useSinger.ts` 里：本组件只负责「切进来时判一次要不要取」（`ensureSongsTab`）
 * 与播放复用（`usePlay`）。分页器用不了（见 useSinger.ts 文件头第 3 条），翻页靠「加载更多」。
 */
export default {
  name: 'SingerSongsPanel',
  props: {
    mid: {
      type: String,
      default: '',
    },
  },
  setup(props: { mid: string }) {
    const { songs, ensureSongsTab, loadMoreSongs } = useSinger()

    // 懒加载入口：切进本 tab（含换歌手）时判一次要不要取；切回来已有缓存则不重复拉
    watch(() => props.mid, (mid) => { ensureSongsTab(mid) }, { immediate: true })

    /**
     * 队列身份（ui-polish-followups 工单 09）：本 tab 的列表 = 这个歌手的歌，
     * 所以用歌手的 mid（真实 id）。
     *
     * 写成函数、`listId` 用 getter，是因为这两个值都会在组件存活期间变：
     * 面板不按 mid 重建（`Singer/index.vue` 的 `songs-panel` 没有 key，换歌手只换 prop），
     * setup 时快照一个 id 会让第二个歌手仍用第一个歌手的队列身份。
     */
    const queueListId = () => singerSongsQueueId(props.mid)
    /**
     * 交给 usePlay 的「列表 + 队列身份」。
     *
     * - `list` 存的是**数组引用**（usePlay 播放时现读 `props.list`）：本块的写回一律
     *   `splice` / `push`（`useSinger.ts` 文件头第 2 条），引用一直有效；
     * - `listId` 用 getter 现算，理由见 `queueListId`。
     */
    const playProps = {
      list: songs.list,
      get listId() { return queueListId() },
    }

    // 播放复用在线列表的同一套逻辑（点单曲 = 从这首开始连播本列表，工单 06 方案 B）
    const selectedList = ref<LX.Music.MusicInfoOnline[]>([])
    const { handlePlayMusic } = usePlay({
      selectedList,
      props: playProps,
      removeAllSelect: () => { selectedList.value = [] },
      emit: () => {},
    })
    const handlePlaySongs = (index: number) => { void handlePlayMusic(index, true) }

    return {
      songs,
      queueListId,
      handlePlaySongs,
      loadMoreSongs,
    }
  },
}
</script>

<style lang="less" module>
@import './panels.less';

.container {
  height: 100%;
  display: flex;
  flex-flow: column nowrap;
}
// material-online-list 内部是绝对定位 + 自滚动，父级要给出确定的高度
.listPane {
  flex: auto;
  min-height: 0;
  position: relative;
}
// 列表会吃掉所有剩余高度，按钮本身不能再被压缩（卡片面板那边是跟在网格后面，不必 pin）
.morePinned {
  flex: none;
}
</style>
