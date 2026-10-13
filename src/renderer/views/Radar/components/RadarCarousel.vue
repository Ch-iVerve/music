<template>
  <div :class="$style.carousel" @wheel="handleWheel">
    <p v-if="!list.length" :class="$style.empty" v-text="noItem" />

    <template v-else>
      <!-- 舞台：中央主视觉 + 左右两翼；按住拖动左右滑，松手按位移/甩动速度换一张。
           `tabindex="0"` + `@keydown` 是键盘入口（工单 18）：Tab 过来、或点/拖一下舞台
           （pointerdown 里显式 focus），之后 ←/→ 换选一张、空格/回车播/暂停中央这首
           （与全局快捷键的边界见 handleKeyDown 的注释） -->
      <div
        ref="dom_stage"
        :class="$style.stage"
        tabindex="0"
        @pointerdown="handlePointerDown"
        @contextmenu="handleStageRightClick"
        @keydown="handleKeyDown"
      >
        <div :class="[$style.deck, { [$style.deckDragging]: isDragging }]" :style="{ transform: `translateX(${dragX}px)` }">
          <div
            v-for="item in visibleItems"
            :key="item.song.id"
            :class="[$style.item, { [$style.centerItem]: item.offset === 0 }]"
            :style="itemStyle(item)"
            @click.stop="handleItemClick(item)"
          >
            <img v-if="item.song.meta.picUrl" :class="$style.cover" loading="lazy" decoding="async" :src="item.song.meta.picUrl" alt="" draggable="false">
            <svg v-else :class="$style.coverFallback" version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" viewBox="0 0 425.2 425.2" space="preserve">
              <use xlink:href="#icon-album" />
            </svg>
          </div>
        </div>

        <!-- 中央的巨型播放/暂停键：正在播这首就是暂停键，否则是播放键 -->
        <button :class="$style.playBtn" :aria-label="isCurrentPlaying ? $t('player__pause') : $t('player__play')" :title="isCurrentPlaying ? $t('player__pause') : $t('player__play')" @click.stop="handlePlayClick" @pointerdown.stop>
          <!-- ⚠️ 这两个图标的坐标系是 1024×1024（见 Icons.vue 的注释），按 512 渲染会把图形裁掉一半 -->
          <svg v-if="isCurrentPlaying" version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" viewBox="0 0 1024 1024" space="preserve">
            <use xlink:href="#icon-pause" />
          </svg>
          <svg v-else :class="$style.playGlyph" version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" viewBox="0 0 1024 1024" space="preserve">
            <use xlink:href="#icon-play" />
          </svg>
        </button>
      </div>

      <!-- 中央这一首的信息（歌手名可点，工单 02）。`.stop` 不能删（工单 23）：多歌手时这次点击会打开
           选择菜单，而 base-menu 的「点空白收起」挂在 document 上，不停住冒泡就会被这次点击触发 -->
      <div :class="$style.info">
        <h2 :class="$style.name" :title="current?.name">{{ current?.name }}</h2>
        <p
          :class="[$style.singer, { [$style.jumpable]: current && canJumpToSinger(current) }]"
          :title="current && canJumpToSinger(current) ? $t('list__jump_singer') : (current?.singer || '')"
          @click.stop="handleSingerClick"
        >{{ current?.singer }}</p>
      </div>

      <!-- 按钮组：居中的下方。五个按键**固定等宽 + 图标统一尺寸 + 内容居中**
           （等宽靠 .btnAction；内容居中靠内部 flex 撑满——inline-block 按钮里的短内容会靠左） -->
      <div :class="$style.actions">
        <base-btn min :class="$style.btnAction" :disabled="isLoading" @click="$emit('refresh')">
          <span :class="$style.btnInner">
            <!-- ⚠️ 每个图标的坐标系不同，取自 Icons.vue 里各自的注释：refresh 是 24×24（按 448 渲染会缩成一个小点） -->
            <svg :class="$style.btnIcon" version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" viewBox="0 0 24 24" space="preserve"><use xlink:href="#icon-refresh" /></svg>
            <span>{{ $t('discover__refresh') }}</span>
          </span>
        </base-btn>
        <!-- 收藏键的心形与其余四处入口同一份映射（工单 10 立的 `favIconOf`，这里是工单 12 明说的
             漏网处）：未喜欢 → 空心 `#icon-love`，已喜欢 → 实心 `#icon-love-solid`。**形状是第一层**
             （灰度/高对比主题下颜色可能不生效），`btnIconOn` 的主色只是叠加的第二层。
             尺寸不动：这一排 6 个键的口径是同一个 14×14 盒（`.btnIcon`），心形的 viewBox 贴着墨迹裁，
             在该盒里墨迹 14.00×12.33，落在同排邻居（刷新 9.33×12.83 / 下载 14.03×14.03 /
             用户 10.81×13.26 / 专辑 14.03×14.03 / 更多 14.13×8.06）的区间内，不需要单独改。 -->
        <base-btn min :class="$style.btnAction" :disabled="!current" @click="handleToggleLove">
          <span :class="$style.btnInner">
            <svg :class="[$style.btnIcon, { [$style.btnIconOn]: isLoved }]" version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" viewBox="0 0 444.87 391.18" space="preserve"><use :xlink:href="favIconOf(isLoved)" /></svg>
            <span>{{ isLoved ? $t('list__unlove') : $t('list__love') }}</span>
          </span>
        </base-btn>
        <base-btn min :class="$style.btnAction" :disabled="!current || !canDownload" @click="handleDownload">
          <span :class="$style.btnInner">
            <svg :class="$style.btnIcon" version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" viewBox="0 0 425.2 425.2" space="preserve"><use xlink:href="#icon-download-2" /></svg>
            <span>{{ $t('list__download') }}</span>
          </span>
        </base-btn>
        <!-- 两个跳转（工单 02 的能力搬到按钮上）：多位歌手时会在按钮处弹出选择菜单。
             灰掉时补一句悬停说明（工单 05）：原来只有「灰 + 点了没反应」，看不出是坏了还是这首歌没这个信息。
             `.stop` 不能删（工单 23）：理由同上面那条歌手名（键盘 Tab+Enter 走的也是这条 click） -->
        <base-btn min :class="$style.btnAction" :disabled="!current || !canJumpToSinger(current)" :title="current && !canJumpToSinger(current) ? $t('list__jump_singer_disabled') : ''" @click.stop="handleJumpSingerClick">
          <span :class="$style.btnInner">
            <svg :class="$style.btnIcon" version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" viewBox="0 0 448 456" space="preserve"><use xlink:href="#icon-user" /></svg>
            <span>{{ $t('radar__to_singer') }}</span>
          </span>
        </base-btn>
        <base-btn min :class="$style.btnAction" :disabled="!current || !canJumpToAlbum(current)" :title="current && !canJumpToAlbum(current) ? $t('list__jump_album_disabled') : ''" @click="handleJumpAlbumClick">
          <span :class="$style.btnInner">
            <svg :class="$style.btnIcon" version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" viewBox="0 0 425.2 425.2" space="preserve"><use xlink:href="#icon-album" /></svg>
            <span>{{ $t('radar__to_album') }}</span>
          </span>
        </base-btn>
        <!-- 只在自动续页失败时露出：正常运行不需要手动翻页 -->
        <base-btn v-if="needMore" min :class="$style.btnAction" :disabled="isLoading" @click="$emit('load-more')">
          <span :class="$style.btnInner">
            <svg :class="$style.btnIcon" version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" viewBox="0 0 448 448" space="preserve"><use xlink:href="#icon-down" /></svg>
            <span>{{ $t('discover__load_more') }}</span>
          </span>
        </base-btn>
      </div>
      <p v-if="moreError" :class="$style.error" v-text="moreError" />
    </template>

    <base-menu v-model="isShowItemMenu" :menus="menus" :xy="menuLocation" item-name="name" @menu-click="handleMenuClick" />
    <!-- 多位歌手时让用户挑（工单 02）：与歌曲表同一套 base-menu -->
    <base-menu v-model="isShowSingerPicker" :menus="singerPickerMenus()" :xy="singerPickerXy" item-name="name" @menu-click="handleSingerPickerClick" />
    <common-list-add-modal v-model:show="isShowListAdd" :music-info="selectedAddMusicInfo" teleport="#view" />
    <!-- 视图内弹窗都要 teleport="#view"（§2.5.1 第 2 条）：漏了会落到默认的 #root、把整窗压暗 -->
    <common-download-modal v-model:show="isShowDownload" :music-info="selectedDownloadMusicInfo" teleport="#view" />
  </div>
