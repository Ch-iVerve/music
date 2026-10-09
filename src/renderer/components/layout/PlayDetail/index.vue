<template lang="pug">
transition(enter-active-class="animated slideInRight" leave-active-class="animated slideOutDown" @after-enter="handleAfterEnter" @after-leave="handleAfterLeave")
  div(v-if="isShowPlayerDetail" :class="[$style.container, { fullscreen: isFullscreen }]" @contextmenu="handleContextMenu")
    div(:class="$style.bg")
    //- div(:class="$style.bg" :style="bgStyle")
    //- div(:class="$style.bg2")
    ControlBtnsLeftHeader(v-if="appSetting['common.controlBtnPosition'] == 'left'")
    ControlBtnsRightHeader(v-else)
    div(:class="[$style.main, {[$style.showComment]: isShowPlayComment}]")
      div.left(:class="[$style.left, { [$style.infoPageCenter]: isInfoPageCenter }]")
        //- div(:class="$style.info")
        div(:class="[$style.info, { [$style.aligning]: isAligning }]")
          img(v-if="musicInfo.pic" :class="$style.img" :src="musicInfo.pic")
          div.description(:class="['scroll', $style.description]")
            p {{ $t('player__music_name') }}{{ musicInfo.name }}
            //- 不可跳时也给一句悬停说明（工单 05）：原来是「没有 cursor、点了毫无反应」，用户不知道是灰的还是坏了
            //- `.stop` 不能删（工单 23）：多歌手时这次点击会打开选择菜单，而 base-menu 的「点空白收起」
            //- 挂在 document 上——不停住冒泡，菜单会被**打开它的这次点击**立刻关掉（真机表现为
            //- 「第一次点能弹、之后再点弹不出来」，成因与实测见 useMusicJump 里 picker 那段的注释）
            p(
              :class="{ [$style.jumpable]: canJumpToSinger(playMusicInfo.musicInfo) }"
              :title="canJumpToSinger(playMusicInfo.musicInfo) ? $t('list__jump_singer') : $t('list__jump_singer_disabled')"
              @click.stop="handlePlayDetailSingerClick"
            ) {{ $t('player__music_singer') }}{{ musicInfo.singer }}
            p(
              v-if="musicInfo.album"
              :class="{ [$style.jumpable]: canJumpToAlbum(playMusicInfo.musicInfo) }"
              :title="canJumpToAlbum(playMusicInfo.musicInfo) ? $t('list__jump_album') : $t('list__jump_album_disabled')"
              @click="handlePlayDetailAlbumClick"
            ) {{ $t('player__music_album') }}{{ musicInfo.album }}
            //- 播放详情页 ↔ 歌曲详情页互跳（工单 02）：本地文件没有 mid，不出这个入口
            p(
              v-if="canShareMusic(playMusicInfo.musicInfo)"
              :class="$style.jumpLink"
              @click="handleOpenSongDetail"
            ) {{ $t('player__open_song_detail') }}

      transition(enter-active-class="animated fadeIn" leave-active-class="animated fadeOut")
        LyricPlayer(v-if="visibled")
      music-comment(v-if="visibled" :class="$style.comment" :show="isShowPlayComment" :music-info="playMusicInfo.musicInfo" @close="hideComment")
    transition(enter-active-class="animated fadeIn" leave-active-class="animated fadeOut")
      play-bar(v-if="visibled")
    transition(enter-active-class="animated-slow fadeIn" leave-active-class="animated-slow fadeOut")
      common-audio-visualizer(v-if="appSetting['player.audioVisualization'] && visibled")
    //- 多位歌手时的歌手选择菜单（工单 05）：与歌曲表 / 歌曲详情页同一套 base-menu。
    //- 这一页原来**没有渲染它** —— useMusicJump 把 picker 打开也没人显示，于是「点歌手名」在多歌手的歌上静默无反应。
    //- 它 teleport 到 #root（z-index 10，压得住本页的 z-index 10 与播放栏），所以放在这个 v-if 的容器里即可；
    //- 放在这里而不是 transition 外面，是为了跟随详情页的开关一起挂载/卸载。
    base-menu(v-model="isShowSingerPicker" :menus="singerPickerMenus()" :xy="singerPickerXy" item-name="name" @menu-click="handleSingerPickerClick")
