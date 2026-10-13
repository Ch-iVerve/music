<template>
  <div :class="$style.container">
    <div :class="$style.listPane">
      <material-online-list
        :class="$style.list"
        :list="dislikedSongs.list"
        :no-item="noItemLabel"
        :page="1"
        :limit="dislikedSongs.list.length || 1"
        :total="dislikedSongs.list.length"
        :list-id="DISLIKE_SONGS_QUEUE_ID"
        check-api-source
        show-remove-btn
        :remove-label="$t('favorites__remove_dislike')"
        @play-list="handlePlay"
        @remove-music="handleRemove"
      />
    </div>
  </div>
</template>

<script lang="ts">
import { computed, ref } from '@common/utils/vueTools'
import { dialog } from '@renderer/plugins/Dialog'
import useOnlinePlay from '@renderer/components/material/OnlineList/usePlay'
import { DISLIKE_SONGS_QUEUE_ID } from '@renderer/utils/queueIds'
import { dislikedSongs, loadDislikedSongs, removeDislikedSong } from './useDislikeSongs'

/**
 * 我的收藏 → 不喜欢：QQ 账号里那份**云端不喜欢列表**（数据类功能票 02）。
 *
 * 落点理由（与歌单 / 专辑 / 歌手三个 Tab 并列）：它同属「账号里的云端数据」，
 * 别处没有更自然的入口；而本地的「不喜欢」（`core/dislikeList`，按歌名+歌手拦播放）是另一回事，
 * 别把两者做成同一块界面。
 *
 * 写操作只有「移出不喜欢」（二次确认，照 `SongsPanel` 的取消喜欢先例）；
 * **加入不在这里**——票 05 起挂在「屏蔽播放」动作上（各处菜单 / 快捷键 / 雷达对在线歌顺带写云端，
 * 见 `core/dislikeList.ts` 的 `addDislikeWithCloud`），本页只管查看与移出。
 */

/*
 * 播放队列的身份（同 `SongsPanel` 的收藏队列）：宿主两条播放入口与 `material-online-list`
 * 必须用**同一个值**，否则「正在播放那一行」认不出来。字面量的家在 `utils/queueIds.ts`（票 06 M3）。
 */

export default {
  name: 'FavoritesDislikePanel',
  setup() {
    const t = (key: string, params?: any) => window.i18n.t(key as any, params)

    // 进 tab 就拉（切 tab 会重建本组件，所以每次回来都是新的一份；详情那部分有缓存）
    void loadDislikedSongs()

    // `no-item` 同时是 material-online-list 的**容器显隐开关**，数据正常时必须给空串
    // （取数组合式函数已保证：成功时置空；这里只补「成功但为空」时的 no_item，与 SongsPanel 同款）
    const noItemLabel = computed(() => dislikedSongs.noItemLabel || (dislikedSongs.list.length ? '' : t('no_item')))

    const selectedList = ref<LX.Music.MusicInfoOnline[]>([])
    const { handlePlayMusic } = useOnlinePlay({
      selectedList,
      props: { list: dislikedSongs.list, listId: DISLIKE_SONGS_QUEUE_ID },
      removeAllSelect: () => { selectedList.value = [] },
      emit: () => {},
    })
    const handlePlay = (index: number) => {
      void handlePlayMusic(index, true)
    }

    // 移出不喜欢：行内按钮 → 二次确认 → 写 QQ（失败给出明确提示，不静默）
    const handleRemove = async(index: number) => {
      const musicInfo = dislikedSongs.list[index]
      if (musicInfo == null) return
      const confirm = await dialog.confirm({
        message: t('favorites__remove_dislike_tip', { name: musicInfo.name }),
        confirmButtonText: t('favorites__remove_dislike'),
      })
      if (!confirm) return
      try {
        await removeDislikedSong(musicInfo)
      } catch (err: any) {
        void dialog({
          message: err?.message || String(err),
          type: 'error',
        })
      }
    }

    return {
      DISLIKE_SONGS_QUEUE_ID,
      dislikedSongs,
      noItemLabel,
      handlePlay,
      handleRemove,
    }
  },
}
</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.container {
  height: 100%;
  display: flex;
  flex-flow: column nowrap;
}
// material-online-list 内部是「绝对定位 + 自滚动」，父级必须给出确定高度
.listPane {
  flex: auto;
  min-height: 0;
  position: relative;
}
.list {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
}
</style>