</template>

<script lang="ts">
import { computed, ref, watch } from '@common/utils/vueTools'
import { playMusicList, togglePlay } from '@renderer/core/player'
import { musicInfo, isPlay, playInfo } from '@renderer/store/player/state'
import { tempListMeta } from '@renderer/store/list/state'
import { addTempPlayList } from '@renderer/store/player/action'
import { isFavSongInCloud } from '@renderer/store/user/action'
import { addDislikeWithCloud, hasDislike } from '@renderer/core/dislikeList'
import { dialog } from '@renderer/plugins/Dialog'
import { useI18n } from '@renderer/plugins/i18n'
import { LIST_IDS } from '@common/constants'
import useMusicActions from '@renderer/components/material/OnlineList/useMusicActions'
import useMusicAdd from '@renderer/components/material/OnlineList/useMusicAdd'
import useMusicDownload from '@renderer/components/material/OnlineList/useMusicDownload'
import useMenu from '@renderer/components/material/OnlineList/useMenu'
import { assertApiSupport } from '@renderer/store/utils'
import useFavSong, { favIconOf } from '@renderer/utils/compositions/useFavSong'
import useRadar, { RADAR_QUEUE_ID, type RadarBlock } from '../useRadar'
import { DAILY_30_QUEUE_ID } from '../useDaily30'
import { DRAG_SLOP, pushSample, resolveSwipeStep, sampleVelocity, type SwipeSample } from '../swipe'
import { FOLLOW_STAY, resolveFollowCursor } from '../followPlaying'

