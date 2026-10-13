<template>
  <div :class="$style.container">
    <!-- 四个动作键搬到顶部工具栏搜索栏右侧（工单 03 的机制）：原来它们占着页头右半边，
         键的尺寸/间距/截断口径改由 common/ToolbarActions.vue 统一给，本页不再写 .headerRightBtn；
         页头因此只剩「封面 + 信息」两个子项（原来按键列不占纵向空间，见 .songListHeader 注释） -->
    <common-toolbar-actions>
      <!-- 四个键都带 :title：工具栏里窄窗口/长文案会被省略号截断，截断时靠原生 title 看全文；
           「播放」的 title 还拼上了歌单名（理由见 setup 里 playTip 的注释） -->
      <base-btn
        :disabled="!!listDetailInfo.noItemLabel"
        :title="playTip"
        @click="playSongListDetail(listDetailInfo.id, listDetailInfo.source, listDetailInfo.list)"
      >
        {{ $t('list__play') }}
      </base-btn>
      <base-btn
        :disabled="!!listDetailInfo.noItemLabel"
        :title="$t('list__collect')"
        @click="addSongListDetail(listDetailInfo.id, listDetailInfo.source, listDetailInfo.info.name)"
      >
        {{ $t('list__collect') }}
      </base-btn>
      <base-btn :disabled="isFavLoading || !!listDetailInfo.noItemLabel" :title="isFav ? $t('fav__cancel') : $t('fav__add')" @click="handleToggleFav">
        {{ isFav ? $t('fav__cancel') : $t('fav__add') }}
      </base-btn>
      <base-btn :title="$t('back')" @click="handleBack">{{ $t('back') }}</base-btn>
    </common-toolbar-actions>
    <div :class="$style.songListHeader">
      <div :class="$style.songListHeaderLeft" :style="{ backgroundImage: 'url('+(picUrl || listDetailInfo.info.img)+')' }">
        <!-- <span v-if="listDetailInfo.info.play_count" :class="$style.playNum">{{ listDetailInfo.info.play_count }}</span> -->
      </div>
      <div :class="$style.songListHeaderMiddle">
        <h3 :title="listDetailInfo.info.name">{{ listDetailInfo.info.name }}</h3>
        <p :title="listDetailInfo.info.desc">{{ listDetailInfo.info.desc }}</p>
      </div>
    </div>
    <div :class="$style.list">
      <material-online-list
        ref="listRef"
        :page="listDetailInfo.page"
        :limit="listDetailInfo.limit"
        :total="listDetailInfo.total"
        :list="listDetailInfo.list"
        :no-item="listDetailInfo.noItemLabel"
        :list-id="songListQueueId(id)"
        @play-list="handlePlayList"
        @toggle-page="togglePage"
      />
    </div>
  </div>
</template>

<script lang="ts">
import { computed, ref, watch } from '@common/utils/vueTools'
import { listDetailInfo } from '@renderer/store/songList/state'
import { useRouter } from '@common/utils/vueRouter'
import { useI18n } from '@renderer/plugins/i18n'
import { addSongListDetail, playSongListDetail } from './action'
import useList from './useList'
import useKeyBack from './useKeyBack'
import { getQQCredential } from '@renderer/utils/ipc'
import { dialog } from '@renderer/plugins/Dialog'
import { favPlaylistIds } from '@renderer/store/user/state'
import { loadFavSonglistIds, setPlaylistFav } from '@renderer/store/user/action'
import { songListQueueId } from '@renderer/utils/queueIds'

// 初始值而已，真正的源由路由 query 决定（下面的 verifyQueryParams 会覆写它）
const source = ref<LX.OnlineSource>('tx')
const id = ref<string>('')
const page = ref<number>(1)
const picUrl = ref<string>('')
const refresh = ref<boolean>(false)


interface Query {
  source?: string
  id?: string
  page?: string
  picUrl?: string
  refresh?: 'true'
  fromName?: string
  fromTab?: string
  /** 只在兜底跳转（无歌单可显示时跳乐馆歌单广场）里出现 */
  tab?: string
}

const verifyQueryParams = async function(this: any, to: { query: Query, path: string }, from: any, next: (route?: { path: string, query: Query }) => void) {
  let _source = to.query.source
  let _id = to.query.id
  let _page: string | undefined = to.query.page
  let _picUrl: string | undefined = to.query.picUrl
  let _refresh: 'true' | undefined = to.query.refresh

  if (_source == null || _id == null) {
    if (listDetailInfo.key) {
      _source = listDetailInfo.source
      _id = listDetailInfo.id
      _page = listDetailInfo.page.toString()
      _picUrl = listDetailInfo.info.img
    } else {
      next({ path: '/musicHall', query: { tab: 'songlist' } })
      return
    }

    next({
      path: to.path,
      query: { ...to.query, source: _source, id: _id, page: _page, picUrl: _picUrl, refresh: _refresh },
    })
    return
  }
  next()
  source.value = _source as LX.OnlineSource
  id.value = _id
  page.value = _page ? parseInt(_page) : 1
  picUrl.value = _picUrl ?? ''
  refresh.value = _refresh ? _refresh == 'true' : false
  if (to.query.fromName) window.lx.songListInfo.fromName = to.query.fromName
  window.lx.songListInfo.fromTab = to.query.fromTab ?? ''
}