</template>


<script>
import { ref, computed, watch } from '@common/utils/vueTools'
import { isFullscreen } from '@renderer/store'
import { lyric } from '@renderer/store/player/lyric'
import {
  isShowPlayerDetail,
  isShowPlayComment,
  musicInfo,
  playMusicInfo,
} from '@renderer/store/player/state'
import {
  setShowPlayerDetail,
  setShowPlayComment,
  setShowPlayLrcSelectContentLrc,
} from '@renderer/store/player/action'
import LyricPlayer from './LyricPlayer.vue'
import PlayBar from './PlayBar.vue'
import MusicComment from './components/MusicComment/index.vue'
import ControlBtnsLeftHeader from './ControlBtnsLeftHeader.vue'
import ControlBtnsRightHeader from './ControlBtnsRightHeader.vue'
import { registerAutoHideMounse, unregisterAutoHideMounse } from './autoHideMounse'
import { appSetting } from '@renderer/store/setting'
import { closeWindow, maxWindow, minWindow, setFullScreen } from '@renderer/utils/ipc'
import { useRouter } from '@common/utils/vueRouter'
import useMusicJump from '@renderer/utils/compositions/useMusicJump'

export default {
  name: 'CorePlayDetail',
  components: {
    ControlBtnsLeftHeader,
    ControlBtnsRightHeader,
    LyricPlayer,
    PlayBar,
    MusicComment,
  },
  setup() {
    const visibled = ref(false)

    // 无歌词（含歌词加载失败）时歌曲信息块整页水平居中；打开评论面板时退回左栏，避免块压在
    // 评论面板上（用户 2026-10-07 反馈）。上留白的下移与此判据无关、对两种布局常驻（见 .left）。
    // 切歌会先走 stop() 以空歌词重建，lines 必然归零，这个判据覆盖切歌全程
    const isInfoPageCenter = computed(() => lyric.lines.length == 0 && !isShowPlayComment.value)
    // 对齐缓冲（用户 2026-10-09 反馈）：切歌后新歌歌词未落定前隐藏信息块（isAligning → opacity 0），
    // 落定后在新位置整块淡入——「居中↔左侧」的换位发生在不可见期间，看不到位置跳变。
    // 窗口开在 setPlayMusicInfo（切歌），关在 getLyricInfo 落定（core/player/action.ts 的 finally）
    const isAligning = computed(() => lyric.isLoading)
    const router = useRouter()

    let clickTime = 0

    const hide = () => {
      setShowPlayerDetail(false)
    }
    const handleContextMenu = () => {
      if (window.performance.now() - clickTime > 400) {
        clickTime = window.performance.now()
        return
      }
      clickTime = 0
      hide()
    }

    const hideComment = () => {
      setShowPlayComment(false)
    }

    const handleAfterEnter = () => {
      if (isFullscreen.value) registerAutoHideMounse()

      visibled.value = true
    }

    const handleAfterLeave = () => {
      setShowPlayLrcSelectContentLrc(false)
      hideComment(false)
      visibled.value = false

      unregisterAutoHideMounse()
    }

    watch(isFullscreen, isFullscreen => {
      (isFullscreen ? registerAutoHideMounse : unregisterAutoHideMounse)()
    })


    // 跳转 / 分享（工单 02）：这一页只显示播放器状态里的精简结构（name/singer/album），
    // 所以一律以 playMusicInfo.musicInfo（新式歌曲对象，带 meta）为准——它才有 songmid / albumMid
    const {
      canJumpToAlbum,
      canJumpToSinger,
      canShareMusic,
      handleSingerNameClick,
      handleAlbumNameClick,
      getSongMid,
      isShowSingerPicker,
      singerPickerXy,
      singerPickerMenus,
      handleSingerPickerClick,
    } = useMusicJump()

    // 关闭详情页时把歌手选择菜单一起收掉（工单 05）：本组件实例不会随 overlay 卸载，
    // 不清的话下次打开会自动弹出一个停在旧坐标的菜单。
    // （点关闭按钮走的是 click，菜单本来就会被 document 上的收起监听收掉；双击右键走 contextmenu，绕过它）
    watch(isShowPlayerDetail, show => {
      if (!show) handleSingerPickerClick(null)
    })

    const handlePlayDetailSingerClick = (event) => {
      if (!canJumpToSinger(playMusicInfo.musicInfo)) return
      handleSingerNameClick(playMusicInfo.musicInfo, event)
    }
    const handlePlayDetailAlbumClick = () => {
      if (!canJumpToAlbum(playMusicInfo.musicInfo)) return
      handleAlbumNameClick(playMusicInfo.musicInfo)
    }
    const handleOpenSongDetail = () => {
      const mid = getSongMid(playMusicInfo.musicInfo)
      if (!mid) return
      // 详情页是路由页，本页是盖在路由之上的覆盖层：不先收起来，push 只是把页面换在底下，
      // 用户看到的是「点了没反应」（票 14 的候选根因）。仓库里三处深链导航都是这个写法。
      setShowPlayerDetail(false)
      void router.push({ path: '/songDetail', query: { mid } })
    }

    return {
      appSetting,
      playMusicInfo,
      isShowPlayerDetail,
      isShowPlayComment,
      musicInfo,
      isInfoPageCenter,
      isAligning,
      hide,
      handleContextMenu,
      hideComment,
      handleAfterEnter,
      handleAfterLeave,
      visibled,
      isFullscreen,
      canJumpToAlbum,
      canJumpToSinger,
      canShareMusic,
      handlePlayDetailSingerClick,
      handlePlayDetailAlbumClick,
      handleOpenSongDetail,
      // 歌手选择菜单（工单 05）：模板里的 base-menu 要直接绑这几项
      isShowSingerPicker,
      singerPickerXy,
      singerPickerMenus,
      handleSingerPickerClick,
      fullscreenExit() {
        void setFullScreen(false).then((fullscreen) => {
          isFullscreen.value = fullscreen
        })
      },
      min() {
        minWindow()
      },
      max() {
        maxWindow()
      },
      close() {
        closeWindow()
      },
    }
  },
}
</script>