/**
 * 雷达的「居中轮播」形态（工单 07 的形态迭代，2026-09-23 用户要求：
 * 主视觉居中、中央一个巨大的播放/暂停键、左右滑动挑选、按钮放居中下方、不要列表铺开）。
 *
 * 分工与约束：
 * - **播放语义不回归**（工单 06 方案 B）：点中央播放键 = 从这一首开始连播雷达整串；
 *   卡片右键菜单仍与歌曲表完全一致（复用 OnlineList 的 useMenu / useMusicActions / useMusicAdd /
 *   useMusicDownload，不另写一套判定）；翻页拿到的新歌仍由 useRadar 的 appendToPlayQueue 接到队列尾部。
 * - **滑动挑选 ≠ 播放**：左右滑动只换「当前选中的那一张」，不自动开播（用户的动作要能预期）。
 * - **键盘可达（工单 18）**：舞台是个 tab 停靠点，聚焦后 ←/→ 换选、空格/回车播/暂停；与
 *   应用级快捷键的边界见 `handleKeyDown` 的注释（核心是「只认无修饰键 + 只认舞台自己」）。
 * - **触屏手感（工单 18）**：按住拖动时 deck 不过渡（1:1 跟手），松手按「位移优先、甩动其次」
 *   换一张，回落是 deck 的减速过渡。判定规则抽在 `../swipe`，纯函数、有单测。
 * - **切歌即跟随（工单 12）**：播放曲目变化时（本 tab 的队列在播、且这首歌在本 tab 列表里）
 *   把游标算到它身上——视觉上就是横滚到中央。判定在 `../followPlaying`；时机与三条边界
 *   见下面 `isCurrentQueue` / `watch` 两处注释（要点是只认播放曲目的变化，不跟用户的手抢）。
 * - 有意丢掉的能力（表格有、轮播没有）：多选与批量操作、列排序。雷达是「一张一张推给你」的场景。
 * - 两翼只渲染 ±2 张，其余靠滑动到达；到接近末尾时自动请求下一页（`needMore`），失败才露出按钮。
 */
