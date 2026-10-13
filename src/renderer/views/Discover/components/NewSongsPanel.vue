<template>
  <div :class="$style.container">
    <!-- 新歌：一次一批，切地区 = 重拉（没有页码语义） -->
    <div :class="$style.sectionHeader">
      <base-tab v-model="type" :class="$style.tabs" :list="typeTabs" item-key="type" @change="switchNewSongType" />
    </div>
    <div :class="$style.songList">
      <material-online-list
        :list="newSongs.list"
        :page="newSongs.page"
        :limit="newSongs.limit"
        :total="newSongs.total"
        :no-item="newSongs.noItemLabel"
        :list-id="queueListId()"
        check-api-source
        @play-list="handlePlayList"
      />
    </div>
  </div>
</template>

<script lang="ts">
import { ref } from '@common/utils/vueTools'
import usePlay from '@renderer/components/material/OnlineList/usePlay'
import { newSongsQueueId } from '@renderer/utils/queueIds'
import useNewSongsTab from '../useNewSongsTab'

/** 发现页 → 新歌 Tab：按地区切一批。 */
export default {
  name: 'DiscoverNewSongsPanel',
  setup() {
    const { newSongs, typeTabs, initNewSongsTab, switchNewSongType } = useNewSongsTab()

    void initNewSongsTab()

    /**
     * 队列身份（ui-polish-followups 工单 09）：本列表 = 「新歌 · 当前地区」这一串。
     *
     * 地区 tab 就在本组件里切（base-tab），内容和身份都跟着 `newSongs.type` 变——所以身份里
     * 带上 type、并且**现算**（`listId` 用 getter，不取 setup 时的快照），否则换地区后点歌
     * 仍用上一个地区的队列身份（随机/上一首会串到上一个地区）。
     */
    const queueListId = () => newSongsQueueId(newSongs.type)
    /**
     * 交给 usePlay 的「列表 + 队列身份」。
     *
     * - `list` 存的是**数组引用**：本块的写回一律 `splice`（`useNewSongsTab.ts` 的 `setSongs`），
     *   引用一直有效（usePlay 播放时现读 `props.list`）；
     * - `listId` 用 getter 现算，理由见 `queueListId`。
     */
    const playProps = {
      list: newSongs.list,
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
    const handlePlayList = (index: number) => { void handlePlayMusic(index, true) }

    // 地区 tab 的 v-model 与区块状态分开：加载中不该被外部改掉
    const type = ref(newSongs.type)

    return {
      newSongs,
      type,
      typeTabs: typeTabs(),
      switchNewSongType,
      queueListId,
      handlePlayList,
    }
  },
}
</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.container {
  height: 100%;
  box-sizing: border-box;
  color: var(--color-font);
  display: flex;
  flex-flow: column nowrap;
}

.sectionHeader {
  flex: none;
  display: flex;
  align-items: center;
}
// base-tab 自带 15px 内边距，这里抵消掉，让 tab 与内容左对齐
.tabs {
  margin: 0 -15px 4px 0;
}

// material-online-list 内部是绝对定位，父级给确定高度
.songList {
  flex: auto;
  min-height: 0;
  position: relative;
}
</style>
