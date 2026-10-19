<template>
  <div :class="[$style.container, { [$style.descExpanded]: isDescOpen }]">
    <!-- 四个动作键搬到顶部工具栏搜索栏右侧（工单 03）：原来它们在 header 的第一行（工单 22 的位置），
         封面要等 36（键）+ 12（间距）= 48px 才出现——就是用户报的「上方有空白」。
         键的尺寸/间距/文案截断口径由 common/ToolbarActions.vue 统一给，本页不再写 .btnAction。
         下面 `.header` 只剩「封面 + 简介」这一行。 -->
    <common-toolbar-actions>
      <!-- 四个键都带 :title（工单 17 收尾）：工具栏里窄窗口/英文长文案会被省略号截断，
           截断时靠原生 title 看全文（与本页 .name / .singer 的做法一致） -->
      <base-btn :title="isFav ? $t('fav__cancel') : $t('fav__add')" :disabled="isFavLoading" @click="handleToggleFav">
        {{ isFav ? $t('fav__cancel') : $t('fav__add') }}
      </base-btn>
      <!-- 复制链接 / 在 QQ 音乐打开（工单 02）：分享走 QQ 网页链接，与本应用深链不是一回事 -->
      <base-btn v-if="detail.mid" :title="$t('album__copy_link')" @click="handleCopyAlbumLink">{{ $t('album__copy_link') }}</base-btn>
      <base-btn v-if="detail.mid" :title="$t('list__open_in_qq')" @click="handleOpenAlbumInQq">{{ $t('list__open_in_qq') }}</base-btn>
      <base-btn :title="$t('back')" @click="handleBack">{{ $t('back') }}</base-btn>
    </common-toolbar-actions>
    <div :class="$style.header">
      <div :class="$style.headerMain">
        <div :class="$style.coverBox">
          <img v-if="detail.img" :class="$style.cover" loading="lazy" decoding="async" :src="detail.img" alt="">
        </div>
        <div :class="$style.info">
          <h2 :class="$style.name" :title="detail.name">{{ detail.name || $t('music_album') }}</h2>
          <p v-if="detail.singers.length || detail.singer" :class="$style.singer" :title="detail.singer">
            <!-- 歌手名可点进歌手页：优先用接口给的 singers（带 mid），拿不到 mid 的名字保持纯文本 -->
            <template v-if="detail.singers.length">
              <template v-for="(singer, index) in detail.singers" :key="singer.mid || singer.name">
                <span v-if="index" :class="$style.singerGap">、</span>
                <span v-if="singer.mid" :class="$style.singerLink" @click.stop="toSinger(singer)">{{ singer.name }}</span>
                <span v-else>{{ singer.name }}</span>
              </template>
            </template>
            <template v-else>{{ detail.singer }}</template>
          </p>
          <p :class="$style.meta">
            <span v-if="detail.publishDate">{{ $t('album__publish_date') }}：{{ detail.publishDate }}</span>
            <span v-if="detail.company">{{ $t('album__company') }}：{{ detail.company }}</span>
            <span v-if="detail.language">{{ $t('album__language') }}：{{ detail.language }}</span>
            <span v-if="detail.albumType">{{ $t('album__type') }}：{{ detail.albumType }}</span>
            <span v-if="detail.genre">{{ $t('album__genre') }}：{{ detail.genre }}</span>
          </p>
          <!-- 简介：收起态 3 行，展开键跟在**末行行尾**（2026-10-19 用户定：原来独立一行的排法
               按钮与文字脱节，否掉）。截断/展开/「只在真被截断时出键」都在共用件里；
               `@toggle` 用来把页面根切成「简介展开态」（整页可滚 + 列表留最小高度） -->
          <common-expandable-desc v-if="detail.desc" :text="detail.desc" @toggle="isDescOpen = $event" />
        </div>
      </div>
    </div>

    <!-- 详情失败（多半是专辑不存在）时只显示这一处文案，不再让歌曲列表重复同一句话 -->
    <div v-if="headerLabel" :class="$style.noitem">
      <p v-text="headerLabel" />
    </div>
    <template v-else>
      <h3 :class="$style.title">
        {{ $t('album__songs') }}
        <span v-if="songs.total" :class="$style.count">{{ songs.total }}</span>
      </h3>
      <div :class="$style.list">
        <material-online-list
          :list="songs.list"
          :page="songs.page"
          :limit="songs.limit"
          :total="songs.total"
          :no-item="songs.noItemLabel"
          :list-id="queueListId"
          check-api-source
          @toggle-page="handleTogglePage"
          @play-list="handlePlayList"
        />
      </div>
    </template>
  </div>