export default {
  name: 'RadarCarousel',
  props: {
    block: {
      type: Object as () => RadarBlock,
      required: true,
    },
    /** 当前 tab：决定游标槽与播放队列身份。父组件用 `:key="tab"` 重建本组件，故实例内视为常量。 */
    tab: {
      type: String as () => 'radar' | 'daily30',
      default: 'radar',
    },
  },
  emits: ['load-more', 'refresh'],
  setup(props: { block: RadarBlock, tab: 'radar' | 'daily30' }, { emit }: { emit: (event: 'load-more' | 'refresh') => void }) {
    const list = computed(() => props.block.list)
    const noItem = computed(() => props.block.noItemLabel)
    const isLoading = computed(() => props.block.isLoading)
    const moreError = computed(() => props.block.moreError)

    // 游标放在模块级（useRadar 的分槽状态）：路由页没有 keep-alive，切走再回来本组件会重建，
    // 游标留在组件内 `ref` 里就会归零——「跳去歌手页再回来位置重置」就是这么来的（票 02）。
    // 两个 tab 各一槽（票 04），槽名就是 tab 名。
    const cursorSlot = props.tab
    /** 播放队列身份：两个 tab 是两批歌，队列标识分开，续播判定（useRadar.appendToPlayQueue）才不会串。 */
    const queueId = props.tab === 'daily30' ? DAILY_30_QUEUE_ID : RADAR_QUEUE_ID
    const { getCursor, setCursor } = useRadar()
    const centerIndex = computed({
      get: () => getCursor(cursorSlot),
      set: (index: number) => { setCursor(index, cursorSlot) },
    })
    const current = computed(() => list.value[Math.min(centerIndex.value, Math.max(list.value.length - 1, 0))])

    // 列表变短（换一批）时把游标拉回范围；immediate 是因为切回来时列表可能已经变短了
    watch(() => list.value.length, (len) => {
      if (centerIndex.value > len - 1) centerIndex.value = Math.max(len - 1, 0)
    }, { immediate: true })

    // 正在播放的就是「中央这一首」时，大按钮变成暂停键
    const isCurrentPlaying = computed(() => !!current.value && musicInfo.id === current.value.id && isPlay.value)

    // ── 切歌即跟随（工单 12）────────────────────────────────────────────────
    /**
     * 本列表此刻是不是「正在播的那个队列」（跟随的身份闸）。
     *
     * ⚠️ 刻意写成**普通函数、当场读**，不包成 computed：`tempListMeta` 是普通对象（不可响应），
     * 而「换一个在线队列」时 `playInfo.playerListId` 恒为 `temp`（值没变 → 缓存的 computed 不会重算），
     * 于是它会一直拿上一个队列的身份答话。踩中的场景：雷达在播 → 去专辑页点一首**恰好也在雷达
     * 列表里**的歌 → 缓存答 true → 游标被跟到那张上，而用户这会儿听的是专辑队列。
     * 口径与 `useRadar.appendToPlayQueue` 一字不差：雷达队列一律灌进临时列表播（票 04 的队列 id）。
     */
    const isCurrentQueue = () =>
      playInfo.playerListId === LIST_IDS.TEMP && tempListMeta.id === queueId

    /**
     * 「点上下曲记得左右滚动到播放的歌」（用户 2026-09-24）。
     *
     * 轮播的滚动就是游标（deck 用 transform 摆位），所以跟随 = 把游标算到正在播放那一张上，
     * 判定在 `../followPlaying`（纯函数、有单测）。三条边界都是「不跟用户的手抢」的不同侧面：
     *
     * 1. **只监听播放曲目**（队列身份 / 队列内下标 / 歌 id），不监听游标——用户滑动、滚轮、←/→
     *    动的是游标，没有这条依赖就永远不会被改回去；而播放栏上一首/下一首、快捷键、托盘、
     *    自然播完的自动下一首都必然改这几项，所以一并覆盖。
     * 2. **没有 `immediate`**：切 tab 会重建本组件（父组件 `:key="tab"`），进来就跟随会把票
     *    02/04 那句「两个 tab 各自停在原来的位置」顶掉。只有**本组件活着时播放曲目变了**才跟。
     * 3. **不跟列表变化**：「换一批」后游标按既有设计回第 1 张（`useRadar.setSongs` 的
     *    `resetCursor`），正在播的那首若恰在新列表里也不回跟——那一刻用户的意图是换内容。
     */
    watch(
      () => [isCurrentQueue(), playInfo.playIndex, musicInfo.id] as const,
      ([inQueue, playIndex, playingId]) => {
        const next = resolveFollowCursor({
          list: list.value,
          isCurrentQueue: inQueue,
          playIndex,
          playingId,
          cursor: centerIndex.value,
        })
        // FOLLOW_STAY（-1）= 判定为「不动」：不在本列表 / 没在播 / 已经在中央
        if (next !== FOLLOW_STAY) centerIndex.value = next
      },
    )

    // ── 滑动 / 滚轮：动作都是「换一张」────────────────────────────────────
    /** 舞台 DOM：键盘只在「焦点就在舞台上」时接管（工单 18，判定见 handleKeyDown）。 */
    const dom_stage = ref<HTMLElement | null>(null)
    const dragX = ref(0)
    let dragStartX = 0
    /**
     * 拖动中（模板据此挂 `.deckDragging`）：按住时 deck 必须**没有**过渡，
     * 位移才 1:1 跟手——原来 deck 一直带 `@transition-fast`，触屏上表现为卡片黏在手指后面半拍。
     */
    const isDragging = ref(false)
    /** 拖动刚结束的那次 click 不算点击（否则滑一下就把中央这首播了）。 */
    let ignoreNextClick = false
    /** 最近一段指针采样：松手时据此算速度（判定规则在 swipe.ts，纯函数、有单测）。 */
    let samples: SwipeSample[] = []

    const canGoNext = computed(() => centerIndex.value < list.value.length - 1)
    const canGoPrev = computed(() => centerIndex.value > 0)

    const handlePointerMove = (event: PointerEvent) => {
      if (!isDragging.value) return
      dragX.value = event.clientX - dragStartX
      samples = pushSample(samples, event.clientX, performance.now())
      if (Math.abs(dragX.value) > DRAG_SLOP) ignoreNextClick = true
    }
    const removeDragListeners = () => {
      document.removeEventListener('pointermove', handlePointerMove)
      document.removeEventListener('pointerup', handlePointerUp)
      document.removeEventListener('pointercancel', handlePointerCancel)
    }

    /**
     * 松手（工单 18 的触屏手感）。三件事，顺序即语义：
     *
     * 1. **换不换一张由 `resolveSwipeStep` 定**，只能是 0 或 ±1：位移过 60px，或位移不够但
     *    甩得快（`FLING_VELOCITY`）——触屏上「轻轻一甩」的位移常常不到 60px，只按位移判会甩不动。
     * 2. **回落交给 CSS**：`dragX = 0` + 摘掉 `.deckDragging`，deck 的 340ms 减速过渡把
     *    「松手 → 吸附回原位」演成一段带减速的动画，而不是原来那种一帧跳回（也就是用户说的「生硬」）。
     *    落点恒定在 0，即「一次一张」；不做速度外推的长距离惯性——那正是工单禁止的「滑三张停不下」。
     * 3. 换选了就吃掉紧随其后的那次 click：甩动的位移可能不到 `DRAG_SLOP`，不被 pointermove 标记，
     *    不吃掉的话刚挪到中间的那张会被这次 click 直接播掉（与「滑动挑选 ≠ 播放」冲突）。
     */
    const handlePointerUp = () => {
      if (!isDragging.value) return
      isDragging.value = false
      removeDragListeners()
      const dx = dragX.value
      // 速度要拿「松手时刻」再裁一次窗口：手指停住后再松不会有新采样，窗口不会自己滚动，
      // 不裁的话会把停手前的旧点当成甩动（甩不动的手势反而换了一张）
      const velocity = sampleVelocity(samples, performance.now())
      samples = []
      dragX.value = 0
      const step = resolveSwipeStep({ dx, velocity, canPrev: canGoPrev.value, canNext: canGoNext.value })
      if (!step) return
      ignoreNextClick = true
      centerIndex.value += step
    }

    /**
     * 手势被系统取消（触屏上最常见：纵滑被系统/滚动容器抢走，或长按菜单介入）。
     * **不换选**——用户没做出「松手」这个动作，拿半个手势换一张是不可预期的；只把位移收回去。
     * 单列一个处理函数就是在修这个「原来和 pointerup 共用、取消了也照样算换选」的问题。
     */
    const handlePointerCancel = () => {
      if (!isDragging.value) return
      isDragging.value = false
      removeDragListeners()
      samples = []
      dragX.value = 0
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return // 右键留给菜单
      if (!event.isPrimary) return // 多指：只认第一根手指，否则第二根会把拖动起点改掉
      // 把键盘焦点一并交给舞台（工单 18）：这样「点一下/拖一下舞台，接着按 ←/→」也能用，
      // 不必先 Tab 一轮。不靠浏览器对「非可聚焦元素的点击焦点」那套推断，行为才确定。
      // `preventScroll`：焦点切换不要把页面滚一下。点中央播放键走的是它自己的实现
      // （`@pointerdown.stop`），焦点留在那个按钮上——那时空格是原生激活按钮，同样等于播/暂停。
      dom_stage.value?.focus({ preventScroll: true })
      isDragging.value = true
      dragStartX = event.clientX
      dragX.value = 0
      samples = []
      ignoreNextClick = false
      // 不用 setPointerCapture：capture 之后 Chromium 会把 click 的 target 重定向到捕获元素，
      // 卡片自己的 @click 就失灵了（播放键当初靠 @pointerdown.stop 绕开的就是这个）。
      // 改挂 document 监听：照样能拖出舞台，但不动 click 的语义。
      document.addEventListener('pointermove', handlePointerMove)
      document.addEventListener('pointerup', handlePointerUp)
      document.addEventListener('pointercancel', handlePointerCancel)
    }

    /**
     * 滚轮 / 触控板横滚 = 换一张（用户 2026-09-23 报：雷达页原先只认鼠标拖动）。
     * 触控板会连发一串 wheel（还有惯性），所以加冷却——一次滚动只走一张。
     */
    const WHEEL_COOLDOWN = 220
    let lastWheelAt = 0
    const handleWheel = (event: WheelEvent) => {
      const delta = Math.abs(event.deltaX) >= Math.abs(event.deltaY) ? event.deltaX : event.deltaY
      if (!delta) return
      event.preventDefault()
      const now = Date.now()
      if (now - lastWheelAt < WHEEL_COOLDOWN) return
      if (delta > 0) {
        if (!canGoNext.value) return
        centerIndex.value++
      } else {
        if (!canGoPrev.value) return
        centerIndex.value--
      }
      lastWheelAt = now
    }

    /** 点两翼 = 把那一张挪到中间（不播放） */
    const handleItemClick = (item: { offset: number }) => {
      if (ignoreNextClick) {
        ignoreNextClick = false
        return
      }
      if (item.offset === 0) {
        handlePlayClick()
        return
      }
      const next = centerIndex.value + item.offset
      if (next >= 0 && next < list.value.length) centerIndex.value = next
    }

    // 两翼只渲染 ±2：每张的位移/缩放/透明度由 offset 派生
    const visibleItems = computed(() => {
      const items: Array<{ song: LX.Music.MusicInfoOnline, offset: number }> = []
      for (let offset = -2; offset <= 2; offset++) {
        const song = list.value[centerIndex.value + offset]
        if (song) items.push({ song, offset })
      }
      return items
    })
    const itemStyle = (item: { offset: number }) => {
      const offset = item.offset
      const scale = offset === 0 ? 1 : offset === 1 || offset === -1 ? 0.76 : 0.6
      const x = offset === 0 ? 0 : offset === 1 || offset === -1 ? 62 : 106
      const opacity = offset === 0 ? 1 : offset === 1 || offset === -1 ? 0.8 : 0.4
      return {
        transform: `translate(-50%, -50%) translateX(${x * Math.sign(offset)}%) scale(${scale})`,
        opacity,
        zIndex: 10 - Math.abs(offset),
      }
    }

    // ── 播放 ────────────────────────────────────────────────────────────────
    const handlePlayClick = () => {
      if (!current.value) return
      if (musicInfo.id === current.value.id) {
        // 已经是这一首：大按钮就是播放/暂停开关
        togglePlay()
        return
      }
      void playMusicList(queueId, [...list.value], centerIndex.value)
    }

    // ── 键盘（工单 18）────────────────────────────────────────────────────
    /**
     * 焦点在**舞台自己**身上时：←/→ 换选一张、空格/回车播/暂停中央这首。
     *
     * ⚠️ 与 `core/useApp` 那层应用级快捷键的边界（动手前先读了 `src/renderer/event/keyEvent.ts`
     * + `src/common/defaultHotKey.ts`，三条都是那层的现状推出来的，改那片代码时要回来对一遍）：
     *
     * 1. **带修饰键的一律放行**（不 stopPropagation）：应用级默认绑的是 `mod+f5`（播放/暂停）、
     *    `mod+←/→`（上一首/下一首）、`f1`（搜索），用户还能在「设置 → 快捷键」里改绑。
     *    所以 `mod+←/→` 在轮播聚焦时仍然是「上一首/下一首」，不被这里的「换选」顶掉。
     * 2. **只认无修饰键**：默认配置里 plain `←`/`→`/空格/回车 都没绑，所以「聚焦轮播 → 这四个键归轮播」
     *    碰不到默认快捷键。用户若手动把某个 plain 键改绑成应用快捷键，则以「焦点在轮播内优先」为准
     *    （工单 18 的口径：只在焦点进轮播时接管）——想用那条应用快捷键，把焦点移出轮播（Tab 走开）
     *    或改用带修饰键的写法即可。这里不是靠猜键位，而是靠**焦点边界**划清两套语义。
     * 3. **事件目标必须是舞台自己**：Tab 到舞台里的按钮上时（中央播放键、底部 5 个键），
     *    空格/回车该由浏览器去激活那个按钮，这里不抢——否则一次空格会既点按钮又播歌。
     *
     * 动作语义与鼠标完全一致：换选**不等于**播放（与 `handleItemClick` 同款），
     * 空格/回车直接走 `handlePlayClick`——正在播这首就暂停、否则从这首开播，与中央大键同一个函数。
     */
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.target !== dom_stage.value) return
      if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return

      // 空格/回车：播/暂停中央这首。先接管再判重复——长按时那串重复事件不该漏到应用级那层去，
      // 也不该让页面滚动（`preventDefault`）
      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault()
        event.stopPropagation()
        if (event.repeat) return // 长按不重复触发：按住不放会在「播→停→播」之间来回跳
        handlePlayClick()
        return
      }
      // 其余按键（esc / tab / f1…）不拦：esc 退全屏、tab 走焦点、f1 进搜索都是应用级那层的事
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return

      // ←/→ 换选一张，**认长按**（按住可以连续翻，与列表里按方向键的习惯一致）。
      // 到两端也照样接管：按键语义要跟位置无关，别出现「到头了才透传给应用级」的飘忽行为
      event.preventDefault()
      event.stopPropagation()
      const delta = event.key === 'ArrowLeft' ? -1 : 1
      const canStep = delta < 0 ? canGoPrev.value : canGoNext.value
      if (canStep) centerIndex.value += delta
    }

    // ── 底部按键都作用于「中央这一首」────────────────────────────────────
    const t = useI18n()

    // 收藏 = 收藏到 QQ 音乐的「我喜欢」（与播放栏收藏键、快捷键 music_love 同一套语义）。
    // 本地收藏已取消（2026-09-24），所以「已收藏没」问云端：全量 id 集合在 store/user 里缓存，
    // 收藏/取消后就地更新（isFavSongInCloud 读的是 shallowReactive 数组，computed 会跟着变）。
    // `favIconOf` 只按 `isLoved` 取图标（映射在 `useFavSong` 一处，与另外四处入口共用），
    // 直接给模板用——Options API 的 setup 里拿不到本组件的 computed，而在 computed 里写
    // `favIconOf(...)` 会被 `@typescript-eslint/unbound-method` 判成「把方法当值传出去」。
    const isLoved = computed(() => !!current.value && isFavSongInCloud(current.value))
    // 动作走**共用入口** `useFavSong().toggleFav`（与行内键 / 右键菜单 / 播放栏 / 播放详情页同一条）。
    // 别在这里自己按 `isLoved` 判方向：`toggleFav` 会先 await `loadFavSongIds()` 再定方向，而 `isLoved`
    // 在 id 集合没拉完或拉失败时恒为 false——那时点「取消喜欢」会走成「加入」，歌已经在里面，
    // 用户看到的就是「点了没反应」（票 09 根因 D 的实测口径）。`isLoved` 只留给图标与文案显示。
    const { toggleFav, loadFavState } = useFavSong()
    // 只影响按钮状态，拉不到（未登录等）按「没收藏」处理，不让雷达页报错
    loadFavState()
    const handleToggleLove = async() => {
      await toggleFav(current.value)
    }

    /**
     * 不喜欢：确认后写进不喜欢列表并**把游标挪到下一首**（推荐流里这一步才是重点）。
     * 底部按钮按用户 2026-09-23 的要求去掉了「不喜欢」，但卡片右键菜单里还有这一项——
     * 菜单那一路也接到这里（而不是 OnlineList 的 `useMusicActions.handleDislikeMusic`），
     * 因为那个实现不告诉调用方「用户是否真的确认了」，而我们据此决定要不要前进。
     */
    const handleDislike = async() => {
      const song = current.value
      if (!song) return
      if (hasDislike(song)) {
        void dialog({ message: t('lists__dislike_music_tip', { name: song.name }), confirmButtonText: t('ok') })
        return
      }
      const confirm = await dialog.confirm({
        message: song.singer
          ? t('lists__dislike_music_singer_tip', { name: song.name, singer: song.singer })
          : t('lists__dislike_music_tip', { name: song.name }),
        cancelButtonText: t('cancel_button_text_2'),
        confirmButtonText: t('confirm_button_text'),
      })
      if (!confirm) return
      await addDislikeWithCloud(song)
      if (canGoNext.value) centerIndex.value++
    }

    // 雷达列表只有在线的 tx 歌（`MusicInfoOnline` 的类型就是 tx），所以不必再判 local
    const canDownload = computed(() => !!current.value && assertApiSupport(current.value.source))

    // ── 到底了就自动续（流式推荐），失败才露出「加载更多」──────────────
    const needMore = computed(() => !!moreError.value)
    watch(centerIndex, (index) => {
      if (!props.block.hasMore || props.block.isLoading) return
      if (index >= list.value.length - 2) emit('load-more')
    })

    // ── 右键菜单：与表格同源（工单 02 的跳转/分享一并复用）────────────────
    const selectedList = ref<LX.Music.MusicInfoOnline[]>([])
    const actions = useMusicActions({ props: { list: props.block.list, listId: queueId } })
    const { isShowListAdd, selectedAddMusicInfo, handleShowMusicAddModal } = useMusicAdd({ selectedList, props: props.block })
    const { isShowDownload, selectedDownloadMusicInfo, handleShowDownloadModal } = useMusicDownload({ selectedList, props: props.block })

    // 下载按键复用这个弹窗（`single=true` → 对「中央这一首」操作）
    const handleDownload = () => { handleShowDownloadModal(centerIndex.value, true) }

    // 两个跳转按钮（工单 02 的能力搬到按钮上）：多位歌手时把选择菜单弹在按钮处
    const handleJumpSingerClick = (event: MouseEvent) => {
      if (!current.value) return
      void actions.handleJumpSinger(centerIndex.value, { x: event.pageX, y: event.pageY })
    }
    const handleJumpAlbumClick = () => {
      if (!current.value) return
      actions.handleJumpAlbum(centerIndex.value)
    }

    const handlePlayMusicLater = (index: number) => {
      addTempPlayList([{ listId: LIST_IDS.PLAY_LATER, musicInfo: props.block.list[index] }])
    }

    const { menus, menuLocation, isShowItemMenu, showMenu, menuClick } = useMenu({
      props: props.block,
      assertApiSupport,
      emit: () => {},

      handleShowDownloadModal,
      handlePlayMusic: (index: number) => { void playMusicList(queueId, [...list.value], index) },
      handlePlayMusicLater,
      handleSearch: actions.handleSearch,
      handleShowMusicAddModal,
      handleOpenMusicDetail: actions.handleOpenMusicDetail,
      // 菜单的「不喜欢」接本组件的实现（确认后前进一张），见 handleDislike 的注释
      handleDislikeMusic: () => { void handleDislike() },

      handleJumpAlbum: actions.handleJumpAlbum,
      handleJumpSinger: actions.handleJumpSinger,
      handleCopyLink: actions.handleCopyLink,
      handleOpenInQqMusic: actions.handleOpenInQqMusic,
    })

    const handleStageRightClick = (event: MouseEvent) => {
      if (!current.value) return
      showMenu(event, current.value)
    }
    const handleMenuClick = (action: { action: string } | null) => {
      menuClick(action, centerIndex.value, menuLocation)
    }
    const handleSingerClick = (event: MouseEvent) => {
      if (!current.value) return
      actions.handleSingerNameClick(current.value, event)
    }

    return {
      list,
      noItem,
      isLoading,
      moreError,
      needMore,
      current,
      isCurrentPlaying,
      centerIndex,
      dom_stage,
      dragX,
      isDragging,
      visibleItems,
      itemStyle,
      handlePointerDown,
      handleWheel,
      handleKeyDown,
      handleItemClick,
      handlePlayClick,
      handleStageRightClick,
      handleMenuClick,
      handleSingerClick,
      handleToggleLove,
      isLoved,
      favIconOf,
      handleDislike,
      handleDownload,
      handleJumpSingerClick,
      handleJumpAlbumClick,
      canJumpToSinger: actions.canJumpToSinger,
      canJumpToAlbum: actions.canJumpToAlbum,
      canDownload,

      menus,
      menuLocation,
      isShowItemMenu,

      isShowListAdd,
      selectedAddMusicInfo,
      isShowDownload,
      selectedDownloadMusicInfo,

      isShowSingerPicker: actions.isShowSingerPicker,
      singerPickerXy: actions.singerPickerXy,
      singerPickerMenus: actions.singerPickerMenus,
      handleSingerPickerClick: actions.handleSingerPickerClick,
    }
  },
}
</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.carousel {
  flex: auto;
  min-height: 0;
  display: flex;
  flex-flow: column nowrap;
  align-items: center;
  justify-content: center;
}
.empty {
  padding: 40px 0;
  text-align: center;
  font-size: 16px;
  color: var(--color-font-label);
}

