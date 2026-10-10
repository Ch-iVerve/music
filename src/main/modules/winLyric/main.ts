import path from 'node:path'
import { BrowserWindow } from 'electron'
import { debounce, getPlatform, isLinux, isWin } from '@common/utils'
import { applyWindowDrag, clampWindowBoundsToWorkArea, MIN_SIZE, type ResizeEdge, type WindowBounds } from '@common/utils/windowGeometry'
import { createDragCoalescer } from './dragCoalescer'
import { initWindowSize, minHeight, minWidth } from './utils'
import { mainSend } from '@common/mainIpc'
import { encodePath } from '@common/utils/electron'

// require('./event')
// require('./rendererEvent')

let browserWindow: Electron.BrowserWindow | null = null
let isWinBoundsUpdateing = false

/**
 * 一次拖动的基准几何：按下瞬间的 `getBounds()`。
 * 渲染侧每帧只报「自按下以来的总位移」，套在这个基准上算下一帧几何
 * （而不是叠加到当前位置上——旧实现那样做会随帧数累积，实测拖 120px 窗口跑 658px）。
 */
let dragState: { mode: 'move' | 'resize', edge?: ResizeEdge, base: WindowBounds } | null = null

/**
 * 本次交互「想要」的几何（建窗/拖动时由纯函数算出），落盘优先用它。
 *
 * 为什么不直接用平台回读值：X11 + 小数缩放下 `getContentBounds()` 会把物理像素取整的结果
 * 报回来，实测在部分尺寸上是**固定偏大 1 DIP** 的（请求 1033 → 回读 1034）。若把它写回设置，
 * 「落盘 → 下次建窗」就会每次重启长 1 DIP、无限累积。所以配置只记我们的意图值，
 * 平台的取整不回灌（窗口实际可能差 1 物理像素，但跨重启稳定、不增长）。
 * 3s 后清空（覆盖建窗后 WM 的迟到 resize 与拖动后的防抖落盘）：之后的外部变化
 * （系统/WM 挪窗）仍按回读值落盘。
 */
let intendedBounds: WindowBounds | null = null
let intendedTimer: NodeJS.Timeout | null = null
const keepIntendedBounds = (bounds: WindowBounds) => {
  intendedBounds = bounds
  if (intendedTimer) clearTimeout(intendedTimer)
  intendedTimer = setTimeout(() => {
    intendedBounds = null
    intendedTimer = null
  }, 800)
}
const getBoundsForSave = (): Electron.Rectangle => intendedBounds ?? browserWindow!.getContentBounds()

const saveBoundsConfig = debounce((config: Partial<LX.AppSetting>) => {
  global.lx.event_app.update_config(config)
  if (isWinBoundsUpdateing) isWinBoundsUpdateing = false
}, 500)

const winEvent = () => {
  if (!browserWindow) return

  // browserWindow.on('close', () => {
  //   if (global.lx.appSetting['desktopLyric.enable'] && !global.lx.mainWindowClosed) {
  //     browserWindow = null
  //     global.lx.event_app.update_config({ 'desktopLyric.enable': false })
  //   }
  // })

  browserWindow.on('closed', () => {
    browserWindow = null
  })

  browserWindow.on('move', () => {
    // bounds = browserWindow.getBounds()
    // console.log('move', isWinBoundsUpdateing)
    if (isWinBoundsUpdateing) {
      const bounds = getBoundsForSave()
      saveBoundsConfig({
        'desktopLyric.x': bounds.x,
        'desktopLyric.y': bounds.y,
        'desktopLyric.width': bounds.width,
        'desktopLyric.height': bounds.height,
      })
    } else if (isWin) { // Linux 不允许将窗口设置出屏幕之外，MacOS未知，故只在Windows下执行强制设置
      // 非主动调整窗口触发的窗口位置变化将重置回设置值
      browserWindow!.setContentBounds({
        x: global.lx.appSetting['desktopLyric.x'] ?? 0,
        y: global.lx.appSetting['desktopLyric.y'] ?? 0,
        width: global.lx.appSetting['desktopLyric.width'],
        height: global.lx.appSetting['desktopLyric.height'],
      })
    }
  })

  browserWindow.on('resize', () => {
    // bounds = browserWindow.getBounds()
    // console.log(bounds)
    isWinBoundsUpdateing = true
    const bounds = getBoundsForSave()
    saveBoundsConfig({
      'desktopLyric.x': bounds.x,
      'desktopLyric.y': bounds.y,
      'desktopLyric.width': bounds.width,
      'desktopLyric.height': bounds.height,
    })
  })

  // browserWindow.on('restore', () => {
  //   browserWindow.webContents.send('restore')
  // })
  // browserWindow.on('focus', () => {
  //   browserWindow.webContents.send('focus')
  // })

  browserWindow.once('ready-to-show', () => {
    showWindow()
    if (global.lx.appSetting['desktopLyric.isLock']) {
      browserWindow!.setIgnoreMouseEvents(true, { forward: !isLinux && global.lx.appSetting['desktopLyric.isHoverHide'] })
    }
    // linux下每次重开时貌似要重新设置置顶
    // if (isLinux && global.lx.appSetting['desktopLyric.isAlwaysOnTop']) {
    //   browserWindow!.setAlwaysOnTop(global.lx.appSetting['desktopLyric.isAlwaysOnTop'], 'screen-saver')
    // }
    if (global.lx.appSetting['desktopLyric.isAlwaysOnTop'] && global.lx.appSetting['desktopLyric.isAlwaysOnTopLoop']) alwaysOnTopTools.startLoop()
    browserWindow!.blur()
  })
}