<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

@control-btn-width: @height-toolbar * .26;

.container {
  position: absolute;
  display: flex;
  flex-flow: column nowrap;
  width: 100%;
  height: 100%;
  top: 0;
  left: 0;
  background-color: var(--color-content-background);
  z-index: 10;
  // -webkit-app-region: drag;
  overflow: hidden;
  border-radius: @radius-border;
  color: var(--color-font);
  // border-left: 12px solid var(--color-primary-alpha-900);
  -webkit-app-region: no-drag;
  contain: strict;

  box-sizing: border-box;

  * {
    box-sizing: border-box;
  }
}
.bg {
  position: absolute;
  width: 100%;
  height: 100%;
  top: 0;
  left: 0;
  background: var(--background-image) var(--background-image-position) no-repeat;
  background-size: var(--background-image-size);
  // background-size: 110% 110%;
  // filter: blur(60px);
  opacity: .7;
  z-index: -1;
  &:before {
    content: '';
    display: block;
    width: 100%;
    height: 100%;
    background-color: var(--color-app-background);
  }
  &:after {
    position: absolute;
    left: 0;
    top: 0;
    content: '';
    display: block;
    width: 100%;
    height: 100%;
    background-color: var(--color-main-background);
  }
}
// .bg2 {
//   position: absolute;
//   width: 100%;
//   height: 100%;
//   top: 0;
//   left: 0;
//   z-index: -1;
//   background-color: rgba(255, 255, 255, .8);
// }

