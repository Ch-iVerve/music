/**
 * 测试用的 `electron` 模块桩。
 *
 * 为什么必须桩：`electron` 包在 Node 进程里 import 拿到的是它自带的 `index.js`，
 * 那份实现只在 Electron 运行时（主进程/渲染进程）里才由运行时注入真实 API，在普通
 * Node 或 jsdom 里读 `app` / `ipcMain` 会直接抛错（或拿到 undefined）。测试环境又
 * 不能拉起 Electron（无显示、无 GPU）。所以 `vitest.config.ts` 里把模块说明符
 * `electron` alias 到本文件（用正则 `^electron$` 精确匹配，避免误伤
 * `electron-log` / `electron-updater` 这些名字同前缀的包）。
 *
 * 实现原则：
 * 1. **只提供被测代码真的会碰到的 API**，行为对测试友好：
 *    - `app.getPath()` 指向本进程的临时目录，绝不碰 `~/.config`
 *    - 有副作用的方法一律 `vi.fn()`，测试可直接断言调用（如
 *      `expect(dialog.showMessageBoxSync).toHaveBeenCalled()`）
 * 2. `ipcMain` / `ipcRenderer` 维护真实的事件表，让 IPC 通道可被测试：
 *    主进程注册的 `mainHandle(name, ...)` 可以用 `__ipcMainInvoke(name, params)`
 *    直接触发，`mainSend(win, name, params)` 发出的消息可以用
 *    `__ipcRendererEmitted(name)` 取回。
 * 3. 缺失的 API 不写「万能 Proxy」——那会让读 `win.isVisible()` 之类的代码静默
 *    拿到函数（永远 truthy）而走错分支。缺什么就显式补什么（本文件按仓库现有的
 *    `from 'electron'` 用法逐个补齐，见 AGENTS.md §2.1）。
 *
 * 注意：本文件在 `src/` 之外，不进 webpack entry 依赖图、不被 eslint 扫描。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, vi } from 'vitest'

/**
 * 进程级临时目录：同一个测试文件里的所有用例共用（vitest 默认按文件隔离模块，
 * 所以每个测试文件会各建一个）。跑完自动删；要在现场翻文件就设 `VITEST_KEEP_TMP=1`
 * 再跑，目录路径是 `os.tmpdir()/chiverve-music-test-*`。
 */
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'chiverve-music-test-'))

afterAll(() => {
  if (process.env.VITEST_KEEP_TMP) return
  fs.rmSync(tempRoot, { recursive: true, force: true })
})

const appPaths: Record<string, string> = {
  home: os.homedir(),
  temp: os.tmpdir(),
  appData: path.join(tempRoot, 'appData'),
  userData: path.join(tempRoot, 'userData'),
  sessionData: path.join(tempRoot, 'sessionData'),
  logs: path.join(tempRoot, 'logs'),
  crashDumps: path.join(tempRoot, 'crashDumps'),
  exe: path.join(tempRoot, 'chiverve-music'),
  desktop: os.homedir(),
  documents: os.homedir(),
  downloads: os.homedir(),
  music: os.homedir(),
  pictures: os.homedir(),
  videos: os.homedir(),
}

