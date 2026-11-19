<template>
  <div :class="$style.container" class="scroll">
    <!-- 返回键搬到顶部工具栏搜索栏右侧（工单 03）：下面不再有「动作行」这一块，
         封面块直接顶上。动作键的尺寸/间距由 common/ToolbarActions.vue 统一给。 -->
    <common-toolbar-actions>
      <base-btn @click="handleBack">{{ $t('back') }}</base-btn>
    </common-toolbar-actions>

    <div v-if="detail.errorLabel" :class="$style.error" v-text="detail.errorLabel" />

    <template v-else>
      <!-- 头部：封面 + 歌名/歌手/专辑/时长（点专辑名进专辑页） -->
      <div :class="$style.song">
        <img :class="$style.cover" loading="lazy" decoding="async" :src="detail.img" alt="">
        <div :class="$style.songInfo">
          <h2 :class="$style.name" :title="detail.name">{{ detail.name }}</h2>
          <!-- `.stop` 不能删（工单 23）：多歌手时这次点击打开选择菜单，而 base-menu 的「点空白收起」挂在
               document 上——不停住冒泡，菜单会被打开它的这次点击立刻关掉（详见 useMusicJump 里 picker 的注释） -->
          <p
            :class="[$style.meta, ...(detail.singers.length ? [$style.link] : [])]"
            :title="detail.singers.length ? $t('list__jump_singer') : $t('list__jump_singer_disabled')"
            @click.stop="handleSingerClick"
          >{{ detail.singer }}</p>
          <p v-if="detail.albumMid" :class="[$style.meta, $style.link]" @click="toAlbum">{{ detail.albumName }}</p>
          <p v-else-if="detail.albumName" :class="$style.meta">{{ detail.albumName }}</p>
          <p :class="$style.meta">{{ detail.interval }}</p>
          <!--
            「打开播放详情页」只在**正在播放的就是本页这首**时出现（ui-polish-followups 工单 05）。
            播放详情是覆盖层，显示的永远是播放器里那首：什么都没在播时点开是空壳层，在播另一首时点开看到的是
            别人（入口文案「打开播放详情页」会让人以为是自己这首）——两种都不给入口。
            「在播的是另一首」也走隐藏、不做提示态：这条入口只有「回到正在播的那首」一种含义，
            再加第二种语义就要另造一条文案（i18n 四语），收益不成比例。
          -->
          <p v-if="isPlayingThisSong" :class="[$style.meta, $style.link]" @click="handleOpenPlayDetail">{{ $t('song_detail__open_play_detail') }}</p>
        </div>
      </div>

      <!-- 歌曲详情：唱片公司 / 流派 / 发行时间 / 语言 + 简介 -->
      <section :class="$style.section">
        <h3 :class="$style.title">{{ $t('song_detail__info') }}</h3>
        <ul :class="$style.infoList">
          <li v-for="item in infoRows" :key="item.label" :class="$style.infoRow">
            <span :class="$style.infoLabel">{{ item.label }}</span>
            <span :class="$style.infoValue">{{ item.value }}</span>
          </li>
        </ul>
        <p v-if="detail.desc" :class="$style.desc">{{ detail.desc }}</p>
      </section>

      <!-- 制作人（幕后名单）：按职责分组；没有数据时整块不渲染（`producers.list` 空） -->
      <section v-if="producers.list.length" :class="$style.section">
        <h3 :class="$style.title">{{ $t('song_detail__producers') }}</h3>
        <ul :class="$style.creditList">
          <li v-for="(group, groupIndex) in producers.list" :key="groupIndex" :class="$style.creditRow">
            <span :class="$style.creditRole" :title="group.title">{{ group.title }}</span>
            <ul :class="$style.creditNames">
              <li v-for="(item, index) in group.producers" :key="index" :class="$style.creditName">
                <img v-if="item.icon" :class="$style.creditAvatar" loading="lazy" decoding="async" :src="item.icon" alt="">
                <span :class="$style.creditText" :title="item.name">{{ item.name }}</span>
              </li>
            </ul>
          </li>
        </ul>
      </section>

      <!-- 曲谱：卡片（封面 + 乐器·谱型·页数）→ 弹窗看乐谱图片。
           **没有曲谱就整块不渲染**（票 03）：QQ 侧 `code=10007`（很多歌就是没有谱）是常态，
           出「曲谱 + 列表竟然是空的...」会被当成页面坏了；只有**取数失败**才留一行提示
           （失败不能伪装成「没有曲谱」），所以显隐判据是「有列表 或 有失败原因」。 -->
      <section v-if="sheets.list.length || sheets.errorLabel" :class="$style.section">
        <h3 :class="$style.title">{{ $t('song_detail__sheets') }}</h3>
        <p v-if="sheets.errorLabel" :class="$style.empty" v-text="sheets.errorLabel" />
        <ul v-else :class="$style.cards">
          <li v-for="item in sheets.list" :key="item.id" :class="$style.card" @click="openSheet(item)">
            <!-- 封面缺了就退到第一张谱面（列表里封面与谱面都是同一份数据的两个字段，没必要再留一个空框） -->
            <img :class="$style.cardImg" loading="lazy" decoding="async" :src="item.cover || item.images[0]" alt="">
            <h4 :class="$style.cardName" :title="item.name">{{ item.name }}</h4>
            <p :class="$style.cardMeta" :title="sheetMeta(item)">{{ sheetMeta(item) }}</p>
          </li>
        </ul>
      </section>

      <!-- 相似歌曲：可播（点单曲 = 从这首开始连播本列表，与在线列表同一套） -->
      <section :class="$style.section">
        <h3 :class="$style.title">{{ $t('song_detail__similar') }}</h3>
        <div :class="$style.songList">
          <material-online-list
            :list="similar.list"
            :page="similar.page"
            :limit="similar.limit"
            :total="similar.total"
            :no-item="similar.noItemLabel"
            :list-id="`songDetail__similar__${mid}`"
            check-api-source
            @play-list="handlePlaySimilar"
          />
        </div>
      </section>

      <!-- 相关歌单：卡片 → 本仓歌单详情页 -->
      <section :class="$style.section">
        <h3 :class="$style.title">{{ $t('song_detail__playlists') }}</h3>
        <p v-if="relatedPlaylists.noItemLabel" :class="$style.empty" v-text="relatedPlaylists.noItemLabel" />
        <ul v-else :class="$style.cards">
          <li v-for="item in relatedPlaylists.list" :key="item.id" :class="$style.card" @click="toPlaylist(item)">
            <img :class="$style.cardImg" loading="lazy" decoding="async" :src="item.img" alt="">
            <h4 :class="$style.cardName" :title="item.name">{{ item.name }}</h4>
            <!-- 曲目数走 i18n（复用我的主页「创建的歌单」那条同义 key `{num} 首 / {num} tracks`）：
                 原来硬编码 `{{ item.total }} 首`，英文 / 韩文界面下也显示「首」 -->
            <p :class="$style.cardMeta">{{ $t('user_center__gene_songs', { num: item.total }) }}</p>
          </li>
        </ul>
      </section>

      <!-- 相关 MV：卡片 → 复用乐馆 MV 的播放弹窗 -->
      <section :class="$style.section">
        <h3 :class="$style.title">{{ $t('song_detail__mvs') }}</h3>
        <p v-if="relatedMvs.noItemLabel" :class="$style.empty" v-text="relatedMvs.noItemLabel" />
        <ul v-else :class="$style.cards">
          <li v-for="item in relatedMvs.list" :key="item.id" :class="[$style.card, $style.mvCard]" @click="openMv(item)">
            <div :class="$style.thumbBox">
              <img :class="$style.thumb" loading="lazy" decoding="async" :src="item.img" alt="">
            </div>
            <h4 :class="$style.cardName" :title="item.name">{{ item.name }}</h4>
            <p :class="$style.cardMeta" :title="item.singer">{{ item.singer }}</p>
          </li>
        </ul>
      </section>

      <!-- 其他版本：可播 -->
      <section :class="$style.section">
        <h3 :class="$style.title">{{ $t('song_detail__other_versions') }}</h3>
        <div :class="$style.songList">
          <material-online-list
            :list="otherVersions.list"
            :page="otherVersions.page"
            :limit="otherVersions.limit"
            :total="otherVersions.total"
            :no-item="otherVersions.noItemLabel"
            :list-id="`songDetail__versions__${mid}`"
            check-api-source
            @play-list="handlePlayOther"
          />
        </div>
      </section>
    </template>

    <mv-player-modal
      :show="player.show"
      :mv="player.mv"
      :detail="player.detail"
      :url="player.url"
      :url-error="player.urlError"
      :is-loading="player.isLoading"
      :size-text="player.sizeText"
      @close="closePlayer"
      @retry="retryUrl"
    />
    <!-- 曲谱弹窗：视图内弹窗照 §2.5.1 显式 teleport="#view"（在 SheetMusicModal 里）。
         `v-if` 是**类型要求**（票 04）：`sheet` prop 不能是可空类型，否则 vue-loader 生成
         `type: [Object, null]` 让 ts-loader 报 TS2769、dev/build 双带错。 -->
    <sheet-music-modal v-if="sheetModal.sheet" :show="sheetModal.show" :sheet="sheetModal.sheet" @close="closeSheet" />
    <!-- 多位歌手时让用户挑（工单 02）：与歌曲表同一套 base-menu -->
    <base-menu v-model="isShowSingerPicker" :menus="singerPickerMenus()" :xy="singerPickerXy" item-name="name" @menu-click="handleSingerPickerClick" />
  </div>
