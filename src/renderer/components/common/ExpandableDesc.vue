<template>
  <div
    v-if="text"
    :class="$style.wrap"
    :style="{ '--desc-lines': String(lines), '--desc-tail-line': String(tailLine) }"
  >
    <p ref="descEl" :class="[$style.desc, { [$style.descClamp]: !isOpen }]">
      <!-- 展开/收起的键跟在**文字末尾那一行**：末行右侧的空位由 `.tail` 这个浮动块让出来，
           「…（仅收起态）+ 键」就画在让出的空位里——键是末行的一部分，不是另起一列/一行。
           ⚠️ 三条不能动：
           1. `.tail` 必须排在正文之前（浮动落点由它在流里的位置决定）；
           2. `.tail` 高度只有 1 行，靠 `--desc-tail-line` 沉到目标行——高一点会把它上一行也挤窄；
           3. 收起态量不到「全文最后一行」（正文被裁掉），只有展开态才逐行量（见 setup 的 measure）。 -->
      <span v-if="isOverflow" ref="tailEl" :class="$style.tail">
        <span v-if="!isOpen" :class="$style.ellipsis">…</span>
        <base-btn min :class="$style.toggle" @click="handleToggle">
          {{ isOpen ? $t('desc__collapse') : $t('desc__expand') }}
        </base-btn>
      </span>
      <span ref="textEl" :class="$style.text">{{ text }}</span>
    </p>
  </div>
</template>

<script lang="ts">
import { ref, watch, nextTick, onMounted, onBeforeUnmount } from '@common/utils/vueTools'

