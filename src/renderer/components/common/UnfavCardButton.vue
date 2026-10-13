<template>
  <!-- 收藏页卡片上的「取消收藏」键（票 06 E3）：收藏专辑 / 收藏歌单两张卡共用。
       用裸 button 而不是 base-btn：它要压在封面图右上角（自绘的深色圆底 + 白心），
       base-btn 的尺寸与配色体系在这里不适用。 -->
  <button
    :class="$style.btn"
    type="button"
    :aria-label="$t('fav__cancel')"
    :title="$t('fav__cancel')"
    @click.stop="$emit('click')"
  >
    <!-- 无障碍名与悬停提示都在按钮上（§2.5.1 规则 11），svg 因此当纯装饰图标 -->
    <svg-icon name="love-solid" />
  </button>
</template>

<script lang="ts">
/**
 * 卡片右上角的「取消收藏」键。
 *
 * 只负责外观与无障碍；二次确认、写云端、就地移出卡片都是调用方的事
 * （`removeFavAlbumFromList` / `removeFavListFromList`，见 store/user/action）。
 * `@click.stop`：卡片整体有 `@click`（跳详情），不拦住会连带跳走。
 *
 * 常驻显示（不做悬停显形）：与同页「我收藏的歌曲」行尾那颗心一致——收藏页上每一张卡
 * 都是已收藏状态，一颗可点的实心心就是最短的说明；靠 `title`「取消 QQ 收藏」补齐语义。
 */
export default {
  name: 'UnfavCardButton',
  emits: ['click'],
}
</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.btn {
  position: absolute;
  top: 6px;
  right: 6px;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: none;
  border-radius: 50%;
  cursor: pointer;
  // 封面图上的反差底色（同 songList/Detail 播放量角标、MvPanel 时长角标）：图色不可控，
  // 必须自带深底 + 白图标——不能用随主题变的 --color-font / --color-button-background
  background-color: rgba(0, 0, 0, .5);
  color: #fff;
  transition: background-color @transition-fast;

  &:hover {
    background-color: rgba(0, 0, 0, .72);
  }

  svg {
    width: 15px;
    height: 15px;
  }
}
</style>