</template>

<script lang="ts">
import { computed, ref, watch } from '@common/utils/vueTools'
import { useRoute, useRouter } from '@common/utils/vueRouter'
import usePlay from '@renderer/components/material/OnlineList/usePlay'
import MvPlayerModal from '@renderer/components/common/MvPlayerModal.vue'
import SheetMusicModal from './components/SheetMusicModal.vue'
import { player, openMv as openMvPlayer, closePlayer, retryUrl, type MvInfo } from '@renderer/store/mv'
import { playMusicInfo } from '@renderer/store/player/state'
import { setShowPlayerDetail } from '@renderer/store/player/action'
import useMusicJump from '@renderer/utils/compositions/useMusicJump'
import useSongDetail, { producers, relatedMvs, relatedPlaylists, sheetMeta, sheets, type SheetMusicItem } from './useSongDetail'

/**
 * 歌曲详情页（工单 09）：`/songDetail?source=tx&mid=<songmid>`。
 *
 * 从歌曲右键菜单的「歌曲详情」进来（原来那一项是**打开 QQ 网页**，现在进本页）。
 * 七个块各自独立三段式：详情失败时六个关联块不发请求、只落空态；某个关联块失败不拖累其它块。
 * 制作人 / 曲谱是 2026-09-26 追加的资料类块（制作人无数据时整块不渲染，见 useSongDetail）。
 */