/**
 * 可展开的简介（专辑页 3 行 / 歌手页 4 行共用；2026-10-19 用户口径：
 * 「展开键要融合进最后一行」——收起态键在末行，展开态键在**全文**末行）。
 *
 * 排版：简介原文是**带换行的纯文本**（实测专辑 `太阳之子` 8953 字 / 204 个 `\n`，
 * 空行分段、无 HTML），所以 `.desc` 用 `white-space: pre-line` 保住行结构；
 * 用 `normal` 会把换行当空白折叠（同一篇实测 283 行 → 138 行），原文的排版全丢。
 *
 * 裁切：收起态按 `lines` 行裁（max-height + overflow hidden），**不用** `-webkit-line-clamp`
 * （它要求 `display: -webkit-box`，而浮动块在 -webkit-box 里不生效，末行就没法单独让位）。
 *
 * 展开态**不限高**（用户明确否掉 50vh + 自滚）：全文铺开，让位块按量出来的行数沉到全文末行；
 * 正文长出屏幕的部分靠页面根容器的滚动看（两张页都开了 `overflow-y: auto`）。
 *
 * 溢出判据沿用 65b07d1：`scrollHeight > clientHeight` 只在**收起态**量（展开态没有裁切，
 * 这个式子恒不成立，量了会把按钮藏掉）；量的时候按钮还没挂上，简介是全宽，判据偏保守。
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
    const textEl = ref<HTMLElement | null>(null)
    const tailEl = ref<HTMLElement | null>(null)
    const isOpen = ref(false)
    const isOverflow = ref(false)
    /** 让位块沉到第几行：收起态 = `lines`；展开态 = 量出来的全文行数 */
    const tailLine = ref(props.lines)

    const lineHeight = () => {
      const el = descEl.value
      const lh = el ? parseFloat(getComputedStyle(el).lineHeight) : NaN
      return Number.isFinite(lh) && lh > 0 ? lh : 16.8
    }
    /** 正文的逐行 rect（一行一个；空白行没有 rect）。jsdom 没有 Range.getClientRects，测试里返回空数组 */
    const spanLineRects = (): DOMRect[] => {
      const span = textEl.value
      if (span == null) return []
      const range = document.createRange()
      range.selectNodeContents(span)
      return typeof range.getClientRects == 'function' ? Array.from(range.getClientRects()) : []
    }

    /** 正文渲染到第几行。
     *  ⚠️ 用**逐行 rect 的最大底边**算，不要用 span 的 getBoundingClientRect().bottom：
     *  让位块沉到正文下方时（margin-top 上千 px）后者会被撑到容器底部——实测同一篇
     *  简介量出 803 行（真实 292 行），落位直接飞掉。 */
    const textLines = () => {
      const el = descEl.value
      const rects = spanLineRects()
      if (el == null || rects.length === 0) return props.lines
      const bottom = Math.max(...rects.map(r => r.bottom))
      return Math.max(1, Math.round((bottom - el.getBoundingClientRect().top) / lineHeight()))
    }

    /** 让位块的横向落点：把块**画**到本行文字右缘之后（`transform`，只影响绘制、不动布局）。
     *  ⚠️ 不能用 margin-right 挪：浮动块的外边距盒从段落顶部算起，往左挪会把上面每一行都压窄
     *  （实测 651px 偏移把「万众期盼！雨过天晴」压成两行）；transform 不改布局，正文一行不动。
     *  正文那一行的右缘本来就在块的左边，所以画过去也不会压住字。 */
    const inlineGap = 6
    const placeTailInline = (line: number) => {
      const el = descEl.value
      const tail = tailEl.value
      if (el == null || tail == null) return
      const width = tail.offsetWidth
      const elRect = el.getBoundingClientRect()
      const lh = lineHeight()
      const targetTop = elRect.top + (line - 1) * lh
      // 行 rect 的顶 = 行盒顶 + 半行距，用半行距当容差找目标行；空白行没 rect 则保持贴右缘
      const rect = width > 0 ? spanLineRects().find(r => r.top >= targetTop - lh / 2 && r.top < targetTop + lh / 2) : null
      const delta = rect == null ? 0 : Math.round(rect.right + inlineGap - (elRect.right - width))
      tail.style.transform = delta ? `translateX(${delta}px)` : ''
    }

    /** 落位：
     *  - 收起态：块落在第 `lines` 行（正文被裁掉，末行就是它）；
     *  - 展开态：目标是**全文最后一行**。块贴右缘时会把末行挤下一行、`pre-line` 下还会顺着
     *    后续行级联，所以要迭代到「正文不再长过块所在行」。
     *  ⚠️ 轮数不能小：级联长度跟**行宽**成正比，窗口越宽一次挤出的字越少（装好的包实测
     *    1200 宽下 3 轮只走到 273 行、正文还有 290 行——块卡在正文中间）。这里给 40 轮上限，
     *    正常几轮就收敛；到上限仍没追上时把块放到最新末行（宁可贴底，不能插在正文里）。
     *  两个状态都把块横画到本行文字右缘之后（`placeTailInline`）。 */
    const placeTail = (round = 0) => {
      void nextTick(() => {
        const el = descEl.value
        if (el == null) return
        if (!isOpen.value) {
          isOverflow.value = el.scrollHeight > el.clientHeight + 1
          tailLine.value = props.lines
          void nextTick(() => { placeTailInline(props.lines) })
          return
        }
        const lines = textLines()
        if (lines > tailLine.value && round < 40) {
          tailLine.value = lines
          // 强制一次布局：下一轮要量的是块落位之后的真实行数（只等 nextTick 时，
          // 浏览器可能还没把新 margin-top 反映到排版上，会提前判定「追上了」）
          void el.offsetHeight
          placeTail(round + 1)
          return
        }
        if (lines > tailLine.value) tailLine.value = lines
        placeTailInline(tailLine.value)
      })
    }

    const measure = () => { placeTail() }

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

    // 行数跟着宽度变：展开态要把让位块挪到新的末行，收起态要重判「有没有被截断」。
    // ⚠️ 只监听 window.resize 不够：展开后整页出现滚动条，**正文宽度自己就会变**（装好的包
    // 实测 1200 宽下从 273 行涨到 290 行），这次重排发生在落位循环之后，块就卡在正文中间。
    // 所以用 ResizeObserver 盯正文盒子本身（宽度/高度一变就重新落位），window.resize 留着兜窗口缩放。
    let observer: ResizeObserver | null = null
    // 观察器回调里重新落位本身会改排版（进而再触发一次回调）——用一个「已排队」标志收敛成一次，
    // 避免 ResizeObserver 的循环告警。落位函数是幂等的，多跑一次不会抖。
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

    return { descEl, textEl, tailEl, isOpen, isOverflow, tailLine, handleToggle }
  },
}
</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.wrap {
  margin-top: 6px;
}
.desc {
  min-width: 0;
  font-size: 12px;
  line-height: 1.4;
  color: var(--color-font-label);
  // 保住原文的换行与空行（`pre-line` 只折叠空格/tab，不折 \n）；长串不被撑爆
  white-space: pre-line;
  overflow-wrap: break-word;
}
// 收起态：按 `lines` 行裁切（行数由 props 经 --desc-lines 给）
.descClamp {
  max-height: calc(var(--desc-lines) * 1.4em);
  overflow: hidden;
}
// 末行让位块：只占 1 行，靠 `--desc-tail-line` 沉到目标行（收起态 = lines，展开态 = 全文末行）
// ⚠️ 高度必须正好 1.4em，且与 .descClamp 的 max-height 同一套算式——错开就会出现
// 「上一行被挤窄」或「按钮被裁掉半截」。
.tail {
  float: right;
  display: flex;
  align-items: center;
  height: 1.4em;
  margin-top: calc((var(--desc-tail-line) - 1) * 1.4em);
  gap: 4px;
}
.ellipsis {
  color: var(--color-font-label);
}
// 键压到 1.4em 的行高里：收起态那枚必须如此（高 1px 就压到上一行），展开态跟着统一。
// 用 `元素.类名` 而不是单类名：单类名与 base-btn 的 .btn 同特异度，谁赢看打包顺序。
.tail button {
  height: 1.4em;
  padding: 0 6px;
  font-size: 12px;
  line-height: 1.4em;
}
</style>
