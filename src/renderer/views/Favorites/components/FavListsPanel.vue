<template>
  <div :class="$style.container">
    <!-- 卡片网格组件内部是「绝对定位 + 自滚动」，父级必须给出确定高度 -->
    <div :class="$style.grid">
      <!-- 卡片右上角取消收藏（票 06 E3）：网格只提供动作位，行为在本面板 -->
      <song-card-grid :list-info="listInfo">
        <template #item-action="{ item }">
          <unfav-card-button @click="handleUnfav(item)" />
        </template>
      </song-card-grid>
    </div>
    <div v-if="pagers.favLists.hasMore" :class="$style.more">
      <base-btn min @click="loadMoreFavLists">{{ $t('user_center__load_more') }}</base-btn>
    </div>
    <!-- 加载更多失败：独立提示位（有数据时不能塞进 listInfo.noItemLabel——那是列表的显隐开关） -->
    <p v-if="moreError" :class="$style.error" v-text="moreError" />
  </div>
</template>

<script lang="ts">
import { computed, watch } from '@common/utils/vueTools'
import { dialog } from '@renderer/plugins/Dialog'
import { favLists, labels, pagers, type PlaylistCard } from '@renderer/store/user/state'
import { initUserCenter, loadMoreFavLists, moreErrorLabelOf, noItemLabelOf, removeFavListFromList } from '@renderer/store/user/action'
import { status } from '@renderer/store/qqAuth/state'
import SongCardGrid from '@renderer/components/common/SongCardGrid.vue'
import UnfavCardButton from '@renderer/components/common/UnfavCardButton.vue'

/** 我的收藏 → 歌单：QQ 账号收藏的**他人歌单**（写能力=卡片上直接取消收藏，票 06 E3）。 */
export default {
  name: 'FavoritesListsPanel',
  components: {
    SongCardGrid,
    UnfavCardButton,
  },
  setup() {
    const t = (key: string, params?: any) => window.i18n.t(key as any, params)

    void initUserCenter()

    // 登录信号到达就重拉（照 `views/friends/useUserList.ts` 的 watch）：未登录时挂载过的话
    // `isInited` 已被置 true，不 force 就看不到数据（切走再切回来也不一定——Tab 是重建的，但守卫还在）
    watch(() => status.isLogin, (isLogin) => {
      if (isLogin) void initUserCenter(true)
    })

    // 卡片网格组件要 ListInfo 形状（它自带「点卡片进歌单详情」的跳转）；一次拉完，limit 取长度让分页器不出现
    const listInfo = computed(() => ({
      list: favLists,
      total: favLists.length,
      page: 1,
      limit: favLists.length || 1,
      key: null,
      // `noItemLabel` 同时是网格的显隐开关：有数据时必须空串，否则加载更多失败会把整页藏掉
      noItemLabel: noItemLabelOf(labels.favLists, favLists.length > 0),
      tagId: '',
      sortId: '',
      source: 'tx' as LX.OnlineSource,
    }))

    const moreError = computed(() => moreErrorLabelOf(labels.favLists, favLists.length > 0))

    /**
     * 卡片上的「取消收藏」（票 06 E3）：二次确认（`dialog.confirm` 走 material-modal）
     * → 写云端 + 就地移卡（`removeFavListFromList`，不整页重拉）。失败弹错不静默。
     */
    const handleUnfav = async(item: PlaylistCard) => {
      const confirm = await dialog.confirm({
        message: t('fav__cancel_confirm', { name: item.name }),
        confirmButtonText: t('fav__cancel'),
      })
      if (!confirm) return
      try {
        await removeFavListFromList(item)
      } catch (err: any) {
        void dialog({ message: err?.message || String(err), type: 'error' })
      }
    }

    return {
      pagers,
      listInfo,
      moreError,
      handleUnfav,
      loadMoreFavLists,
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

.grid {
  flex: auto;
  min-height: 0;
  position: relative;
}

.more {
  flex: none;
  padding: 10px 0;
  text-align: center;
}

.error {
  flex: none;
  padding: 6px 0 0;
  text-align: center;
  font-size: 12px;
  color: var(--color-font-label);
}
</style>
