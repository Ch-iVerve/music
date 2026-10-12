<template>
  <div :class="$style.btns">
    <button v-if="playBtn" type="button" :aria-label="$t('list__play')" :title="$t('list__play')" @contextmenu.capture.stop @click.stop="handleClick('play')">
      <svg v-once version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" height="100%" viewBox="0 0 287.386 287.386" space="preserve">
        <use xlink:href="#icon-testPlay" />
      </svg>
    </button>
    <button v-if="favBtn && canFav" type="button" :aria-label="favTitle" :title="favTitle" @contextmenu.capture.stop @click.stop="handleClick('fav')">
      <!-- 「我喜欢」的一键开关（工单 06）：文案与配色都跟着当前状态走——已在我喜欢里 →
           主色 +「取消喜欢」，不在 → 普通色 +「收藏到…」。**形状**也分两态（工单 10）：
           不在 → 空心 `#icon-love`，在 → 实心 `#icon-love-solid`，映射在 `favIconOf` 一处。
           这里**不能**加 `v-once`，否则 href 与 class 冻在第一帧。
           不能收藏的歌（本地文件等）由 v-if 的 canFav 拦掉，不显示死键 -->
      <svg version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" height="100%" viewBox="0 0 444.87 391.18" space="preserve" :class="[$style.favIcon, isFav ? $style.favOn : null]">
        <use :xlink:href="favIconOf(isFav)" />
      </svg>
    </button>
    <button v-if="listAddBtn" type="button" :aria-label="$t('list__add_to')" :title="$t('list__add_to')" @contextmenu.capture.stop @click.stop="handleClick('listAdd')">
      <!-- 「加入歌单」用 `#icon-list-add`（Material 的 playlist_add：三条目 + 加号，与歌单页
           新建歌单那两个键同一个图形）——「添加到…」的语义靠它一眼看出来；工单 10 之前这里是
           一个光秃秃的加号，2026-09-24 用户点名「不要用爱心的图标」时顺带把语义做实。
           viewBox 不是 Icons.vue 里那个 `0 0 24 24`，而是**贴着墨迹裁**的 `2 3 20 20`：
           本排每个键的 svg 盒都被 CSS 钉成 16×16，不裁的话这个图形（墨迹只有 20×14）会缩到
           13.3×9.3，明显比同排的播放/下载键小一圈。裁成 20 见方后墨迹宽正好 16，与邻居齐平 -->
      <svg v-once version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" height="100%" viewBox="2 3 20 20" space="preserve">
        <use xlink:href="#icon-list-add" />
      </svg>
    </button>
    <button v-if="downloadBtn" type="button" :aria-label="$t('list__download')" :title="$t('list__download')" @contextmenu.capture.stop @click.stop="handleClick('download')">
      <svg v-once version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" height="100%" viewBox="0 0 475.078 475.077" space="preserve">
        <use xlink:href="#icon-download" />
      </svg>
    </button>
    <button v-if="startBtn" type="button" :aria-label="$t('list__start')" :title="$t('list__start')" @contextmenu.capture.stop @click.stop="handleClick('start')">
      <svg v-once version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" height="100%" viewBox="0 0 1024 1024" space="preserve">
        <use xlink:href="#icon-play" />
      </svg>
    </button>
    <button v-if="pauseBtn" type="button" :aria-label="$t('list__pause')" :title="$t('list__pause')" @contextmenu.capture.stop @click.stop="handleClick('pause')">
      <svg v-once version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" height="100%" viewBox="0 0 1024 1024" space="preserve">
        <use xlink:href="#icon-pause" />
      </svg>
    </button>
    <button v-if="fileBtn" type="button" :aria-label="$t('list__file')" :title="$t('list__file')" @contextmenu.capture.stop @click.stop="handleClick('file')">
      <svg v-once version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" height="100%" viewBox="-61 0 512 512" space="preserve">
        <use xlink:href="#icon-musicFile" />
      </svg>
    </button>
    <button v-if="searchBtn" type="button" :aria-label="$t('list__search')" :title="$t('list__search')" @contextmenu.capture.stop @click.stop="handleClick('search')">
      <svg v-once version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" height="100%" viewBox="0 0 30.239 30.239" space="preserve">
        <use xlink:href="#icon-search" />
      </svg>
    </button>
    <button v-if="removeBtn" type="button" :aria-label="removeLabel || $t('list__remove')" :title="removeLabel || $t('list__remove')" @click.stop="handleClick('remove')">
      <svg v-once version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" height="100%" viewBox="0 0 212.982 212.982" space="preserve">
        <use xlink:href="#icon-delete" />
      </svg>
    </button>
  </div>