export const createWindow = () => {
  closeWindow()
  if (!global.envParams.workAreaSize) return
  let x = global.lx.appSetting['desktopLyric.x']
  let y = global.lx.appSetting['desktopLyric.y']
  let width = global.lx.appSetting['desktopLyric.width']
  let height = global.lx.appSetting['desktopLyric.height']
  let isAlwaysOnTop = global.lx.appSetting['desktopLyric.isAlwaysOnTop']
  // let isLockScreen = global.lx.appSetting['desktopLyric.isLockScreen']
  let isShowTaskbar = global.lx.appSetting['desktopLyric.isShowTaskbar']
  // let { width: screenWidth, height: screenHeight } = global.envParams.workAreaSize
  const winSize = initWindowSize(x, y, width, height)
  global.lx.event_app.update_config({
    'desktopLyric.x': winSize.x,
    'desktopLyric.y': winSize.y,
    'desktopLyric.width': winSize.width,
    'desktopLyric.height': winSize.height,
  })

  const { shouldUseDarkColors, theme } = global.lx.theme

  /**
   * Initial window options
   */
  browserWindow = new BrowserWindow({
    height: winSize.height,
    width: winSize.width,
    x: winSize.x,
    y: winSize.y,
    minWidth,
    minHeight,
    // 几何一律走**内容区**（useContentSize + get/setContentBounds）：建窗时的 width/height
    // 是内容尺寸，落盘与拖动协议读写的也是内容尺寸，两侧同一个坐标系。
    // 上游用的是 `useContentSize: true` + `getBounds()`（**窗口矩形**），在带边框/小数缩放的
    // 平台上这两者不等，于是「落盘值 → 下次建窗」每次都多出一个边框（本机实测 +8 DIP/次重启，
    // 无上限累积）；统一到内容区后重启尺寸才精确复现。
    useContentSize: true,
    frame: false,
    transparent: true,
    hasShadow: false,
    // enableRemoteModule: false,
    // icon: join(global.__static, isWin ? 'icons/256x256.ico' : 'icons/512x512.png'),
    resizable: isWin,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    roundedCorners: false,
    show: false,
    alwaysOnTop: isAlwaysOnTop,
    // Linux 上 `skipTaskbar` 是**空实现**：Electron 42.11.6 的 `NativeWindowViews::SetSkipTaskbar`
    // 整个函数体都在 `#if IS_WIN` 内（官方 issue #33124 标 wontfix，文档也只标 macOS/Windows），
    // 所以下面那行与 config.ts 的热更新在 Linux 上都是 no-op——不是写错了，是平台不支持。
    // Linux 唯一能影响 WM 归类的通道是建窗时的 `type`（Electron 据此写 `_NET_WM_WINDOW_TYPE_*`）：
    // 本机实测（Muffin/X11，2026-09-24）`utility` → `_NET_WM_WINDOW_TYPE_UTILITY`，WM 自行补上
    // `_NET_WM_STATE_SKIP_TASKBAR`，而 Cinnamon 的 Alt-Tab（appSwitcher.js:35）与面板
    // （window-list / grouped-window-list）都按 `Meta.Window.is_skip_taskbar()` 过滤，于是两处都不再列出它。
    // 因此用 `!isShowTaskbar` 而不是无条件设 utility：置 true 时仍建普通窗口，保住「录屏软件
    // 抓不到时把它放进任务栏」这条既有退路。
    // 两条限制：type 只在建窗时写入（运行期改不了，切换该开关要重开歌词窗）；设了 `parent`
    // 会被 WM 强制改写成 dialog，别给这个窗口设 parent。
    type: isLinux && !isShowTaskbar ? 'utility' : undefined,
    skipTaskbar: !isShowTaskbar,
    webPreferences: {
      contextIsolation: false,
      webSecurity: false,
      sandbox: false,
      nodeIntegration: true,
      enableWebSQL: false,
      webgl: false,
      spellcheck: false, // 禁用拼写检查器
      backgroundThrottling: false,
    },
  })

  const winURL = process.env.NODE_ENV !== 'production' ? 'http://localhost:9081/lyric.html' : `file://${path.join(encodePath(__dirname), 'lyric.html')}`
  void browserWindow.loadURL(winURL + `?os=${getPlatform()}&dark=${shouldUseDarkColors}&theme=${encodeURIComponent(JSON.stringify(theme))}`)

  winEvent()
  // 建窗时 Electron 自己会把尺寸/位置取整偏掉（本机实测 +5~6 DIP），再用同一条写入口校正一次，
  // 保证「落盘值 → 下次建窗」不产生累积误差
  keepIntendedBounds({ ...winSize })
  setBounds({ ...winSize })
  // browserWindow.webContents.openDevTools()
  global.lx.event_app.desktop_lyric_window_created(browserWindow)
}
export const isExistWindow = (): boolean => !!browserWindow

