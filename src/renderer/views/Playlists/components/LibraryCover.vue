<template>
  <img v-if="url" :src="url" :class="$style.cover" alt="" />
  <!-- 无内嵌封面：音符占位（票 14 真机反馈——灰块噪点难看，改成有意为之的小图标） -->
  <span v-else :class="$style.placeholder">
    <svg-icon name="music" :class="$style.placeholderIcon" />
  </span>
</template>

<script>
import { onBeforeUnmount, onMounted, ref } from '@common/utils/vueTools'
import { getCoverUrl } from '@renderer/core/localLibrary/covers'

/**
 * 库视图的行内封面（票 03）。
 *
 * 只在虚拟列表把它挂出来时才去读文件（worker 解析内嵌封面 → 主线程 ObjectURL，走 core 的共享
 * 缓存），不可见的行一个字节都不读——大库的封面开销天然只花在看得见的行上。
 */
export default {
  name: 'LibraryCover',
  props: {
    mediaPath: {
      type: String,
      required: true,
    },
  },
  setup(props) {
    const url = ref('')
    let alive = true
    onMounted(async() => {
      const result = await getCoverUrl(props.mediaPath)
      if (alive && result) url.value = result
    })
    onBeforeUnmount(() => {
      alive = false
    })
    return { url }
  },
}
</script>

<style lang="less" module>
.cover {
  width: 38px;
  height: 38px;
  border-radius: 3px;
  object-fit: cover;
  display: block;
}

.placeholder {
  width: 38px;
  height: 38px;
  border-radius: 3px;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: var(--color-primary-background);
}

.placeholder-icon {
  width: 16px;
  height: 16px;
  color: var(--color-font-label);
  opacity: .6;
}
</style>