</template>

<script>
import { appSetting } from '@renderer/store/setting'
import { canFavSongInCloud, isFavSongInCloud } from '@renderer/store/user/action'
import { favIconOf } from '@renderer/utils/compositions/useFavSong'

export default {
  props: {
    index: {
      type: Number,
      required: true,
    },
    // 「我喜欢」键与「加入歌单」键是两件事（工单 06）：前者是状态开关，后者开弹窗。
    // 心形键要知道是哪一首才能显示对状态，所以要把歌传进来（不传就不显示这个键）。
    musicInfo: {
      type: Object,
      default: null,
    },
    // 默认关：本地文件表（ListMusicTable / 下载页）不传 musicInfo，传了也没用
    favBtn: {
      type: Boolean,
      default: false,
    },
    startBtn: {
      type: Boolean,
      default: false,
    },
    pauseBtn: {
      type: Boolean,
      default: false,
    },
    removeBtn: {
      type: Boolean,
      default: false,
    },
    // 「移除」按钮的语义随场景变（本地列表=移除，QQ 我喜欢=取消喜欢），文案由调用方给
    removeLabel: {
      type: String,
      default: '',
    },
    downloadBtn: {
      type: Boolean,
      default: true,
    },
    playBtn: {
      type: Boolean,
      default: true,
    },
    listAddBtn: {
      type: Boolean,
      default: true,
    },
    searchBtn: {
      type: Boolean,
      default: false,
    },
    fileBtn: {
      type: Boolean,
      default: false,
    },
  },
  emits: ['btn-click'],
  setup() {
    // `favIconOf` 直接给模板用（`:xlink:href="favIconOf(isFav)"`）：它是纯函数，映射与播放栏、
    // 播放详情页共用同一份。不另做 computed —— Options API 的 setup 里拿不到本组件的 computed，
    // 而在 computed 里写 `favIconOf(this.isFav)` 会被 `@typescript-eslint/unbound-method` 判成
    // 「把方法当值传出去」（`this.isFav` 是 getter，插件认不出）
    return {
      appSetting,
      favIconOf,
    }
  },
  computed: {
    /** 这一首能写进 QQ「我喜欢」吗（本地文件 / 非 tx 源没有 QQ 歌曲 ID）。 */
    canFav() {
      return canFavSongInCloud(this.musicInfo)
    },
    /** 当前状态：读的是 store/user 的收藏全量 id 集合（shallowReactive，写入后就地更新）。 */
    isFav() {
      return this.canFav && isFavSongInCloud(this.musicInfo)
    },
    /** 悬停提示 + 无障碍名，随状态变（复用既有 key，不另造一套文案）。 */
    favTitle() {
      return this.isFav ? this.$t('list__unlove') : this.$t('list_add__cloud_fav')
    },
  },
  methods: {
    handleClick(action) {
      this.$emit('btn-click', { action, index: this.index })
    },
  },
}
</script>


<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.btns {
  line-height: 1.2;

  button {
    background-color: transparent;
    border: none;
    border-radius: @form-radius;
    margin-right: 5px;
    cursor: pointer;
    padding: 4px 7px;
    color: var(--color-button-font);
    outline: none;
    transition: background-color 0.2s ease;
    line-height: 0;
    &:last-child {
      margin-right: 0;
    }

    svg {
      height: 16px;
    }

    // 心形的 viewBox 是「贴着墨迹裁」的（444.87×391.18，宽高比 1.137），只给 height 的话宽度会
    // 按比例撑到 18.19px——比同排其它键（一律 16×16 的盒）宽 2px、墨迹也大一圈（工单 10 用户原话
    // 「有点大」）。钉成 16×16，多出来的宽度由 svg 自己按 meet 居中缩回去：墨迹 16.0×14.1，
    // 落在播放键 16.03×13.53 与下载键 16.03×14.78 之间。
    // 选择器带上 `svg` 只是把口径写全（只写 `.favIcon` 也压得过上面那条 `svg{height:16px}`）
    svg.favIcon {
      width: 16px;
    }

    &:hover {
      background-color: var(--color-button-background-hover);
    }
    &:active {
      background-color: var(--color-button-background-active);
    }
  }
}

// 已在我喜欢里：心形换实心（形状，见 favIconOf）+ 主色（颜色）。
// 颜色是叠加的一层提示，不是唯一判据——灰度/高对比主题下也要能看出状态
.favOn {
  color: var(--color-primary);
}

</style>