export default {
  name: 'SongDetail',
  components: {
    MvPlayerModal,
    SheetMusicModal,
  },
  setup() {
    const route = useRoute()
    const router = useRouter()
    const { detail, similar, otherVersions, load } = useSongDetail()

    const mid = computed(() => (route.query.mid as string) ?? '')
    // 路由页没有 keep-alive，但 `/songDetail?mid=A` → `?mid=B` 是**同组件复用**（setup 不会再跑）——
    // 只写 `if (mid.value) void load(mid.value)` 会出现「URL 换了、内容还是上一首」（2026-09-25 真机验收抓到）。
    // 改成 watch 驱动（与 `views/Singer/index.vue` 同一写法），
    // 首次进入与换 mid 两种情况都覆盖。
    watch(() => route.query.mid, (value) => {
      if (value) void load(value as string)
    }, { immediate: true })

    const infoRows = computed(() => [
      { label: window.i18n.t('song_detail__company' as any), value: detail.info.company },
      { label: window.i18n.t('song_detail__genre' as any), value: detail.info.genre },
      { label: window.i18n.t('song_detail__pub_time' as any), value: detail.info.pubTime },
      { label: window.i18n.t('song_detail__lan' as any), value: detail.info.lan },
    ].filter(row => row.value))

    // 播放复用在线列表那一套（工单 06 方案 B：点一首 = 从这首开始连播这个列表，
    // 所以队列身份要带上本页的上下文，见 usePlay 的 queueId）
    const createPlay = (block: { list: LX.Music.MusicInfoOnline[] }, listId: string) => {
      const selectedList = ref<LX.Music.MusicInfoOnline[]>([])
      const { handlePlayMusic } = usePlay({
        selectedList,
        props: { list: block.list, listId },
        removeAllSelect: () => { selectedList.value = [] },
        emit: () => {},
      })
      return (index: number) => { void handlePlayMusic(index, true) }
    }
    const handlePlaySimilar = createPlay(similar, `songDetail__similar__${mid.value}`)
    const handlePlayOther = createPlay(otherVersions, `songDetail__versions__${mid.value}`)

    const handleBack = () => { router.back() }
    // 头部的歌手名可点（工单 02）：详情接口已经给了每位歌手的 mid（trackRaw.singer[]），
    // 所以这里不用再发请求；多位歌手时弹出选择菜单（与歌曲表同一套 base-menu）
    const { jumpToSingerList, isShowSingerPicker, singerPickerXy, singerPickerMenus, handleSingerPickerClick } = useMusicJump()
    const handleSingerClick = (event: MouseEvent) => {
      if (!detail.singers.length) return
      jumpToSingerList(detail.singers, event)
    }
    // 回到播放详情（工单 02 的互跳；这一页原来整页没有可点元素）。
    // 播放详情是覆盖层（不是路由），打开它即可——它显示的永远是「正在播放的那首」，
    // 所以入口的显隐由 isPlayingThisSong 把关（工单 05），不在这里兜。
    const handleOpenPlayDetail = () => {
      setShowPlayerDetail(true)
    }
    /**
     * 「打开播放详情页」入口的判据（ui-polish-followups 工单 05）：**正在播放的就是本页这首**才显示。
     * 判据读既有 store 值 `playMusicInfo.musicInfo`（不另造状态）；`meta.songId` 存的才是 songmid
     * （见 `@common/utils/tools` 的 toNewMusicInfo），本地文件的 `songId` 是文件路径，所以还要比 source。
     *
     * ⚠️ `playMusicInfo.musicInfo` 的类型是 `ListItem | MusicInfo`（下载列表项 / 歌曲），
     * 先按仓库既有写法用 `'progress' in` 把前者判掉（同 `core/music/index.ts:35`），
     * 否则 `.source` / `.meta` 在这条联合上不存在（TS2339，构建期就报）。
     */
    const isPlayingThisSong = computed(() => {
      const musicInfo = playMusicInfo.musicInfo
      if (!musicInfo || 'progress' in musicInfo) return false
      if (musicInfo.source != 'tx') return false
      return !!detail.mid && musicInfo.meta.songId == detail.mid
    })
    const toAlbum = () => {
      if (detail.albumMid) void router.push({ path: '/album', query: { mid: detail.albumMid } })
    }
    const toPlaylist = (item: { id: string }) => {
      if (!item.id) return
      void router.push({ path: '/songList/detail', query: { source: 'tx', id: item.id } })
    }
    /** 相关 MV 只有列表字段，映射成 `MvInfo` 交给乐馆那套播放逻辑（同歌手页 / 搜索页）。 */
    const openMv = (item: { vid: string, name: string, img: string, singer: string, playCount: number }) => {
      if (!item.vid) return
      const info: MvInfo = {
        id: item.vid,
        vid: item.vid,
        name: item.name,
        subName: '',
        img: item.img,
        singer: item.singer,
        interval: null,
        duration: 0,
        playCount: item.playCount,
      }
      openMvPlayer(info)
    }

    // 曲谱弹窗：`show` 与 `sheet` 放在**同一个对象**里整体换（分两次赋值会出现
    // 「弹窗已开、内容为空」的一帧：弹窗的 v-if 只认 sheet）
    const sheetModal = ref<{ show: boolean, sheet: SheetMusicItem | null }>({ show: false, sheet: null })
    const openSheet = (item: SheetMusicItem) => {
      sheetModal.value = { show: true, sheet: item }
    }
    const closeSheet = () => {
      sheetModal.value = { ...sheetModal.value, show: false }
    }

    return {
      // 两个在线列表的 `:list-id` 要它（队列身份带 songmid，ui-polish-followups 工单 09）
      mid,
      detail,
      similar,
      otherVersions,
      relatedPlaylists,
      relatedMvs,
      producers,
      sheets,
      sheetMeta,
      sheetModal,
      infoRows,
      player,
      handlePlaySimilar,
      handlePlayOther,
      handleBack,
      toAlbum,
      toPlaylist,
      openMv,
      openSheet,
      closeSheet,
      closePlayer,
      retryUrl,
      handleSingerClick,
      handleOpenPlayDetail,
      isPlayingThisSong,
      isShowSingerPicker,
      singerPickerXy,
      singerPickerMenus,
      handleSingerPickerClick,
    }
  },
}
</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.container {
  height: 100%;
  // 根容器带左右 padding 时必须 border-box，否则溢出窗口右侧（AGENTS §2.5.1 第 10 条）
  box-sizing: border-box;
  padding: 16px 22px 30px;
  color: var(--color-font);
  overflow-y: auto;
}