const ensureDir = (dir: string) => {
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

// ---------------------------------------------------------------------------
// app
// ---------------------------------------------------------------------------

export const app = {
  getPath: vi.fn((name: string) => {
    const dir = appPaths[name]
    if (dir == null) throw new Error(`electron 桩未实现 app.getPath('${name}')，请按需补 test/stubs/electron.ts`)
    // userData/logs 这类会被真实代码写文件，先建出来，省得被测代码自己 mkdir
    return name === 'home' || name === 'temp' ? dir : ensureDir(dir)
  }),
  getName: vi.fn(() => 'chiverve-music'),
  // 版本号不用真实值：真正需要版本号的测试应该从 package.json 读
  getVersion: vi.fn(() => '0.0.0-test'),
  setVersion: vi.fn(),
  getAppPath: vi.fn(() => process.cwd()),
  getLocale: vi.fn(() => 'zh-CN'),
  getSystemLocale: vi.fn(() => 'zh-CN'),
  isPackaged: false,
  on: vi.fn(),
  once: vi.fn(),
  off: vi.fn(),
  removeListener: vi.fn(),
  whenReady: vi.fn(() => Promise.resolve()),
  quit: vi.fn(),
  exit: vi.fn(),
  relaunch: vi.fn(),
  focus: vi.fn(),
  hide: vi.fn(),
  show: vi.fn(),
  setAppUserModelId: vi.fn(),
  requestSingleInstanceLock: vi.fn(() => true),
  releaseSingleInstanceLock: vi.fn(),
  addRecentDocument: vi.fn(),
  clearRecentDocuments: vi.fn(),
  setLoginItemSettings: vi.fn(),
  getLoginItemSettings: vi.fn(() => ({ openAtLogin: false, openAsHidden: false })),
  setName: vi.fn(),
  setPath: vi.fn(),
  commandLine: {
    appendArgument: vi.fn(),
    appendSwitch: vi.fn(),
    hasSwitch: vi.fn(() => false),
    getSwitchValue: vi.fn(() => ''),
  },
  dock: {
    show: vi.fn(),
    hide: vi.fn(),
    setBadge: vi.fn(),
    setIcon: vi.fn(),
  },
}

// ---------------------------------------------------------------------------
// ipcMain / ipcRenderer
// ---------------------------------------------------------------------------

type Listener = (...args: any[]) => any

const mainHandlerMap = new Map<string, Listener>()
const mainListenerMap = new Map<string, Set<Listener>>()
const rendererListenerMap = new Map<string, Set<Listener>>()
/** `webContents.send` / `ipcRenderer.send` 落到这里，供测试取用 */
const emittedMap = new Map<string, any[]>()

/**
 * `once` 的包装器要带 `.listener` 指向原始 listener——这不是装饰，是 Node / Electron 的
 * EventEmitter 语义：`removeListener(name, 原始引用)` 靠 `wrapper.listener` 才匹配得到包装器。
 * （2026-09-26 实测：桩原先不带这个字段，于是「注册 once → 在触发前摘掉」在桩里删不掉、
 * 真机却能删——测试与真实行为不一致，比没有测试更危险。）
 */
const addTo = (map: Map<string, Set<Listener>>, name: string, listener: Listener, once = false) => {
  const set = map.get(name) ?? new Set<Listener>()
  map.set(name, set)
  if (once) {
    const wrapper: Listener = (...args) => {
      removeFrom(map, name, wrapper)
      return listener(...args)
    }
    ;(wrapper as any).listener = listener
    set.add(wrapper)
    return
  }
  set.add(listener)
}

/** 与 EventEmitter 一致：命中 `listener` 本身或它的 `once` 包装器（`.listener`）都算匹配 */
const removeFrom = (map: Map<string, Set<Listener>>, name: string, listener: Listener) => {
  const set = map.get(name)
  if (set == null) return
  for (const item of set) {
    if (item === listener || (item as any).listener === listener) {
      set.delete(item)
      return
    }
  }
}

const recordEmit = (name: string, params?: any) => {
  const list = emittedMap.get(name) ?? []
  list.push(params)
  emittedMap.set(name, list)
}

/** 构造一个假的 IpcMainInvokeEvent / IpcMainEvent，够被测代码读 sender / senderFrame */
const createIpcEvent = () => ({
  sender: webContentsStub,
  senderFrame: webContentsStub.mainFrame,
  frameId: 0,
  processId: process.pid,
  returnValue: undefined as any,
  reply: vi.fn(),
})

export const ipcMain = {
  handle: vi.fn((name: string, listener: Listener) => { mainHandlerMap.set(name, listener) }),
  handleOnce: vi.fn((name: string, listener: Listener) => { mainHandlerMap.set(name, listener) }),
  removeHandler: vi.fn((name: string) => { mainHandlerMap.delete(name) }),
  on: vi.fn((name: string, listener: Listener) => { addTo(mainListenerMap, name, listener) }),
  once: vi.fn((name: string, listener: Listener) => { addTo(mainListenerMap, name, listener, true) }),
  off: vi.fn((name: string, listener: Listener) => { removeFrom(mainListenerMap, name, listener) }),
  removeListener: vi.fn((name: string, listener: Listener) => { removeFrom(mainListenerMap, name, listener) }),
  removeAllListeners: vi.fn((name?: string) => {
    if (name == null) mainListenerMap.clear()
    else mainListenerMap.delete(name)
  }),
  listenerCount: vi.fn((name: string) => mainListenerMap.get(name)?.size ?? 0),
}

export const ipcRenderer = {
  send: vi.fn((name: string, params?: any) => { recordEmit(name, params) }),
  sendSync: vi.fn((name: string, params?: any) => { recordEmit(name, params); return undefined }),
  invoke: vi.fn(async(name: string, params?: any) => {
    const handler = mainHandlerMap.get(name)
    if (handler == null) return undefined
    return handler(createIpcEvent(), params)
  }),
  on: vi.fn((name: string, listener: Listener) => { addTo(rendererListenerMap, name, listener) }),
  once: vi.fn((name: string, listener: Listener) => { addTo(rendererListenerMap, name, listener, true) }),
  off: vi.fn((name: string, listener: Listener) => { removeFrom(rendererListenerMap, name, listener) }),
  removeListener: vi.fn((name: string, listener: Listener) => { removeFrom(rendererListenerMap, name, listener) }),
  removeAllListeners: vi.fn((name?: string) => {
    if (name == null) rendererListenerMap.clear()
    else rendererListenerMap.delete(name)
  }),
  listenerCount: vi.fn((name: string) => rendererListenerMap.get(name)?.size ?? 0),
}

/**
 * 测试辅助：触发主进程用 `mainHandle` / `mainOn` 注册的处理函数。
 * `mainHandle` 的包装是 `ipcMain.handle(name, async(event, params) => listener({event, params}))`，
 * 所以这里传一个假 event 即可。
 */
export const __ipcMainInvoke = async(name: string, params?: any) => {
  const handler = mainHandlerMap.get(name)
  if (handler == null) throw new Error(`主进程没有注册 IPC 通道: ${name}`)
  return handler(createIpcEvent(), params)
}

/** 测试辅助：触发主进程用 `mainOn` 注册的监听器（参数是 `{event, params}` 形态之前的那层） */
export const __ipcMainEmit = (name: string, params?: any) => {
  const set = mainListenerMap.get(name)
  if (set == null || set.size === 0) throw new Error(`主进程没有监听 IPC 事件: ${name}`)
  for (const listener of [...set]) listener(createIpcEvent(), params)
}

/** 测试辅助：取回 `webContents.send` / `ipcRenderer.send` 发过的参数（按发送顺序） */
export const __ipcRendererEmitted = (name: string) => emittedMap.get(name) ?? []

/** 测试辅助：触发渲染侧用 `rendererOn` 注册的监听器（模拟主进程 mainSend 到该窗口） */
export const __ipcRendererEmit = (name: string, params?: any) => {
  const set = rendererListenerMap.get(name)
  if (set == null || set.size === 0) throw new Error(`渲染侧没有监听 IPC 事件: ${name}`)
  for (const listener of [...set]) listener(createIpcEvent(), params)
}

/** 清空所有 IPC 状态（beforeEach 里按需调用） */
export const __resetIpc = () => {
  mainHandlerMap.clear()
  mainListenerMap.clear()
  rendererListenerMap.clear()
  emittedMap.clear()
}

// ---------------------------------------------------------------------------
// webContents / BrowserWindow
// ---------------------------------------------------------------------------

const createEmitter = () => {
  const listeners = new Map<string, Set<Listener>>()
  return {
    on: vi.fn((name: string, listener: Listener) => { addTo(listeners, name, listener) }),
    once: vi.fn((name: string, listener: Listener) => { addTo(listeners, name, listener, true) }),
    off: vi.fn((name: string, listener: Listener) => { listeners.get(name)?.delete(listener) }),
    removeListener: vi.fn((name: string, listener: Listener) => { listeners.get(name)?.delete(listener) }),
    removeAllListeners: vi.fn((name?: string) => {
      if (name == null) listeners.clear()
      else listeners.delete(name)
    }),
    emit: (name: string, ...args: any[]) => {
      const set = listeners.get(name)
      if (set == null) return false
      for (const listener of [...set]) listener(...args)
      return true
    },
    listenerCount: (name: string) => listeners.get(name)?.size ?? 0,
  }
}

let webContentsSeq = 0

export const createWebContents = () => {
  const emitter = createEmitter()
  return {
    ...emitter,
    id: ++webContentsSeq,
    // 用于 AGENTS.md §2.3 里那种「校验调用来源窗口」的实现（mainFrame 恒等比较）
    mainFrame: { routingId: 1, url: 'file:///index.html' } as any,
    session: createSession(''),
    send: vi.fn((name: string, params?: any) => { recordEmit(name, params) }),
    sendToFrame: vi.fn(),
    postMessage: vi.fn(),
    executeJavaScript: vi.fn(async() => undefined),
    insertCSS: vi.fn(async() => ''),
    removeInsertedCSS: vi.fn(async() => undefined),
    openDevTools: vi.fn(),
    closeDevTools: vi.fn(),
    toggleDevTools: vi.fn(),
    isDevToolsOpened: vi.fn(() => false),
    setWindowOpenHandler: vi.fn(),
    setZoomFactor: vi.fn(),
    getZoomFactor: vi.fn(() => 1),
    reload: vi.fn(),
    isLoading: vi.fn(() => false),
    isDestroyed: vi.fn(() => false),
    focus: vi.fn(),
    canGoBack: vi.fn(() => false),
    goBack: vi.fn(),
    loadURL: vi.fn(async() => undefined),
    setAudioMuted: vi.fn(),
    isAudioMuted: vi.fn(() => false),
    setVisualZoomLevelLimits: vi.fn(async() => undefined),
    getURL: vi.fn(() => ''),
  }
}

/** 全局单例的 webContents 桩：ipcMain 的假 event 会带上它 */
const webContentsStub = createWebContents()

export const webContents = {
  getAllWebContents: vi.fn(() => [webContentsStub]),
  fromId: vi.fn(() => webContentsStub),
  getFocusedWebContents: vi.fn(() => webContentsStub),
}

export class BrowserWindow {
  static instances: BrowserWindow[] = []

  static getAllWindows = vi.fn(() => BrowserWindow.instances)
  static getFocusedWindow = vi.fn(() => null)
  static fromWebContents = vi.fn(() => null)
  static fromId = vi.fn(() => null)

  id: number
  webContents = webContentsStub
  private destroyed = false
  private visible = false
  private fullScreen = false
  private minimized = false
  private maximized = false
  private bounds = { x: 0, y: 0, width: 1000, height: 670 }

  constructor(options: any = {}) {
    this.id = BrowserWindow.instances.length + 1
    this.options = options
    BrowserWindow.instances.push(this)
  }

  options: any

  loadURL = vi.fn(async() => undefined)
  loadFile = vi.fn(async() => undefined)
  on = vi.fn()
  once = vi.fn()
  off = vi.fn()
  removeListener = vi.fn()
  removeAllListeners = vi.fn()
  emit = vi.fn()
  show = vi.fn(() => { this.visible = true })
  showInactive = vi.fn(() => { this.visible = true })
  hide = vi.fn(() => { this.visible = false })
  focus = vi.fn()
  blur = vi.fn()
  close = vi.fn(() => { this.destroyed = true })
  destroy = vi.fn(() => { this.destroyed = true })
  isDestroyed = vi.fn(() => this.destroyed)
  isVisible = vi.fn(() => this.visible)
  isMinimized = vi.fn(() => this.minimized)
  isMaximized = vi.fn(() => this.maximized)
  isFullScreen = vi.fn(() => this.fullScreen)
  isAlwaysOnTop = vi.fn(() => false)
  minimize = vi.fn(() => { this.minimized = true })
  restore = vi.fn(() => { this.minimized = false })
  maximize = vi.fn(() => { this.maximized = true })
  unmaximize = vi.fn(() => { this.maximized = false })
  setFullScreen = vi.fn((flag: boolean) => { this.fullScreen = flag })
  setTitle = vi.fn()
  setMenu = vi.fn()
  setMenuBarVisibility = vi.fn()
  setResizable = vi.fn()
  setMinimumSize = vi.fn()
  setMaximumSize = vi.fn()
  setSize = vi.fn((w: number, h: number) => { this.bounds = { ...this.bounds, width: w, height: h } })
  getSize = vi.fn(() => [this.bounds.width, this.bounds.height])
  setBounds = vi.fn((bounds: Partial<typeof this.bounds>) => { this.bounds = { ...this.bounds, ...bounds } })
  getBounds = vi.fn(() => ({ ...this.bounds }))
  getPosition = vi.fn(() => [this.bounds.x, this.bounds.y])
  setPosition = vi.fn((x: number, y: number) => { this.bounds = { ...this.bounds, x, y } })
  setAlwaysOnTop = vi.fn()
  setSkipTaskbar = vi.fn()
  setIgnoreMouseEvents = vi.fn()
  setOpacity = vi.fn()
  setVisibleOnAllWorkspaces = vi.fn()
  setBackgroundColor = vi.fn()
  center = vi.fn()
  setProgressBar = vi.fn()
  setThumbarButtons = vi.fn(() => true)
  setOverlayIcon = vi.fn()
  setRepresentedFilename = vi.fn()
  setDocumentEdited = vi.fn()
  setTitleBarOverlay = vi.fn()
  flashFrame = vi.fn()
  moveTop = vi.fn()
  previewFile = vi.fn()
}

// ---------------------------------------------------------------------------
// 其余常用模块
// ---------------------------------------------------------------------------

export const dialog = {
  showMessageBoxSync: vi.fn(() => 0),
  showMessageBox: vi.fn(async() => ({ response: 0, checkboxChecked: false })),
  showOpenDialogSync: vi.fn(() => ['/tmp/picked']),
  showOpenDialog: vi.fn(async() => ({ canceled: false, filePaths: ['/tmp/picked'] })),
  showSaveDialogSync: vi.fn(() => '/tmp/picked'),
  showSaveDialog: vi.fn(async() => ({ canceled: false, filePath: '/tmp/picked' })),
  showErrorBox: vi.fn(),
  showCertificateTrustDialog: vi.fn(async() => undefined),
}

export const shell = {
  openExternal: vi.fn(async() => undefined),
  openPath: vi.fn(async() => ''),
  showItemInFolder: vi.fn(),
  trashItem: vi.fn(async() => undefined),
  beep: vi.fn(),
  writeShortcutLink: vi.fn(() => true),
  readShortcutLink: vi.fn(() => ({})),
}

export const clipboard = {
  writeText: vi.fn(),
  readText: vi.fn(() => ''),
  writeHTML: vi.fn(),
  readHTML: vi.fn(() => ''),
  writeImage: vi.fn(),
  readImage: vi.fn(() => ({ isEmpty: () => true })),
  clear: vi.fn(),
  availableFormats: vi.fn(() => [] as string[]),
}

// 拖入文件的绝对路径（`@common/utils/electron` 的 getPathForFile 用它）；桩里给空串 =
// 「取不到路径」，调用方按跳过处理（真机那次静默失效正是这个形态）
export const webUtils = {
  getPathForFile: vi.fn(() => ''),
}

export const nativeImage = {
  createEmpty: vi.fn(() => ({ isEmpty: () => true, getSize: () => ({ width: 0, height: 0 }) })),
  createFromPath: vi.fn(() => ({ isEmpty: () => false, getSize: () => ({ width: 1, height: 1 }) })),
  createFromBuffer: vi.fn(() => ({ isEmpty: () => false, getSize: () => ({ width: 1, height: 1 }) })),
  createFromDataURL: vi.fn(() => ({ isEmpty: () => false, getSize: () => ({ width: 1, height: 1 }) })),
  createFromBitmap: vi.fn(() => ({ isEmpty: () => false })),
}

export const nativeTheme = {
  shouldUseDarkColors: false,
  shouldUseHighContrastColors: false,
  shouldUseInvertedColorScheme: false,
  inForcedColorsMode: false,
  themeSource: 'system' as const,
  on: vi.fn(),
  once: vi.fn(),
  off: vi.fn(),
  removeListener: vi.fn(),
}

export const screen = {
  getPrimaryDisplay: vi.fn(() => ({
    id: 1,
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    workArea: { x: 0, y: 0, width: 1920, height: 1040 },
    workAreaSize: { width: 1920, height: 1040 },
    size: { width: 1920, height: 1080 },
    scaleFactor: 1,
    rotation: 0,
    touchSupport: 'unknown',
  })),
  getAllDisplays: vi.fn(() => [screen.getPrimaryDisplay()]),
  getDisplayMatching: vi.fn(() => screen.getPrimaryDisplay()),
  getDisplayNearestPoint: vi.fn(() => screen.getPrimaryDisplay()),
  getCursorScreenPoint: vi.fn(() => ({ x: 0, y: 0 })),
  screenToDipPoint: vi.fn((point: any) => point),
  dipToScreenPoint: vi.fn((point: any) => point),
}

export class Menu {
  static setApplicationMenu = vi.fn()
  static getApplicationMenu = vi.fn(() => null)
  static buildFromTemplate = vi.fn((template: any) => ({ items: template, popup: vi.fn(), closePopup: vi.fn() }))

  items: any[]
  constructor(template: any[] = []) {
    this.items = template
  }

  popup = vi.fn()
  closePopup = vi.fn()
  append = vi.fn()
  insert = vi.fn()
}

export class Tray {
  static instances: Tray[] = []

  constructor(public image?: any) {
    Tray.instances.push(this)
  }

  setToolTip = vi.fn()
  setTitle = vi.fn()
  setImage = vi.fn()
  setContextMenu = vi.fn()
  setIgnoreDoubleClickEvents = vi.fn()
  on = vi.fn()
  once = vi.fn()
  off = vi.fn()
  removeListener = vi.fn()
  removeAllListeners = vi.fn()
  destroy = vi.fn()
  isDestroyed = vi.fn(() => false)
  popUpContextMenu = vi.fn()
  displayBalloon = vi.fn()
}

export class Notification {
  static isSupported = vi.fn(() => true)

  constructor(public options: any = {}) {}

  show = vi.fn()
  close = vi.fn()
  on = vi.fn()
  once = vi.fn()
  off = vi.fn()
}

export const globalShortcut = {
  register: vi.fn(() => true),
  registerAll: vi.fn(),
  isRegistered: vi.fn(() => false),
  unregister: vi.fn(),
  unregisterAll: vi.fn(),
}

export const powerSaveBlocker = {
  start: vi.fn(() => 1),
  stop: vi.fn(() => true),
  isStarted: vi.fn(() => false),
}

export const powerMonitor = {
  on: vi.fn(),
  once: vi.fn(),
  off: vi.fn(),
  removeListener: vi.fn(),
  getSystemIdleState: vi.fn(() => 'active' as const),
  getSystemIdleTime: vi.fn(() => 0),
  isOnBatteryPower: vi.fn(() => false),
}

export const protocol = {
  handle: vi.fn(),
  unhandle: vi.fn(),
  registerSchemesAsPrivileged: vi.fn(),
  registerFileProtocol: vi.fn(),
  registerBufferProtocol: vi.fn(),
  registerStringProtocol: vi.fn(),
  isProtocolHandled: vi.fn(async() => false),
}

export const net = {
  request: vi.fn(),
  fetch: vi.fn(async() => ({ ok: true, status: 200, json: async() => ({}), text: async() => '' })),
  isOnline: vi.fn(() => true),
}

export const contextBridge = {
  exposeInMainWorld: vi.fn(),
  exposeInIsolatedWorld: vi.fn(),
  executeInMainWorld: vi.fn(),
}

export const crashReporter = {
  start: vi.fn(),
  getLastCrashReport: vi.fn(() => null),
  getUploadedReports: vi.fn(() => []),
}

export const desktopCapturer = {
  getSources: vi.fn(async() => []),
}

export const systemPreferences = {
  getMediaAccessStatus: vi.fn(() => 'granted' as const),
  askForMediaAccess: vi.fn(async() => true),
  isDarkMode: vi.fn(() => false),
  getAccentColor: vi.fn(() => ''),
  on: vi.fn(),
}

export const inAppPurchase = {
  canMakePayments: vi.fn(() => false),
  getProducts: vi.fn(async() => []),
  purchaseProduct: vi.fn(async() => ({})),
}

export const utilityProcess = {
  fork: vi.fn(() => ({ on: vi.fn(), postMessage: vi.fn(), kill: vi.fn() })),
}

export class MessageChannelMain {
  port1 = { postMessage: vi.fn(), on: vi.fn(), start: vi.fn(), close: vi.fn() }
  port2 = { postMessage: vi.fn(), on: vi.fn(), start: vi.fn(), close: vi.fn() }
}

export const webFrame = {
  setZoomFactor: vi.fn(),
  getZoomFactor: vi.fn(() => 1),
  setVisualZoomLevelLimits: vi.fn(async() => undefined),
  insertCSS: vi.fn(async() => ''),
}

// ---------------------------------------------------------------------------
// session（app.getPath 之外的另一个「会写盘」面）
// ---------------------------------------------------------------------------

function createSession(partition: string) {
  return {
    partition,
    cookies: {
      get: vi.fn(async() => []),
      set: vi.fn(async() => undefined),
      remove: vi.fn(async() => undefined),
      flushStore: vi.fn(async() => undefined),
    },
    webRequest: {
      onBeforeRequest: vi.fn(),
      onBeforeSendHeaders: vi.fn(),
      onHeadersReceived: vi.fn(),
    },
    clearCache: vi.fn(async() => undefined),
    clearStorageData: vi.fn(async() => undefined),
    setProxy: vi.fn(async() => undefined),
    resolveProxy: vi.fn(async() => 'DIRECT'),
    loadExtension: vi.fn(async() => ({ id: 'test-extension' })),
    getAllExtensions: vi.fn(() => []),
  }
}

export const session = {
  defaultSession: createSession(''),
  fromPartition: vi.fn((partition: string) => createSession(partition)),
  fromPath: vi.fn((p: string) => createSession(p)),
}

export default {
  app,
  ipcMain,
  ipcRenderer,
  webContents,
  BrowserWindow,
  dialog,
  shell,
  clipboard,
  nativeImage,
  nativeTheme,
  screen,
  Menu,
  Tray,
  Notification,
  globalShortcut,
  powerSaveBlocker,
  powerMonitor,
  protocol,
  net,
  contextBridge,
  crashReporter,
  desktopCapturer,
  systemPreferences,
  inAppPurchase,
  utilityProcess,
  MessageChannelMain,
  webFrame,
  session,
}
