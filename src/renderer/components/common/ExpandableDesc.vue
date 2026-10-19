<template>
  <div v-if="text" :class="$style.wrap" :style="{ '--desc-lines': String(lines) }">
    <p ref="descEl" :class="[$style.desc, { [$style.descClamp]: !isOpen }]">
      <!-- 隐藏量尺：整段文本的换行位置以它为准。绝对定位 + 零高 + overflow hidden，
           不参与可见排版、也不撑高页面（行 rect 由布局算出，裁切不影响测量）。 -->
      <span ref="measureEl" :class="$style.measure">{{ text }}</span>
      <!-- 让位块插在**目标行的行首**（不是靠 margin-top 往下推）：
           浮动块的外边距盒从它自己的位置往上算，margin-top 会把盒顶拉回段落顶部，
           于是上面每一行都被压窄一个按钮宽度——那正是「文字右边界与按钮右边界对不齐」的成因。
           插在行首、不带外边距时，它的盒子只覆盖那一行：上面各行保持满宽，只有这一行让出按钮宽度。 -->
      <template v-if="isOverflow">
        <span>{{ text.slice(0, tailOffset) }}</span>
        <span ref="tailEl" :class="$style.tail">
          <span v-if="!isOpen" :class="$style.ellipsis">…</span>
          <base-btn min :class="$style.toggle" @click="handleToggle">
            {{ isOpen ? $t('desc__collapse') : $t('desc__expand') }}
          </base-btn>
        </span>
        <span>{{ text.slice(tailOffset) }}</span>
      </template>
      <template v-else>{{ text }}</template>
    </p>
  </div>
</template>

<script lang="ts">
import { ref, watch, nextTick, onMounted, onBeforeUnmount } from '@common/utils/vueTools'

/**
 * 可展开的简介（专辑页 3 行 / 歌手页 4 行共用）。
 *
 * 用户口径（2026-10-19）：「展开键要融合进最后一行」；「非最后一行的文字区右边界与按钮的
 * 右边界对齐」——即正文各行**满宽**排到按钮右缘所在的那条线，只有按钮所在的那一行让出宽度。
 *
 * 排版：简介原文是**带换行的纯文本**（实测专辑 `太阳之子` 8953 字 / 204 个 `\n`，
 * 空行分段、无 HTML），所以 `.desc` 用 `white-space: pre-line` 保住行结构；
 * 用 `normal` 会把换行当空白折叠（同一篇实测 283 行 → 138 行），原文的排版全丢。
 *
 * 裁切：收起态按 `lines` 行裁（max-height + overflow hidden），**不用** `-webkit-line-clamp`
 * （它要求 `display: -webkit-box`，而浮动块在 -webkit-box 里不生效）。
 *
 * 落位（这是本组件的核心，改之前先读）：
 * - 收起态：让位块插在**第 `lines` 行行首**（字符偏移由隐藏量尺二分得到），
 *   于是 1..lines-1 行满宽、第 lines 行让出按钮宽度，其余正文被裁掉。
 * - 展开态：让位块插在**全文末尾**（`tailOffset = text.length`）。它落在最后一行；
 *   最后一行放不下时自动换到新的末行——两种都满足「按钮在最后一行、右缘对齐文字区右缘」。
 * - ⚠️ 绝不要用 `margin-top` 把浮动块往下推：外边距盒从块自己的位置向上撑到段落顶部，
 *   上面每一行都会被压窄（实测展开态非末行右缘 1285，按钮右缘 1328，差 43px = 按钮宽度）。
 *
 * 溢出判据沿用 65b07d1 的口径（只在真被截断时出按钮），但改用**行数**判断：
 * 量尺的自然行数 > `lines` 才算截断（jsdom 拿不到行 rect 时退回 scrollHeight 估算）。
 */