export const closeWindow = () => {
  if (!browserWindow) return
  browserWindow.close()
}

export const showWindow = () => {
  if (!browserWindow) return
  browserWindow.show()
}

export const setResizeable = (isResizeable: boolean) => {
  if (!browserWindow) return
  browserWindow.setResizable(isResizeable)
}

export const sendEvent = <T = any>(name: string, params?: T) => {
  if (!browserWindow) return
  mainSend(browserWindow, name, params)
}

/** 当前几何：内容区矩形（与建窗尺寸、落盘值同一坐标系，见 createWindow 的注释） */
export const getBounds = (): Electron.Rectangle | null => {
  if (!browserWindow) return null
  return browserWindow.getContentBounds()
}

/**
 * 写窗口几何（内容区坐标系）。
 *
 * `compensate`（默认 true）控制写完后的「回读差补」：X11 + 小数缩放（本机 dpr=1.296875）
 * 下，`setContentBounds` 会把请求取整到物理像素，实测**系统性偏大 ~2 DIP**；这个偏差会被
 * 「落盘 → 下次建窗」循环逐次叠加（实测不补偿时每次重启 +2~8 DIP，无上限），补一次就收敛。
 *
 * 拖动帧必须传 `compensate = false`（见 handleWindowDrag）：补偿对落盘没有任何贡献——
 * 拖动期间落盘的是 intendedBounds（我们的请求值），不是回读值；它只为让 X 立刻对齐到
 * DIP，代价是每帧一次**同步** X 往返 + 小数缩放下几乎每帧必差的第二次写窗口
 * （2026-10-10 实测为拖动卡顿的主成分）。拖动帧的 ±2 物理像素偏差不可感知，
 * 收敛交给下一次建窗时的补偿。
 *
 * 补偿的另外两条约束（仅 compensate = true 时相关）：
 * - 补偿值不得低于最小尺寸——平台的量化误差本来就在 ±2 DIP，按差值补会把它推到下限以下
 *   （实测最小尺寸会被缩到 37），钳在 `minSize` 上；
 * - 补偿只做一轮：物理量化步长 < 1 DIP 时差值不会再变小，反复写只会来回抖。
 */
export const setBounds = (bounds: Electron.Rectangle, minSize = MIN_SIZE, compensate = true) => {
  if (!browserWindow) return
  isWinBoundsUpdateing = true
  browserWindow.setContentBounds(bounds)
  if (!compensate) return
  const got = browserWindow.getContentBounds()
  if (got.x != bounds.x || got.y != bounds.y || got.width != bounds.width || got.height != bounds.height) {
    browserWindow.setContentBounds({
      x: bounds.x + (bounds.x - got.x),
      y: bounds.y + (bounds.y - got.y),
      width: Math.max(bounds.width + (bounds.width - got.width), minSize.minWidth),
      height: Math.max(bounds.height + (bounds.height - got.height), minSize.minHeight),
    })
  }
}

/**
 * 一次拖动帧的几何落地：按按下瞬间的基准算下一帧 → 钳工作区 → 记意图 → 写窗口。
 * 写入走 `setBounds(…, compensate = false)`（理由见 setBounds 注释）。
 */
const applyDragUpdate = (action: LX.DesktopLyric.WindowDrag) => {
  if (!browserWindow || !dragState) return
  const dx = Math.round(action.dx ?? 0)
  const dy = Math.round(action.dy ?? 0)
  // 锁定态只许移动（ui-polish-followups 工单 07）：收到缩放帧整帧跳过——不写窗口、也不记意图值。
  // 判据是**现读**设置，所以拖动中途被锁（快捷键）也能立刻停住。
  const next = applyWindowDrag(dragState.base, dragState, dx, dy, global.lx.appSetting['desktopLyric.isLock'])
  if (!next) return
  const bounds = clampWindowBoundsToWorkArea(
    next,
    global.lx.appSetting['desktopLyric.isLockScreen'] ? global.envParams.workAreaSize : null,
  )
  keepIntendedBounds(bounds)
  setBounds(bounds, MIN_SIZE, false)
}