.main {
  flex: auto;
  min-height: 0;
  overflow: hidden;
  display: flex;
  margin: 0 30px;
  position: relative;

  &.showComment {
    :global {
      .left {
        flex-basis: 18%;
        .description p {
          font-size: 12px;
        }
      }
      .right {
        flex-basis: 30%;
        .lyricSelectContent {
          font-size: 14px;
        }
      }
      .comment {
        opacity: 1;
        transform: scaleX(1);
      }
    }
  }
}
.left {
  // 44%：封面在 300px 的 .info 上限里显得偏小（用户 2026-09-23 反馈）而放大的一档。
  // ⚠️ 与歌词列的 flex-basis 是**一对**：两者之和必须是 100%（44 + 56，见 LyricPlayer.vue 的 .right）。
  // 曾经写成 44 + 60 = 104% → 歌词列多出的 4% 被本文件 .main 的 overflow:hidden 裁掉，
  // 表现为「歌词右侧出去了」，连「允许拖拽歌词调进度」的跳转按钮都整块被裁没（2026-09-24 修）
  flex: 0 0 44%;
  display: flex;
  flex-flow: column nowrap;
  align-items: center;
  padding: 13px;
  // 「上留白 = 贴左布局时块的左留白」（用户 2026-10-07 反馈），**两种布局都生效**——
  // 块下移由这里常驻完成，不随有无歌词变化：
  // - 左留白 = 30 main 边距 + 13 padding + (0.44W − 26 − 400)/2。.container 内是 border-box，
  //   flex-basis 44% 含左栏自身左右共 26px padding，居中发生在内容盒；13px 在「居中基准缩窄」
  //   与「跨过 padding」两处相消 → 左留白 = 22%W − 170（块按 .info 400px 上限计）。
  // - 上留白 = 头部(@height-toolbar) + 本 padding。令二者相等 → padding = calc(22% + 30px - 200px - @height-toolbar)。
  // - 写在 .left 的 padding 而不是块的 top：top 的百分比按**高度**解析、引用不到页面宽度；
  //   padding 百分比按包含块（.main）宽度解析。有歌词态块是流内内容、无歌词态块绝对定位
  //   （top:auto 取内容盒顶），同一个 padding 对两种布局同时生效。
  padding-top: calc(22% + 30px - 200px - @height-toolbar);
  overflow: hidden;
  transition: flex-basis @transition-normal;

  // 无歌词态：块跨出 44% 左栏、整页水平居中。绝对定位锚到 .main（最近定位祖先）才能跨出左栏；
  // .left 的 overflow:hidden 裁不到包含块在它之外的绝对定位后代。left/right 归零 + 水平 auto
  // 边距 → 居中，宽度仍按 max-width:400px 收缩适配，top 不设值取静态位置（上留白与左布局一致）
  &.infoPageCenter {
    .info {
      position: absolute;
      left: 0;
      right: 0;
      margin-left: auto;
      margin-right: auto;
    }
  }
}

.info {
  display: flex;
  flex-flow: column nowrap;
  justify-content: flex-start;
  // 封面（.img 是 min-width:100%）与歌曲信息都受这个上限约束，300 → 400 让封面明显大一圈
  max-width: 400px;
  min-height: 0;
  // 对齐缓冲：切歌后歌词未落定（isAligning）先整块隐去，落定后在新位置淡入——
  // 「居中↔左侧」的换位发生在不可见期间，看不到跳变（用户 2026-10-09 反馈）。
  // ⚠️ 隐去必须瞬时（transition: none）：若保留淡出，切歌帧位置已翻转而透明度还接近 1，
  // 跳变照旧可见（2026-10-09 实测）。只保留淡入（.2s，比 @transition-normal 短，「微」缓冲）；
  // 隐去时连同可点性一起收掉
  transition: opacity .2s ease;
  &.aligning {
    opacity: 0;
    pointer-events: none;
    transition: none;
  }
}
.img {
  max-width: 100%;
  max-height: 80%;
  min-width: 100%;
  box-shadow: 0 0 6px var(--color-primary-alpha-500);
  border-radius: 6px;
  opacity: .8;
}
.description {
  max-width: 400px;
  margin-top: 15px;
  padding-bottom: 15px;
  min-height: 0;
  p {
    line-height: 1.5;
    font-size: 14px;
    overflow-wrap: break-word;
  }
}

// 可点的歌手名 / 专辑名（工单 02）：只加提示，不改颜色（背景是封面虚化，颜色改动容易糊）
.jumpable {
  cursor: pointer;
  &:hover {
    text-decoration: underline;
  }
}
// 进「歌曲详情页」的入口：做得像一条链接（这一页原来整页没有可点元素）
.jumpLink {
  cursor: pointer;
  color: var(--color-primary);
  &:hover {
    text-decoration: underline;
  }
}


.comment {
  position: absolute;
  right: 0;
  top: 0;
  width: 50%;
  height: 100%;
  opacity: 1;
  margin-left: 10px;
  transform: scaleX(0);
}


</style>