// 头部（工单 24 那套「返回键 + 分隔线」）整块退场：返回键搬到顶部工具栏（工单 03），
// 原来封面要等 36（键）+ 14（padding）+ 1（分隔线）+ 18（间距）= 69px 才出现，这就是用户报的
// 「上方有空白」（920 档实测 coverTop 147 → 78）。
// 分隔线留在 `.song` 下方，三页「封面块 + 分隔线 + 正文」的语法与歌手页/专辑页保持一致（工单 24 的口径）。
// 量测对照以真机 920 档实测为准

.error {
  padding: 30px 0;
  text-align: center;
  font-size: 14px;
  color: var(--color-font-label);
}

// 封面/歌名这一块现在是页面第一块（上面没有 action 行了），所以去掉原来的 margin-top: 18px
.song {
  display: flex;
  align-items: center;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--color-000-alpha-700);
}
.cover {
  flex: none;
  width: 120px;
  height: 120px;
  border-radius: @radius-border;
  object-fit: cover;
  background-color: var(--color-button-background);
}
.songInfo {
  min-width: 0;
  padding-left: 16px;
}
.name {
  font-size: 18px;
  font-weight: 600;
  .mixin-ellipsis-2();
}
.meta {
  margin-top: 6px;
  font-size: 12px;
  color: var(--color-font-label);
  .mixin-ellipsis-1();
}
.link {
  cursor: pointer;
  transition: color @transition-fast;

  &:hover {
    color: var(--color-primary);
  }
}

