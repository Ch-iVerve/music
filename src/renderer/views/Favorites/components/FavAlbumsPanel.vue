<template>
  <div :class="$style.container" class="scroll">
    <p v-if="labels.favAlbums && !favAlbums.length" :class="$style.tip" v-text="labels.favAlbums" />
    <p v-else-if="!favAlbums.length" :class="$style.tip">{{ $t('no_item') }}</p>
    <ul :class="$style.cards">
      <li v-for="item in favAlbums" :key="item.id" :class="$style.card" @click="toAlbum(item)">
        <div :class="$style.cover">
          <img :class="$style.cardImg" loading="lazy" decoding="async" :src="item.img" alt="">
          <!-- 卡片上直接取消收藏（票 06 E3）：二次确认后写云端、就地移卡 -->
          <unfav-card-button @click="handleUnfav(item)" />
        </div>
        <h4 :class="$style.cardName" :title="item.name">{{ item.name }}</h4>
        <p :class="$style.cardMeta" :title="item.author">{{ item.author }}</p>
      </li>
    </ul>
    <div v-if="pagers.favAlbums.hasMore" :class="$style.more">
      <base-btn min @click="loadMoreFavAlbums">{{ $t('user_center__load_more') }}</base-btn>
    </div>
    <!-- 加载更多失败：独立提示位（空表时由上面的空态承担，不重复显示） -->
    <p v-if="moreError" :class="$style.error" v-text="moreError" />
  </div>
</template>

<script lang="ts">
import { computed, watch } from '@common/utils/vueTools'
import { useRouter } from '@common/utils/vueRouter'
import { dialog } from '@renderer/plugins/Dialog'
import { favAlbums, labels, pagers, type PlaylistCard } from '@renderer/store/user/state'
import { initUserCenter, loadMoreFavAlbums, moreErrorLabelOf, removeFavAlbumFromList } from '@renderer/store/user/action'
import { status } from '@renderer/store/qqAuth/state'
import UnfavCardButton from '@renderer/components/common/UnfavCardButton.vue'

/** 我的收藏 → 专辑：QQ 账号收藏的专辑（写能力=卡片上直接取消收藏，票 06 E3）。 */
export default {
  name: 'FavoritesAlbumsPanel',
  components: {
    UnfavCardButton,
  },
  setup() {
    const t = (key: string, params?: any) => window.i18n.t(key as any, params)

    const router = useRouter()
    void initUserCenter()

    // 登录信号到达就重拉（照 `views/friends/useUserList.ts` 的 watch）
    watch(() => status.isLogin, (isLogin) => {
      if (isLogin) void initUserCenter(true)
    })

    const moreError = computed(() => moreErrorLabelOf(labels.favAlbums, favAlbums.length > 0))

    const toAlbum = (item: { id: string }) => {
      void router.push({ path: '/album', query: { mid: item.id } })
    }

    /**
     * 卡片上的「取消收藏」（票 06 E3）：二次确认（`dialog.confirm` 走 material-modal）
     * → 写云端 + 就地移卡（`removeFavAlbumFromList`，不整页重拉）。
     * 失败弹错不静默——取消收藏是用户主动动作（同专辑页的 handleToggleFav）。
     */
    const handleUnfav = async(item: PlaylistCard) => {
      const confirm = await dialog.confirm({
        message: t('fav__cancel_confirm', { name: item.name }),
        confirmButtonText: t('fav__cancel'),
      })
      if (!confirm) return
      try {
        await removeFavAlbumFromList(item)
      } catch (err: any) {
        void dialog({ message: err?.message || String(err), type: 'error' })
      }
    }

    return {
      favAlbums,
      labels,
      pagers,
      moreError,
      toAlbum,
      handleUnfav,
      loadMoreFavAlbums,
    }
  },
}
</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.container {
  height: 100%;
  overflow-y: auto;
}

.tip {
  padding: 20px 0;
  text-align: center;
  font-size: 13px;
  color: var(--color-font-label);
}

.cards {
  display: flex;
  flex-wrap: wrap;
}
.card {
  width: 132px;
  margin: 0 14px 14px 0;
  cursor: pointer;

  &:hover .cardImg {
    transform: scale(1.04);
  }
}
// 封面的定位壳：取消收藏键（绝对定位）以它为锚点；overflow 裁掉 hover 缩放溢出的边
.cover {
  position: relative;
  width: 132px;
  height: 132px;
  border-radius: @radius-border;
  overflow: hidden;
}
.cardImg {
  width: 132px;
  height: 132px;
  border-radius: @radius-border;
  object-fit: cover;
  background-color: var(--color-button-background);
  transition: transform @transition-fast;
}
.cardName {
  margin-top: 6px;
  font-size: 13px;
  .mixin-ellipsis-1();
}
.cardMeta {
  margin-top: 2px;
  font-size: 11px;
  color: var(--color-font-label);
  .mixin-ellipsis-1();
}

.more {
  padding: 10px 0;
  text-align: center;
}

.error {
  padding: 6px 0;
  text-align: center;
  font-size: 12px;
  color: var(--color-font-label);
}
</style>