export default {
  beforeRouteEnter: verifyQueryParams,
  beforeRouteUpdate: verifyQueryParams,
  setup() {
    const router = useRouter()
    const t = useI18n()

    const {
      listRef,
      listDetailInfo,
      getListData,
      handlePlayList,
    } = useList()

    /**
     * 「播放」键的 title（工单 03 搬到工具栏后的语义收口）。
     *
     * 键在页头时，「播放」的语境由旁边的封面/歌单名给；上移到工具栏后那段语境没了，
     * 光一个「播放」看不出作用于哪个列表——所以把**歌单名拼进 title**。
     * 只用既有 i18n key（本票不许新增词条，lang 四份不必动），` · ` 分隔
     * 与 store/mv/action.ts 的 `codecLabel · sizeText` 同一口径；歌单名还没取到时退回纯「播放」，
     * 不留一个悬空的分隔符。
     */
    const playTip = computed(() => {
      const name = listDetailInfo.info.name
      const label = t('list__play')
      return name ? `${label} · ${name}` : label
    })


    const togglePage = (page: number) => {
      void getListData(source.value, id.value, page, refresh.value)
    }

    const handleBack = () => {
      // 回来源页时把 Tab 一起带上：乐馆里「歌单广场」是 tab=songlist，不带就回到排行榜
      const fromTab = window.lx.songListInfo.fromTab
      if (window.lx.songListInfo.fromName) {
        void router.replace({ name: window.lx.songListInfo.fromName, query: fromTab ? { tab: fromTab } : {} })
      } else router.back()
    }

    useKeyBack(handleBack)

    /**
     * 收藏 / 取消收藏到 QQ（工单 08）。注意与左边的 `list__collect`（复制成本地自建列表）
     * 那是把在线歌单**复制成本地自建列表**）不是同一件事：这个写的是 QQ 云端收藏。
     * 判定见 store/user 的注释（读接口没有单条查询，靠收藏全量 tid 集合本地比对）。
     */
    const isFavLoading = ref(false)
    const isFav = computed(() => !!id.value && favPlaylistIds.includes(String(id.value)))
    const handleToggleFav = async() => {
      if (!id.value) return
      const credential = await getQQCredential()
      if (credential == null) {
        void dialog({ message: window.i18n.t('user_center__need_login' as any), type: 'info' })
        return
      }
      const next = !isFav.value
      isFavLoading.value = true
      try {
        await setPlaylistFav(String(id.value), next)
      } catch (err: any) {
        void dialog({ message: err?.message || String(err), type: 'error' })
      } finally {
        isFavLoading.value = false
      }
    }
    watch(id, (next) => {
      if (!next) return
      void loadFavSonglistIds().catch(err => { console.log('[songList] load fav ids', err) })
    }, { immediate: true })

    watch([source, id, page, refresh], async([_source, _id, _page, _refresh]) => {
      if (!_source || !_id) return router.replace({ path: '/musicHall', query: { tab: 'songlist' } })
      // console.log(_source, _id, _page, _refresh, picUrl.value)
      // source.value = _source
      // id.value = _id
      // refresh.value = _refresh
      // page.value = _page ?? 1
      void getListData(_source, _id, _page, _refresh)
    }, {
      immediate: true,
    })

    return {
      source,
      id,
      // 播放队列身份（`tx__<tid>`）：与 `action.ts` 的 playSongListDetail 取同一处（票 06 M3）
      songListQueueId,
      page,
      picUrl,
      listDetailInfo,
      listRef,
      togglePage,
      addSongListDetail,
      playSongListDetail,
      handlePlayList,
      handleBack,
      playTip,
      isFav,
      isFavLoading,
      handleToggleFav,
    }
  },
}
</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.container {
  // position: absolute;
  // left: 0;
  // top: 0;
  // width: 100%;
  // height: 100%;
  display: flex;
  flex-flow: column nowrap;
}

// 单行页头：封面 + 信息。**按键列（原来的 .songListHeaderRight）本来就不占纵向空间**
// ——四个键在这条 80px 行里垂直居中，行高由封面（height: 100% + aspect-ratio）决定。
// 所以键搬去工具栏后这里没有「空白行」要收：封面顶缘、行高、正文起点都不变，
// 变的只是信息列的宽度（按键列腾出的横向空间归 .songListHeaderMiddle，右 gutter 见下）。
.songListHeader {
  flex: none;
  display: flex;
  flex-flow: row nowrap;
  height: 80px;
}
.songListHeaderLeft {
  flex: none;
  margin-left: 15px;
  height: 100%;
  aspect-ratio: 1 / 1;
  position: relative;
  overflow: hidden;
  border-radius: 4px;
  background-position: center;
  background-size: cover;
  opacity: .9;
  box-shadow: 0 0 2px 0 rgba(0,0,0,.2);
}
.playNum {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 4px;
  background-color: rgba(0, 0, 0, 0.4);
  color: #fff;
  font-size: 12px;
  text-align: right;
  .mixin-ellipsis-1();
}

.songListHeaderMiddle {
  flex: auto;
  // 右内边距 15px = 原 .songListHeaderRight 的 padding-right（按键列搬走后那一列没了，
  // 这条 gutter 挪到这里，免得歌单名/简介（都是省略号截断）顶到窗口右缘。
  // 左内边距 7 沿用旧的，与封面之间还有 .songListHeaderLeft 的 15px margin
  padding: 2px 15px 2px 7px;
  min-width: 0;
  h3 {
    .mixin-ellipsis-1();
    line-height: 1.2;
    padding-bottom: 5px;
    color: var(--color-font);
  }
  p {
    .mixin-ellipsis(3);
    font-size: 12px;
    line-height: 1.2;
    color: var(--color-font-label);
  }
}

.list {
  position: relative;
  width: 100%;
  min-height: 0;
  flex: auto;
  height: 100%;
}
</style>