.section {
  margin-top: 20px;
}
.title {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 10px;
}

.infoList {
  font-size: 12px;
}
.infoRow {
  display: flex;
  margin-bottom: 4px;
}
.infoLabel {
  flex: none;
  width: 72px;
  color: var(--color-font-label);
}
.infoValue {
  min-width: 0;
  .mixin-ellipsis-2();
}
.desc {
  margin-top: 8px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--color-font-label);
  white-space: pre-wrap;
}

// material-online-list 内部是绝对定位自滚动，父级必须给定高
.songList {
  height: 320px;
  position: relative;
}

// 制作人：角色列定宽 + 名字列换行（与 .infoRow 同一套「标签 72px + 值」语法）
.creditList {
  font-size: 12px;
}
.creditRow {
  display: flex;
  margin-bottom: 8px;
}
.creditRole {
  flex: none;
  width: 72px;
  color: var(--color-font-label);
}
.creditNames {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 14px;
  min-width: 0;
}
.creditName {
  display: flex;
  align-items: center;
  min-width: 0;
}
.creditAvatar {
  flex: none;
  width: 20px;
  height: 20px;
  margin-right: 6px;
  border-radius: 50%;
  object-fit: cover;
  background-color: var(--color-button-background);
}
.creditText {
  min-width: 0;
  .mixin-ellipsis-1();
}

.empty {
  padding: 16px 0;
  font-size: 12px;
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

  &:hover .cardImg,
  &:hover .thumb {
    transform: scale(1.04);
  }
}
.cardImg {
  width: 132px;
  height: 132px;
  border-radius: @radius-border;
  object-fit: cover;
  background-color: var(--color-button-background);
  transition: transform @transition-fast;
}
.mvCard {
  width: 208px;
}
.thumbBox {
  width: 208px;
  height: 117px;
  border-radius: @radius-border;
  overflow: hidden;
  background-color: var(--color-button-background);
}
.thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform @transition-fast;
}
.cardName {
  margin-top: 6px;
  font-size: 13px;
  .mixin-ellipsis-2();
}
.cardMeta {
  margin-top: 2px;
  font-size: 11px;
  color: var(--color-font-label);
  .mixin-ellipsis-1();
}
</style>