</template>

<script lang="ts">
import { computed, ref, watch } from '@common/utils/vueTools'
import { useRoute, useRouter } from '@common/utils/vueRouter'
import usePlay from '@renderer/components/material/OnlineList/usePlay'
import useMusicJump from '@renderer/utils/compositions/useMusicJump'
import { albumQueueId } from '@renderer/utils/queueIds'
import useAlbum from './useAlbum'
import { getQQCredential } from '@renderer/utils/ipc'
import { dialog } from '@renderer/plugins/Dialog'
import { favAlbumIds } from '@renderer/store/user/state'
import { loadFavAlbumIds, setAlbumFav } from '@renderer/store/user/action'

export default {
  setup() {
    const route = useRoute()
    const router = useRouter()
    const { detail, songs, headerLabel, initAlbum, loadSongPage } = useAlbum()

    // 简介是否展开：页面根据此切成「简介展开态」（整页可滚 + 歌曲列表留最小高度，
    // 否则简介铺开后列表被挤成 0 高，只剩标题），见模板里的 `@toggle` 与 `.descExpanded`
    const isDescOpen = ref(false)

    // 播放复用在线列表的同一套逻辑。
    // ⚠️ 传歌曲区块对象本身（不是 `{ list: songs.list }`）：usePlay 存的是 props.list 的数组
    // 引用，区块内写回全部走 splice，所以引用一直有效。
    const selectedList = ref<LX.Music.MusicInfoOnline[]>([])
    // 队列身份（工单 06）：字面量的家在 @renderer/utils/queueIds（票 06 M3）。
    // `listId` 用 getter 现算：`/album?mid=A → B` 是同组件复用（setup 不重跑），
    // 快照会让第二张专辑仍用第一张的队列身份（同 Singer/NewSongs 面板的口径）。
    const queueListId = computed(() => albumQueueId(route.query.mid))
    const { handlePlayMusic } = usePlay({
      selectedList,
      props: {
        list: songs.list,
        get listId() { return queueListId.value },
      },
      removeAllSelect: () => { selectedList.value = [] },
      emit: () => {},
    })
    const handlePlayList = (index: number) => { void handlePlayMusic(index, true) }

    // 路由页没有 keep-alive，但 /album?mid=A → /album?mid=B 是同组件复用（setup 不会再跑），
    // 所以靠 watch 路由参数驱动取数，进入与更新两种情况都能覆盖
    watch(() => route.query.mid, (mid) => {
      void initAlbum(mid)
    }, { immediate: true })

    const handleTogglePage = (page: number) => {
      loadSongPage(page)
    }
    const handleBack = () => { router.back() }

    /**
     * 收藏 / 取消收藏到 QQ（工单 08）。
     *
     * 「有没有收藏」只能靠**收藏全量 id 集合**在本地比对（读接口没有单条查询，见 store/user 的注释），
     * 所以进页面先拉一次；写成功后本地集合跟着改，按钮状态立刻正确。
     * 未登录时只提示、不发请求；失败用 dialog 明确报错，不静默。
     */
    const isFavLoading = ref(false)
    const isFav = computed(() => !!detail.mid && favAlbumIds.includes(detail.mid))
    const handleToggleFav = async() => {
      if (!detail.id || !detail.mid) return
      const credential = await getQQCredential()
      if (credential == null) {
        void dialog({ message: window.i18n.t('user_center__need_login' as any), type: 'info' })
        return
      }
      const next = !isFav.value
      isFavLoading.value = true
      try {
        await setAlbumFav({ id: detail.id, mid: detail.mid }, next)
      } catch (err: any) {
        void dialog({ message: err?.message || String(err), type: 'error' })
      } finally {
        isFavLoading.value = false
      }
    }
    // 进页面（或换专辑）时确保收藏集合已加载；未登录时静默失败（按钮点了会提示登录）
    watch(() => detail.mid, (mid) => {
      if (!mid) return
      void loadFavAlbumIds().catch(err => { console.log('[album] load fav ids', err) })
    }, { immediate: true })
    // 专辑简介的截断 / 展开 / 溢出判断已下沉到共用件 `components/common/ExpandableDesc.vue`
    // （歌手页同一套，2026-10-19）：这里只剩「把 desc 递进去」。
    // 专辑详情的歌手条目带 mid（tx/album.js 的 toSinger），据此跳歌手页
    const toSinger = (singer: { mid: string, name: string }) => {
      if (!singer.mid) return
      void router.push({ path: '/singer', query: { mid: singer.mid } })
    }

    // 复制专辑链接 / 在 QQ 音乐打开（工单 02）：专辑的 URL 生成器是本票新补的
    const { copyAlbumLink, openAlbumInQqMusic } = useMusicJump()
    const handleCopyAlbumLink = () => { copyAlbumLink(detail.mid) }
    const handleOpenAlbumInQq = () => { openAlbumInQqMusic(detail.mid) }

    return {
      detail,
      songs,
      headerLabel,
      queueListId,
      handleTogglePage,
      handlePlayList,
      handleBack,
      toSinger,
      isFav,
      isFavLoading,
      handleToggleFav,
      handleCopyAlbumLink,
      handleOpenAlbumInQq,
      isDescOpen,
    }
  },
}
</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.container {
  height: 100%;
  // 根容器带左右 padding 时必须 border-box，否则溢出窗口右侧（见 userCenter/index.vue 同名注释）
  box-sizing: border-box;
  padding: 16px 22px 0;
  color: var(--color-font);
  display: flex;
  flex-flow: column nowrap;
  // 简介展开后可能比窗口高得多（实测「太阳之子」全文 283 行 / 约 4750px）：本页外壳是
  // 「页头固定 + 列表自滚」、整页不滚，不给这里开口子的话正文尾部与「收起」键都到不了。
  // 收起态内容正好 100%，不会冒出滚动条。
  overflow-y: auto;
}

