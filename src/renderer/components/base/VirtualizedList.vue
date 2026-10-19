<template>
  <component
    :is="containerEl"
    ref="dom_scrollContainer"
    :class="containerClass"
    tabindex="0"
    :style="containerStyle"
  >
    <component :is="contentEl" :class="contentClass" :style="contentStyle">
      <div v-for="item in views" :key="item.key" :style="item.style">
        <slot name="default" v-bind="{ item: item.item, index: item.index }" />
      </div>
    </component>
    <slot name="footer" />
  </component>
</template>

<script>
import {
  computed,
  ref,
  nextTick,
  watch,
  onMounted,
  onBeforeUnmount,
} from 'vue'

/**
 * 生成防抖函数
 * @param {*} fn
 * @param {*} delay
 */
export const debounce = (fn, delay = 100) => {
  let timer = null
  let _args = null
  return function(...args) {
    _args = args
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      fn.apply(this, _args)
    }, delay)
  }
}

const easeInOutQuad = (t, b, c, d) => {
  t /= d / 2
  if (t < 1) return (c / 2) * t * t + b
  t--
  return (-c / 2) * (t * (t - 2) - 1) + b
}
const handleScroll = (element, to, duration = 300, callback = () => {}, onCancel = () => {}) => {
  if (!element) { callback(); return }
  const start = element.scrollTop || element.scrollY || 0
  let cancel = false
  if (to > start) {
    let maxScrollTop = element.scrollHeight - element.clientHeight
    if (to > maxScrollTop) to = maxScrollTop
  } else if (to < start) {
    if (to < 0) to = 0
  } else { callback(); return }
  const change = to - start
  const increment = 10
  if (!change) { callback(); return }

  let currentTime = 0
  let val
  let cancelCallback

  const animateScroll = () => {
    currentTime += increment
    val = parseInt(easeInOutQuad(currentTime, start, change, duration))
    if (element.scrollTo) {
      element.scrollTo(0, val)
    } else {
      element.scrollTop = val
    }
    if (currentTime < duration) {
      if (cancel) {
        cancelCallback()
        onCancel()
        return
      }
      window.setTimeout(animateScroll, increment)
    } else {
      callback()
    }
  }
  animateScroll()
  return (callback) => {
    cancelCallback = callback
    cancel = true
  }
}

