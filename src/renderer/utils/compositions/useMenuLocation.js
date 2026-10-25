import { onMounted, onBeforeUnmount, watch, reactive, ref } from '@common/utils/vueTools'


export default ({ visible, location, onHide }) => {
  const transition1 = 'transform, opacity'
  const transition2 = 'transform, opacity, top, left'
  let show = false
  const dom_menu = ref(null)
  const menuStyles = reactive({
    left: 0,
    top: 0,
    opacity: 0,
    transitionProperty: 'transform, opacity',
    transform: 'scale(.8, .7) translate(0,0)',
    pointerEvents: 'none',
  })

  const handleShow = () => {
    show = true
    menuStyles.opacity = 1
    menuStyles.transform = `scale(1) translate(${handleGetOffsetXY(location.value.x, location.value.y)})`
    menuStyles.pointerEvents = 'auto'
  }
  const handleHide = () => {
    menuStyles.opacity = 0
    menuStyles.transform = 'scale(.8, .7) translate(0, 0)'
    menuStyles.pointerEvents = 'none'
    show = false
  }
  const handleGetOffsetXY = (left, top) => {
    const listWidth = dom_menu.value.clientWidth
    const listHeight = dom_menu.value.clientHeight
    const dom_container_parant = dom_menu.value.offsetParent
    const containerWidth = dom_container_parant.clientWidth
    const containerHeight = dom_container_parant.clientHeight
    const offsetWidth = containerWidth - left - listWidth
    const offsetHeight = containerHeight - top - listHeight
    let x = 0
    let y = 0
    if (containerWidth > listWidth && offsetWidth < 12) {
      x = offsetWidth - 12
    }
    if (containerHeight > listHeight && offsetHeight < 5) {
      y = offsetHeight - 5
    }
    return `${x}px, ${y}px`
  }
  // 「点空白收起」。⚠️ 打开菜单的那次点击**也会**冒泡到这里（工单 23 的成因）：
  // Chromium 在每个监听器返回后跑一次 microtask checkpoint，Vue 的 watcher flush 就在里面，
  // 菜单正是在那次 checkpoint 被打开的，于是同一次点击紧接着关掉了它。
  // 所以**由 click 打开的菜单，触发元素上必须 `@click.stop`**（右键菜单走 contextmenu，不受影响）。
  // 真浏览器里的派发顺序与现象：`触发元素监听 → microtask → document 监听`，表现为
  // 「第一次点能弹（打开发生在事件派发之后）、之后再也弹不出（命中缓存 → 打开落回微任务）」。
  const handleDocumentClick = (event) => {
    if (!show) return

    if (event.target == dom_menu.value || dom_menu.value.contains(event.target)) return

    if (show && menuStyles.transitionProperty != transition1) menuStyles.transitionProperty = transition1

    onHide()
  }

  // Esc 收起菜单(2026-10-25 UI 审查 P1;自维护补丁,上游没有——分歧记录见 docs/adr/0014)。
  // 与点空白收起同一出口:onHide 由调用方落状态,不直接动 menuStyles。
  const handleDocumentKeydown = (event) => {
    if (event.key != 'Escape' || !show) return
    onHide()
  }

  watch(visible, visible => {
    visible ? handleShow() : handleHide()
  }, { immediate: true })

  // 最小贴边距（工单 05）：坐标为 0 时（键盘激活的元素给不出 pageX/pageY，见 useMusicJump 的兜底）
  // 减去 rootOffset 后是负数，菜单会被 `#root { overflow: hidden }` 裁得完全看不见。
  // 这里只保证「落在容器内侧」——真正的落点仍由调用方给（含 handleGetOffsetXY 的越界翻转）。
  const EDGE_INSET = 2
  const handleSetPosition = (location) => {
    menuStyles.left = Math.max(location.x - window.lx.rootOffset + 2, EDGE_INSET) + 'px'
    menuStyles.top = Math.max(location.y - window.lx.rootOffset, EDGE_INSET) + 'px'
  }

  watch(location, location => {
    handleSetPosition(location)
    // nextTick(() => {
    if (show) {
      if (menuStyles.transitionProperty != transition2) menuStyles.transitionProperty = transition2
      menuStyles.transform = `scale(1) translate(${handleGetOffsetXY(location.x, location.y)})`
    }
    // })
  }, { deep: true })

  onMounted(() => {
    document.addEventListener('click', handleDocumentClick)
    document.addEventListener('keydown', handleDocumentKeydown)
  })

  onBeforeUnmount(() => {
    document.removeEventListener('click', handleDocumentClick)
    document.removeEventListener('keydown', handleDocumentKeydown)
  })

  return {
    dom_menu,
    menuStyles,
  }
}