// 只剩「封面 + 简介」这一行（动作键搬到顶部工具栏了，工单 03）：不再需要纵向 flex，
// 分隔线仍留在封面块下方（三页同一套语法，工单 24）
.header {
  flex: none;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--color-000-alpha-700);
}
.headerMain {
  display: flex;
  flex-flow: row nowrap;
}
.coverBox {
  flex: none;
  width: 120px;
  height: 120px;
  border-radius: @radius-border;
  overflow: hidden;
  background-color: var(--color-button-background);
}
.cover {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.info {
  flex: auto;
  min-width: 0;
  padding: 0 14px;
}
.name {
  font-size: 17px;
  font-weight: 600;
  .mixin-ellipsis-1();
}
.singer {
  margin-top: 6px;
  font-size: 13px;
  .mixin-ellipsis-1();
}
// 歌手名可点（M6）：只做颜色过渡，不加下划线——专辑页是信息区，下划线会显得很吵
.singerLink {
  cursor: pointer;
  transition: color @transition-fast;

  &:hover {
    color: var(--color-primary);
  }
}
.singerGap {
  color: var(--color-font-label);
}
.meta {
  margin-top: 6px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--color-font-label);

  span {
    margin-right: 12px;
  }
}
// 简介的 `.desc` / `.descOpen` / `.descToggle` 三条样式随逻辑一起搬进共用件
// `components/common/ExpandableDesc.vue`（末行行尾的按钮排法是那里的 `.wrap` 的 flex-end）
// 四键的尺寸规则（工单 17 的 `.btnAction`、工单 22 的 `.actions`）已随动作键搬走，
// 现在统一由 `components/common/ToolbarActions.vue` 的 `.actions button` 给：
// 同高（搜索框那档 28.08px）+ 同 padding + 同 gap + 不换行 + 省略号，且不再做等分——
// 等分在工具栏里实测会截断中文（每键只剩 103.3@920 / 88.8@828），见工单 03 的量取表。

.title {
  flex: none;
  margin-top: 14px;
  font-size: 14px;
  font-weight: 600;
}
.count {
  margin-left: 6px;
  font-weight: 400;
  font-size: 12px;
  color: var(--color-font-label);
}

// material-online-list 内部是绝对定位 + 自滚动，父级要给出确定的高度
.list {
  flex: auto;
  min-height: 0;
  position: relative;
}
// 简介展开态：简介会铺满好几屏，`flex: auto` 的列表被挤成 0 高（只剩标题），
// 给它一个最小高度——滚过简介后列表仍在，收起后又回到原来的「填满剩余空间」
.descExpanded .list {
  min-height: 320px;
}
.noitem {
  flex: auto;
  display: flex;
  align-items: center;
  justify-content: center;

  p {
    font-size: 20px;
    color: var(--color-font-label);
  }
}
</style>