export default {
  name: 'VirtualizedList',
  props: {
    containerEl: {
      type: String,
      default: 'div',
    },
    containerClass: {
      type: String,
      default: 'virtualized-list',
    },
    contentEl: {
      type: String,
      default: 'div',
    },
    contentClass: {
      type: String,
      default: 'virtualized-list-content',
    },
    itemHeight: {
      type: Number,
      required: true,
    },
    keyName: {
      type: String,
      required: true,
    },
    list: {
      type: Array,
      required: true,
    },
    /**
     * 全量展开模式（专辑页歌曲列表用）：不限高、不出内部滚动条，所有行一次渲染，
     * 高度由父级页面自己滚（2026-10-19 用户要求「全部铺在页面里，不要滚动」）。
     * ⚠️ 行数多时（几百条）没有虚拟化，是拿性能换「不滚动」——只给确实需要全展开的页面用。
     */
    autoHeight: {
      type: Boolean,
      default: false,
    },
  },
  emits: ['scroll'],
  setup(props, { emit }) {
    const views = ref([])
    const dom_scrollContainer = ref(null)
    // 卸载标志：模板 ref 在卸载后是 null，而排进队列的回调（rAF / ResizeObserver / setTimeout）
    // 仍会跑——只判 ref 也行，多这个标志是为了让「卸载后不该重算」这件事一眼可见（工单 04）
    let isUnmounted = false
    // handleResize 排的定时器：卸载时清掉，别让它带着已失效的 ref 跑到卸载之后（工单 04）
    let resizeTimer = null
    let isListScrolling = false
    const isListScrollingRef = ref(false)
    let startIndex = -1
    let endIndex = -1
    let scrollTop = -1
    let cachedList = []
    let cancelScroll = null
    let isAutoScrolling = false
    let scrollToValue = 0

    const createList = (startIndex, endIndex) => {
      const cache = cachedList.slice(startIndex, endIndex)
      const list = props.list.slice(startIndex, endIndex).map((item, i) => {
        const index = startIndex + i
        // 复用缓存前必须比对**身份**：列表被原地改（splice / 排序，见下面 watch 的注释）时同一位置
        // 可能换了一首歌，按下标直接复用会把旧行留在屏上（真机症状：云端歌单加歌 / 刷新后新歌不出现）。
        // 身份不变（含「换引用但对象还是这些」的写回）才复用——那正是这个缓存存在的意义。
        if (cache[i]?.item === item) return cache[i]
        const top = index * props.itemHeight
        return cachedList[index] = {
          item,
          top,
          style: { position: 'absolute', left: 0, right: 0, top: top + 'px', height: props.itemHeight + 'px' },
          index,
          key: item[props.keyName],
        }
      })
      return list
    }

    /**
     * 重算渲染区间。
     *
     * 参数与 dom 都**不能在默认参数里取**（工单 04）：默认参数是在**调用时**求值的，
     * 而 `nextTick → requestAnimationFrame`、`ResizeObserver`、`window.setTimeout` 的回调
     * 都可能在组件**卸载之后**才跑——那时模板 ref 已是 null，`dom_scrollContainer.value.scrollTop`
     * 直接抛 `Cannot read properties of null (reading 'scrollTop')`。dev 下这条未捕获异常会弹出
     * webpack-dev-server 的全屏 overlay（`position:fixed; inset:0`），把整个窗口的鼠标事件吞掉，
     * 症状看起来像「界面点不动」。所以这里显式早退，别抛。
     */
    const updateView = (top) => {
      const el = dom_scrollContainer.value
      if (isUnmounted || !el) return
      // 全量展开：一次渲染所有行（没有内部滚动，也就没有「可视区间」可言）
      if (props.autoHeight) {
        if (startIndex !== 0 || endIndex !== props.list.length - 1) {
          views.value = createList(0, props.list.length)
          startIndex = 0
          endIndex = props.list.length - 1
        }
        return
      }
      // const currentScrollTop = this.$refs.dom_scrollContainer.scrollTop
      const currentScrollTop = top ?? el.scrollTop
      const itemHeight = props.itemHeight
      const currentStartIndex = Math.floor(currentScrollTop / itemHeight)
      const scrollContainerHeight = el.clientHeight
      const currentEndIndex = currentStartIndex + Math.ceil(scrollContainerHeight / itemHeight)
      const continuous = currentStartIndex <= endIndex && currentEndIndex >= startIndex
      const currentStartRenderIndex = Math.max(currentStartIndex, 0)
      const currentEndRenderIndex = currentEndIndex + 1
      // console.log(continuous)
      // debugger
      if (continuous) {
        // if (Math.abs(currentScrollTop - this.scrollTop) < this.itemHeight * 0.6) return
        // console.log('update')
        // if (currentScrollTop > scrollTop) { // scroll down
        //   // console.log('scroll down')
        //   views.value = createList(currentStartRenderIndex, currentEndRenderIndex)
        //   // views.value.push(...list.slice(list.indexOf(views.value[views.value.length - 1]) + 1))
        //   // // if (this.views.length > 100) {
        //   // nextTick(() => {
        //   //   views.value.splice(0, views.value.indexOf(list[0]))
        //   // })
        //   // }
        // } else if (currentScrollTop < scrollTop) { // scroll up
        //   // console.log('scroll up')
        //   views.value = createList(currentStartRenderIndex, currentEndRenderIndex)
        // } else return
        if (currentScrollTop == scrollTop && endIndex >= currentEndIndex) return
        requestAnimationFrame(() => {
          views.value = createList(currentStartRenderIndex, currentEndRenderIndex)
        })
      } else {
        requestAnimationFrame(() => {
          views.value = createList(currentStartRenderIndex, currentEndRenderIndex)
        })
      }
      startIndex = currentStartIndex
      endIndex = currentEndIndex
      scrollTop = currentScrollTop
    }

    const setStopScrollStatus = debounce(() => {
      isListScrolling = false
      isListScrollingRef.value = false
    }, 200)
    const onScroll = event => {
      if (!isListScrolling) isListScrolling = isListScrollingRef.value = true
      setStopScrollStatus()

      const currentScrollTop = dom_scrollContainer.value.scrollTop
      if (Math.abs(currentScrollTop - scrollTop) > props.itemHeight * 0.6) {
        updateView(currentScrollTop)
      }
      emit('scroll', event)
    }

    const scrollTo = (scrollTop, animate = false, onScrollEnd) => {
      if (onScrollEnd) {
        void new Promise(resolve => {
          if (cancelScroll) {
            cancelScroll(resolve)
          } else {
            resolve()
          }
        }).then(() => {
          if (animate) {
            isAutoScrolling = true
            scrollToValue = scrollTop
            cancelScroll = handleScroll(dom_scrollContainer.value, scrollTop, 300, () => {
              cancelScroll = null
              isAutoScrolling = false
              onScrollEnd(true)
            }, () => {
              cancelScroll = null
              isAutoScrolling = false
              onScrollEnd('canceled')
            })
          } else {
            dom_scrollContainer.value.scrollTop = scrollTop
          }
        })
      } else {
        dom_scrollContainer.value.scrollTo({
          top: scrollTop,
          behavior: animate ? 'smooth' : 'instant',
        })
      }
    }

    const scrollToIndex = (index, offset = 0, animate = false, onScrollEnd) => {
      scrollTo(Math.max(index * props.itemHeight + offset, 0), animate, onScrollEnd)
    }

    const getScrollTop = () => {
      return isAutoScrolling ? scrollToValue : dom_scrollContainer.value.scrollTop
    }

    const handleResize = () => {
      // 记下句柄，卸载时清掉（updateView 自己也有守卫，这里是别让回调白跑一趟）
      resizeTimer = window.setTimeout(updateView)
    }

    const contentStyle = computed(() => {
      const style = {
        display: 'block',
        height: props.list.length * props.itemHeight + 'px',
      }
      if (isListScrollingRef.value) style['pointer-events'] = 'none'
      return style
    })

    /**
     * 容器样式。全量展开模式下不能给固定高度 / 内部滚动 / `contain: strict`
     * （size containment 会让 `height: auto` 直接塌成 0），高度交给内容撑开。
     */
    const containerStyle = computed(() => props.autoHeight
      ? { outline: 'none', position: 'relative', display: 'block' }
      : { outline: 'none', height: '100%', overflowY: 'auto', position: 'relative', display: 'block', contain: 'strict' })

    const handleReset = list => {
      cachedList = Array(list.length)
      startIndex = -1
      endIndex = -1
      if (cachedList.length) {
        void nextTick(() => {
          requestAnimationFrame(() => {
            updateView()
          })
        })
      } else {
        views.value = []
      }
    }
    watch(() => props.itemHeight, () => {
      handleReset(props.list)
    })
    // 同时盯长度：本仓的列表写回一律是**原地改**（splice/push，见 AGENTS §2.10），
    // 数组引用不变 → 只盯引用的话，数据后到（挂载时还是空数组）就永远不重算区间
    //
    // 还要盯**每一项的身份**：`splice(0, len, ...list)` 这种「原地改 + 长度不变」的写回（真机：在线
    // 列表刷新 / 云端歌单加歌）引用与长度都不变，只靠前两项时这个 watcher 根本不跑，屏上留着旧内容。
    // 探针用 `map` 逐项读一遍：既读到每一项（splice 触发的正是这些下标键），又不做任何比较——
    // 比较交给 `createList` 的身份比对（那里才知道哪些行该重建）。
    watch(() => [props.list, props.list.length, props.list.map(item => item)], ([list]) => {
      handleReset(list)
    })

    /**
     * 容器尺寸变化时重算渲染区间。
     *
     * 为什么必须有：渲染区间是**按调用瞬间的 `clientHeight`** 算的（`updateView` 里的
     * `Math.ceil(scrollContainerHeight / itemHeight)`）。挂载那一刻如果容器还没拿到高度
     * （父级是 `display:none` 刚切回来、或整条 flex/百分比高度链在下一帧才结算），
     * 算出来的区间就只有一行，而**只靠 window.resize 是修不回来的**（窗口没变过）。
     * 2026-09-23 在「我的收藏」的来源切换 / 乐馆 MV 面板 / 发现页新歌 Tab 上都踩到过。
     */
    let resizeObserver = null

    onMounted(() => {
      dom_scrollContainer.value.addEventListener('scroll', onScroll, {
        capture: false,
        passive: true,
      })
      cachedList = Array(props.list.length)
      startIndex = -1
      endIndex = -1

      if (props.list.length) {
        void nextTick(() => {
          requestAnimationFrame(() => {
            updateView()
          })
        })
      }
      window.addEventListener('resize', handleResize)
      if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(() => { updateView() })
        resizeObserver.observe(dom_scrollContainer.value)
      }
    })
    onBeforeUnmount(() => {
      // 先立标志再干活：rAF / ResizeObserver 里**已经排进队列**的回调没法取消（只能靠标志早退），
      // 定时器与 ResizeObserver 这两个能取消的顺手取消掉（工单 04）
      isUnmounted = true
      if (resizeTimer) {
        window.clearTimeout(resizeTimer)
        resizeTimer = null
      }
      dom_scrollContainer.value.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', handleResize)
      resizeObserver?.disconnect()
      resizeObserver = null
      if (cancelScroll) cancelScroll()
    })

    return {
      views,
      dom_scrollContainer,
      contentStyle,
      containerStyle,
      scrollTo,
      scrollToIndex,
      getScrollTop,
    }
  },
}
</script>