const dragCoalescer = createDragCoalescer<LX.DesktopLyric.WindowDrag>(applyDragUpdate)

/**
 * 断联保险：update 流停止超过 1s 就解除拖动态。
 *
 * 为什么需要：透明歌词窗在部分状态下（实测暂停隐藏、以及部分像素级命中场景）会
 * **吞掉 mouseup**——渲染层的 endWindowDrag 发不出来，主进程的 dragState 带着旧基准
 * 一直挂着；之后的任何一次输入会被当成「自旧按下点起算的巨量位移」，把窗口甩进
 * 屏幕角落并钳到最小尺寸（2026-10-10 复盘的坍缩成因）。松手正常时 end 会先到，
 * 这个定时器只是兜底；代价是真实拖动中停顿超过 1s 后需重新按住（可接受，远好于甩飞）。
 */
const DRAG_DEADMAN_MS = 1000
let dragDeadman: NodeJS.Timeout | null = null
const armDragDeadman = () => {
  if (dragDeadman) clearTimeout(dragDeadman)
  dragDeadman = setTimeout(() => {
    dragDeadman = null
    dragState = null
  }, DRAG_DEADMAN_MS)
}
const disarmDragDeadman = () => {
  if (!dragDeadman) return
  clearTimeout(dragDeadman)
  dragDeadman = null
}

/**
 * 处理渲染侧的拖动协议（移动 / 缩放都走这里）。
 * 拖动期间主进程是几何的唯一计算方：渲染侧不知道也不需要知道窗口当前尺寸。
 * update 帧经 `dragCoalescer` 合并到 ~60fps（理由见 dragCoalescer.ts）。
 */
export const handleWindowDrag = (action: LX.DesktopLyric.WindowDrag) => {
  if (!browserWindow) return
  switch (action.type) {
    case 'start':
      if (!action.mode) break
      // 上一轮的残帧相对新基准没有意义，直接丢弃（不清的话，快速连按会把旧位移打进新拖动）
      dragCoalescer.clear()
      disarmDragDeadman()
      dragState = {
        mode: action.mode,
        edge: action.edge,
        base: browserWindow.getContentBounds(),
      }
      break
    case 'end':
      // 先冲刷暂存帧再解除拖动态：最后一帧不能丢，否则快速甩动松手后窗口停在松手前
      dragCoalescer.flushNow()
      disarmDragDeadman()
      dragState = null
      break
    case 'update': {
      if (!dragState) break
      armDragDeadman()
      dragCoalescer.push(action)
      break
    }
  }
}


export const setIgnoreMouseEvents = (ignore: boolean, options?: Electron.IgnoreMouseEventsOptions) => {
  if (!browserWindow) return
  browserWindow.setIgnoreMouseEvents(ignore, options)
}

export const setSkipTaskbar = (skip: boolean) => {
  if (!browserWindow) return
  browserWindow.setSkipTaskbar(skip)
}

export const setAlwaysOnTop = (flag: boolean, level?: 'normal' | 'floating' | 'torn-off-menu' | 'modal-panel' | 'main-menu' | 'status' | 'pop-up-menu' | 'screen-saver' | undefined, relativeLevel?: number | undefined) => {
  if (!browserWindow) return
  browserWindow.setAlwaysOnTop(flag, level, relativeLevel)
}

export const getMainFrame = (): Electron.WebFrameMain | null => {
  if (!browserWindow) return null
  return browserWindow.webContents.mainFrame
}

interface AlwaysOnTopTools {
  timeout: NodeJS.Timeout | null
  setAlwaysOnTop: (isLoop: boolean) => void
  startLoop: () => void
  clearLoop: () => void
}
export const alwaysOnTopTools: AlwaysOnTopTools = {
  timeout: null,
  setAlwaysOnTop(isLoop) {
    this.clearLoop()
    setAlwaysOnTop(global.lx.appSetting['desktopLyric.isAlwaysOnTop'], 'screen-saver')
    // console.log(isLoop)
    if (isLoop) this.startLoop()
  },
  startLoop() {
    this.clearLoop()
    this.timeout = setInterval(() => {
      if (!isExistWindow()) {
        this.clearLoop()
        return
      }
      setAlwaysOnTop(true, 'screen-saver')
    }, 500)
  },
  clearLoop() {
    if (!this.timeout) return
    clearInterval(this.timeout)
    this.timeout = null
  },
}