export default {
  name: 'ExpandableDesc',
  props: {
    text: { type: String, required: true },
    /** 收起态行数（专辑 3、歌手 4，各页原有口径） */
    lines: { type: Number, default: 3 },
  },
  // 展开/收起时通知调用页（页面据此给下方列表留最小高度：简介铺开后列表会被挤成 0 高）
  emits: ['toggle'],
  setup(props: { text: string, lines: number }, { emit }: { emit: (event: 'toggle', open: boolean) => void }) {
    const descEl = ref<HTMLElement | null>(null)
    const measureEl = ref<HTMLElement | null>(null)
    const isOpen = ref(false)
    const isOverflow = ref(false)
    /** 让位块插在第几个字符前：收起态 = 第 lines 行行首；展开态 = 全文末尾 */
    const tailOffset = ref(0)

    const lineHeight = () => {
      const el = descEl.value
      const lh = el ? parseFloat(getComputedStyle(el).lineHeight) : NaN
      return Number.isFinite(lh) && lh > 0 ? lh : 16.8
    }

    /** 量尺的逐行 rect（一行一个；空行没有 rect）。jsdom 没有 Range.getClientRects，返回空数组 */
    const naturalRects = (): DOMRect[] => {
      const el = measureEl.value
      if (el == null) return []
      const range = document.createRange()
      range.selectNodeContents(el)
      return typeof range.getClientRects == 'function' ? Array.from(range.getClientRects()) : []
    }

    /** 全文的**视觉行数**：用高度算，不用 rect 个数——空行（原文里的空行分段很常见）
     *  只有行盒没有字符 rect，数 rect 会少算。 */
    const naturalLines = () => {
      const el = measureEl.value
      if (el == null) return 0
      return Math.max(1, Math.round(el.scrollHeight / lineHeight()))
    }

    /** 第 `line` 行行首的字符偏移（在量尺上二分：找第一个落在该行顶的字符）。
     *  拿不到行 rect（jsdom）或量尺还没挂上时退回全文末尾——测试只断言 DOM 结构，不影响真机。 */
    const lineStartOffset = (lineTop: number) => {
      const el = measureEl.value
      const node = el?.firstChild
      if (node == null || node.nodeType !== 3) return props.text.length
      const len = node.nodeValue?.length ?? 0
      const topAt = (index: number) => {
        const range = document.createRange()
        range.setStart(node, index)
        range.setEnd(node, Math.min(index + 1, len))
        const rects = typeof range.getClientRects == 'function' ? range.getClientRects() : null
        return rects?.length ? rects[0].top : null
      }
      let lo = 0
      let hi = len
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        const top = topAt(mid)
        // null = 换行符之类没有盒子的字符，归它所在那一行（按「还没到下一行」处理）
        if (top == null || top < lineTop - 0.5) lo = mid + 1
        else hi = mid
      }
      return lo
    }

    const measure = () => {
      void nextTick(() => {
        const el = descEl.value
        if (el == null) return
        const rects = naturalRects()
        const total = rects.length > 0 ? naturalLines() : Math.max(1, Math.round(el.scrollHeight / lineHeight()))
        // 第 lines 行行首的 y：优先取逐行 rect（量尺上的真实行盒），空行多时退回按行高推算
        const targetTop = rects.length >= props.lines
          ? rects[props.lines - 1].top
          : (measureEl.value?.getBoundingClientRect().top ?? el.getBoundingClientRect().top) + (props.lines - 1) * lineHeight()
        isOverflow.value = total > props.lines
        if (!isOverflow.value || isOpen.value) {
          tailOffset.value = props.text.length
          return
        }
        tailOffset.value = lineStartOffset(targetTop)
      })
    }

    // 换内容（换专辑 / 换歌手）：回收起态再重新量（本来是展开态的要通知调用页）
    watch(() => props.text, () => {
      if (isOpen.value) emit('toggle', false)
      isOpen.value = false
      measure()
    }, { immediate: true })

    const handleToggle = () => {
      isOpen.value = !isOpen.value
      emit('toggle', isOpen.value)
      measure()
    }

    // 行数跟着宽度变：收起态要重算第 lines 行行首；展开态固定放末尾，重算只是刷新溢出判断。
    // ⚠️ 只监听 window.resize 不够：展开后整页出现滚动条，**正文宽度自己就会变**（装好的包
    // 实测 1200 宽下从 273 行涨到 290 行），所以用 ResizeObserver 盯正文盒子本身。
    // 观察器回调里重新落位会改排版（进而再触发回调）——用「已排队」标志收敛成一次。
    let observer: ResizeObserver | null = null
    let resizeQueued = false
    const handleResize = () => {
      if (resizeQueued) return
      resizeQueued = true
      void nextTick(() => {
        resizeQueued = false
        measure()
      })
    }
    onMounted(() => {
      window.addEventListener('resize', handleResize)
      if (typeof ResizeObserver == 'function' && descEl.value != null) {
        observer = new ResizeObserver(handleResize)
        observer.observe(descEl.value)
      }
    })
    onBeforeUnmount(() => {
      window.removeEventListener('resize', handleResize)
      observer?.disconnect()
      observer = null
    })

    return { descEl, measureEl, isOpen, isOverflow, tailOffset, handleToggle }
  },
}
</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.wrap {
  margin-top: 6px;
}
.desc {
  position: relative;
  min-width: 0;
  font-size: 12px;
  line-height: 1.4;
  color: var(--color-font-label);
  // 保住原文的换行与空行（`pre-line` 只折叠空格/tab，不折 \n）；长串不被撑爆
  white-space: pre-line;
  overflow-wrap: break-word;
}
// 隐藏量尺：与正文同字体同宽，绝对定位、零高、裁掉，不参与可见排版也不撑高页面
.measure {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 0;
  overflow: hidden;
  visibility: hidden;
  pointer-events: none;
}
// 收起态：按 `lines` 行裁切（行数由 props 经 --desc-lines 给）
.descClamp {
  max-height: calc(var(--desc-lines) * 1.4em);
  overflow: hidden;
}
// 让位块：**不带外边距**（见组件头注释），float: right 让它的右缘正好落在文字区右边界上，
// 即「非末行文字右边界 = 按钮右边界」。
.tail {
  float: right;
  display: flex;
  align-items: center;
  height: 1.4em;
  gap: 4px;
}
.ellipsis {
  color: var(--color-font-label);
}
// 键压到 1.4em 的行高里（高 1px 就会把这一行撑高、把下一行挤下去）。
// 用 `元素.类名` 而不是单类名：单类名与 base-btn 的 .btn 同特异度，谁赢看打包顺序。
.tail button {
  height: 1.4em;
  padding: 0 6px;
  font-size: 12px;
  line-height: 1.4em;
}
</style>