// 舞台：定高，主视觉居中；两翼超出部分裁掉
.stage {
  position: relative;
  flex: none;
  width: 100%;
  max-width: 900px;
  // 主视觉的尺寸（滑动时两翼按百分比位移，单位就是它的宽）。
  // 随窗口高度收缩：矮窗口（最小 920×600）下底部按键原本会被播放栏压住、点不到（票 01），
  // clamp 的下限 180px 保证再矮也不会缩没。
  --cover: clamp(180px, calc(100vh - 380px), 300px);
  height: calc(var(--cover) + 24px);
  // 两翼超出部分裁掉。但**不能用 `overflow: hidden`**：卡片阴影是 `0 6px 22px`
  // （向下伸到 28px、向上 16px），而这里上下各只留 12px，hidden 会把阴影切出一条硬边
  // （2026-09-24 用户报「图片下的阴影好像被切断」；实测底边下方灰度 253 → 255 直接跳白）。
  // `overflow: clip` + `overflow-clip-margin: 30px` 把**裁剪框**外扩 30px、布局尺寸一分不变；
  // 拖动时两翼位移远大于 30px，照旧裁得住（clip 也不像 hidden 那样创建滚动容器）
  overflow: clip;
  overflow-clip-margin: 30px;
  cursor: grab;
  &:active {
    cursor: grabbing;
  }
  // 拖动时不要选中文字/触发浏览器拖图
  user-select: none;
  // 触屏（工单 18）：横向拖拽归本组件，纵向手势留给系统。
  // 不写 `none`——万一以后套进可滚动容器，舞台上的纵滑还得能滚页。
  touch-action: pan-y;
  // 键盘可达（工单 18）：焦点指示画在**中央那张封面**上，而不是舞台这个 900px 宽的空盒子上
  // （给舞台画框会是一圈包住大片空白的矩形，看不出「键盘在操作哪一张」）。
  // 只在键盘聚焦时出框：base-btn 那套 `outline: none` 是给鼠标点击用的，鼠标不走 :focus-visible。
  &:focus-visible .centerItem {
    outline: 2px solid var(--color-primary);
    outline-offset: 3px;
  }
}
.deck {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 0;
  height: 0;
  // 松手后的回落（工单 18）：340ms 减速曲线，比原来的 @transition-fast 稍长，
  // 让「松手 → 吸附回中」看起来是一段惯性收尾而不是一帧跳回。曲线不过冲（不用 back-out）：
  // 落点必须一眼可预期，回弹过冲会像「没停稳」。
  transition: transform 340ms cubic-bezier(.22, .61, .36, 1);
}
// 按住拖动时**必须**关掉过渡：dragX 跟的是手指，带过渡就会有半拍延迟（橡皮筋感）。
// 放在 .deck 之后，两条同时命中时这条赢（同优先级、后者胜）。
.deckDragging {
  transition: none;
}
.item {
  position: absolute;
  left: 0;
  top: 0;
  width: var(--cover);
  height: var(--cover);
  // 居中靠 transform 的 translate(-50%,-50%)（itemStyle 里拼的），这里**不要**再加负 margin，
  // 两者叠加会把封面推到舞台左上方 150px（实测踩过）
  border-radius: 10px;
  overflow: hidden;
  background-color: var(--color-button-background);
  box-shadow: 0 6px 22px 0 rgba(0, 0, 0, .22);
  transition: transform @transition-normal, opacity @transition-normal;
  img {
    -webkit-user-drag: none;
  }
}
.centerItem {
  cursor: default;
}
.cover {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.coverFallback {
  position: absolute;
  left: 28%;
  top: 28%;
  width: 44%;
  height: 44%;
  fill: var(--color-font-label);
}

// 中央巨型播放/暂停键：**白底 + 深色图形**（Spotify / Apple Music 那一路），压在任意封面上都干净。
// 别用半透明黑底（发灰发脏）、也别加白色描边（像贴纸）——用户 2026-09-23 连着否掉这两版。
.playBtn {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 84px;
  height: 84px;
  margin: -42px 0 0 -42px;
  padding: 0;
  border: none;
  outline: none;
  cursor: pointer;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  color: #14161a;
  background-color: rgba(255, 255, 255, .94);
  box-shadow: 0 4px 18px 0 rgba(0, 0, 0, .28);
  transition: @transition-fast;
  transition-property: transform, box-shadow, background-color;
  svg {
    width: 36%;
    height: 36%;
    fill: currentColor;
  }
  &:hover {
    transform: scale(1.05);
    background-color: #fff;
    box-shadow: 0 6px 22px 0 rgba(0, 0, 0, .34);
  }
  &:active {
    transform: scale(.97);
  }
}
// 三角形重心偏左，视觉居中要往右挪一点（暂停键的两条竖条不需要）
.playGlyph {
  transform: translateX(7%);
}

// 底部按键：**固定等宽**（大小不统一被用户点过两次），内容用内部 flex 撑满后居中
.btnAction {
  width: 96px;
}
.btnInner {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  width: 100%;
}
// 图标统一 14×14：不同图标的 viewBox 内留白不一样，给定尺寸才不至于有的看着像没有图标
.btnIcon {
  width: 14px;
  height: 14px;
  flex: none;
  fill: currentColor;
}
.btnIconOn {
  fill: var(--color-primary);
}

.info {
  flex: none;
  width: 100%;
  max-width: 640px;
  padding: 14px 16px 0;
  box-sizing: border-box;
  text-align: center;
}
.name {
  font-size: 18px;
  font-weight: 600;
  .mixin-ellipsis-1();
}
.singer {
  margin-top: 6px;
  font-size: 13px;
  color: var(--color-font-label);
  .mixin-ellipsis-1();
}
.jumpable {
  cursor: pointer;
  &:hover {
    text-decoration: underline;
  }
}

// 按钮组：居中的下方（用户要求「按键放到居中的下方」）
.actions {
  flex: none;
  display: flex;
  align-items: center;
  gap: 12px;
  padding-top: 18px;
}
.error {
  padding-top: 8px;
  font-size: 12px;
  color: var(--color-font-label);
}
</style>
