<template>
  <div :class="$style.container">
    <!-- 只有一路：QQ 音乐的「我喜欢」（云端 dirId=201）。本地收藏已取消——收藏只写云端，
         所以这里不再有本地/云端来源切换，`?favSource=` 也不再被读取（2026-09-24）。 -->
    <qq-fav-list
      :list="favSongs.list"
      :no-item="cloudFavNoItem"
      :page="favSongs.page"
      :limit="favSongs.total || favSongs.limit"
      :total="favSongs.total"
      :list-id="FAV_SONGS_QUEUE_ID"
      @play-list="handlePlayFav"
      @load-more="handleLoadMoreFav"
      @unlove="handleUnloveFav"
    />
    <!-- 加载更多失败：独立提示位（有数据时不能塞进 `no-item`——那是列表的显隐开关） -->
    <p v-if="moreError" :class="$style.error" v-text="moreError" />
  </div>
</template>

<script lang="ts">
import { computed, ref, watch } from '@common/utils/vueTools'
import { favSongs, labels as userLabels } from '@renderer/store/user/state'
import { loadFavSongs, loadMoreFavSongs, moreErrorLabelOf, noItemLabelOf, removeFavSongFromCloud } from '@renderer/store/user/action'
import { status } from '@renderer/store/qqAuth/state'
import { dialog } from '@renderer/plugins/Dialog'
import useOnlinePlay from '@renderer/components/material/OnlineList/usePlay'
import { FAV_SONGS_QUEUE_ID } from '@renderer/utils/queueIds'
import QqFavList from '@renderer/components/common/QqFavList.vue'

/**
 * 我的收藏 → 我收藏的歌曲。
 *
 * 内容就是 QQ 音乐的「我喜欢」（云端 dirId=201）：2026-09-24 起本地收藏取消，
 * 这一块不再并列展示本地 love 列表（它的数据行仍在，只是界面不再有入口）。
 * 「试听列表」更早退场（工单 07 / ADR 0006）——所以本页没有左栏，`?list=` 也不被读取。
 *
 * 队列身份 `FAV_SONGS_QUEUE_ID`（ui-polish-followups 工单 09 起用自造稳定标识而不用云端
 * dirId=201——那是数据层内部常量，且「我喜欢」全应用只有这一串）；字面量的家已收到
 * `utils/queueIds.ts`（票 06 M3），宿主与 `QqFavList` 透传的那个值从同一处取。
 */

export default {
  name: 'FavoritesSongsPanel',
  components: {
    QqFavList,
  },
  setup() {
    const t = (key: string, params?: any) => window.i18n.t(key as any, params)

    // 未登录时 loadFavSongs 会落「请先登录 QQ 音乐」文案（它认的就是凭证层抛的
    // `QQ 音乐未登录`），所以这里不自己判登录态——那个状态目前只在「设置」页初始化过。
    // ⚠️ `no-item` 在 material-online-list 里同时是**列表容器的显隐开关**（`v-show="!noItem"`），
    // 所以「一切正常」时必须给空串；恒给非空值会让列表永远被藏起来。
    // 有数据时也给空串：一次「加载更多」失败不该把已加载的整页藏掉（失败文案见下面的 moreError）。
    const cloudFavNoItem = computed(() => noItemLabelOf(userLabels.favSongs, favSongs.list.length > 0))

    // 进页面就拉（切 tab 会重建本组件，所以每次回来都是新的一份）：
    // 重复进页面就重拉，loadFavSongs 不受 initUserCenter 的 isInited 守卫约束
    void loadFavSongs()

    // 登录信号到达就重拉（照 `views/friends/useUserList.ts` 的 watch）：未登录时进过这一页
    // 只落了「请先登录」，不在别处登录后自动补一次就会一直停在那句话上
    watch(() => status.isLogin, (isLogin) => {
      if (isLogin) void loadFavSongs()
    })

    const moreError = computed(() => moreErrorLabelOf(userLabels.favSongs, favSongs.list.length > 0))

    const selectedCloudList = ref<LX.Music.MusicInfoOnline[]>([])
    const { handlePlayMusic: handlePlayCloudMusic } = useOnlinePlay({
      selectedList: selectedCloudList,
      // 队列身份与上面那个 :list-id 是同一个（工单 09）
      props: { list: favSongs.list, listId: FAV_SONGS_QUEUE_ID },
      removeAllSelect: () => { selectedCloudList.value = [] },
      emit: () => {},
    })
    const handlePlayFav = (index: number) => {
      void handlePlayCloudMusic(index, true)
    }
    const handleLoadMoreFav = () => {
      void loadMoreFavSongs()
    }
    // 取消喜欢：行内「取消喜欢」按钮 → 二次确认 → 写 QQ（失败给出明确提示，不静默）
    const handleUnloveFav = async(index: number) => {
      const musicInfo = favSongs.list[index]
      if (musicInfo == null) return
      const confirm = await dialog.confirm({
        message: t('list_unlove__tip', { name: musicInfo.name }),
        confirmButtonText: t('list__unlove'),
      })
      if (!confirm) return
      try {
        await removeFavSongFromCloud(musicInfo)
      } catch (err: any) {
        void dialog({
          message: err?.message || String(err),
          type: 'error',
        })
      }
    }

    return {
      FAV_SONGS_QUEUE_ID,
      cloudFavNoItem,
      favSongs,
      moreError,
      handlePlayFav,
      handleLoadMoreFav,
      handleUnloveFav,
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

.error {
  flex: none;
  padding: 6px 0;
  text-align: center;
  font-size: 12px;
  color: var(--color-font-label);
}
</style>
