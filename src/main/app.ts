import path from 'node:path'
import { renameSync } from 'fs'
import { app, shell, screen, nativeTheme, dialog } from 'electron'
import { URL_SCHEME_RXP } from '@common/constants'
import { getProxy, getTheme, initHotKey, initSetting, parseEnvParams, recycleMusicUrlCache } from './utils'
import { navigationUrlWhiteList } from '@common/config'
import defaultSetting from '@common/defaultSetting'
import { isExistWindow as isExistMainWindow, showWindow as showMainWindow } from './modules/winMain'
import { createAppEvent, createDislikeEvent, createListEvent } from '@main/event'
import { isMac, log } from '@common/utils'
import createWorkers from './worker'
import { migrateDBData } from './utils/migrate'
import { resolveMediaDir } from './utils/mediaDir'
import { cleanupLegacyCoverTemp } from './utils/legacyTempCleanup'
import { openDirInExplorer } from '@common/utils/electron'
import { setProxyByHost } from '@common/utils/request'

export const initGlobalData = () => {
  const envParams = parseEnvParams()
  // envParams.cmdParams.dt = !!envParams.cmdParams.dt
  cleanupLegacyCoverTemp()

  global.envParams = {
    cmdParams: envParams.cmdParams,
    deeplink: envParams.deeplink,
    // 本地媒体库托管目录（票 01）：只算路径不建目录（惰性创建见 mediaDir.ts）；
    // 路径只在主进程拼装，渲染侧经 get_env_params 读取，写文件前由管线调 ensureMediaDir()
    mediaDir: resolveMediaDir(),
  }
  global.lx = {
    inited: false,
    isSkipTrayQuit: false,
    // mainWindowClosed: true,
    event_app: createAppEvent(),
    event_list: createListEvent(),
    event_dislike: createDislikeEvent(),
    appSetting: defaultSetting,
    worker: createWorkers(),
    hotKey: {
      enable: true,
      config: {
        local: {
          enable: false,
          keys: {},
        },
        global: {
          enable: false,
          keys: {},
        },
      },
      state: new Map(),
    },
    theme: {
      shouldUseDarkColors: nativeTheme.shouldUseDarkColors,
      theme: {
        id: '',
        name: '',
        isDark: false,
        colors: {},
      },
    },
    player_status: {
      status: 'stoped',
      name: '',
      singer: '',
      albumName: '',
      picUrl: '',
      progress: 0,
      duration: 0,
      playbackRate: 1,
      lyricLineText: '',
      lyricLineAllText: '',
      lyric: '',
      tlyric: '',
      rlyric: '',
      lxlyric: '',
      collect: false,
      volume: 0,
      mute: false,
    },
  }

  global.staticPath =
    process.env.NODE_ENV !== 'production'
      ? webpackStaticPath
      : path.join(__dirname, 'static')
}

export const initSingleInstanceHandle = () => {
  // 单例应用程序
  if (!app.requestSingleInstanceLock()) {
    app.quit()
    process.exit(0)
  }

  app.on('second-instance', (event, argv, cwd) => {
    if (isExistMainWindow()) {
      const envParams = parseEnvParams(argv)
      if (envParams.deeplink) {
        global.envParams.deeplink = envParams.deeplink
        global.lx.event_app.deeplink(global.envParams.deeplink)
        return
      }
      if (envParams.cmdParams.hidden !== true) {
        showMainWindow()
      }
    } else {
      app.quit()
    }
  })
}

export const applyElectronEnvParams = () => {
  // Is disable hardware acceleration
  if (global.envParams.cmdParams.dha) app.disableHardwareAcceleration()
  if (global.envParams.cmdParams.dhmkh) app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling')

  // 这里曾有 `if (process.platform == 'linux') app.commandLine.appendSwitch('use-gl', 'desktop')`
  // —— 上游为「Linux 透明窗口失效」加的 workaround（electron/electron#25153 的评论，Electron 13 时代）。
  // **Electron 42 已不接受这个值**：GPU 进程会以 `use-gl=disabled` 启动、整机退化成软件合成，
  // 后果是弹窗与动画明显掉帧（本机实测：弹窗开关 13/5 掉帧、~870ms CPU/轮；去掉后 0 掉帧、16.8ms）。
  // 2026-09-24 移除，并真机确认透明窗口（桌面歌词窗）仍正常。若将来透明窗口再出问题，
  // 别直接把这行加回来——先看上游 issue 是否已有新结论（那样做等于用全机软件合成换一个窗口）。

  // https://github.com/electron/electron/issues/22691
  app.commandLine.appendSwitch('wm-window-animations-disabled')

  app.commandLine.appendSwitch('--disable-gpu-sandbox')

  // proxy
  if (global.envParams.cmdParams['proxy-server']) {
    app.commandLine.appendSwitch('proxy-server', global.envParams.cmdParams['proxy-server'])
    app.commandLine.appendSwitch('proxy-bypass-list', global.envParams.cmdParams['proxy-bypass-list'] ?? '<local>')
  }
}

export const registerDeeplink = (startApp: () => void) => {
  if (process.env.NODE_ENV !== 'production' && process.platform === 'win32') {
    // Set the path of electron.exe and your app.
    // These two additional parameters are only available on windows.
    // console.log(process.execPath, process.argv)
    app.setAsDefaultProtocolClient('chiverve-music', process.execPath, process.argv.slice(1))
  } else {
    app.setAsDefaultProtocolClient('chiverve-music')
  }

  // deep link
  app.on('open-url', (event, url) => {
    if (!URL_SCHEME_RXP.test(url)) return
    event.preventDefault()
    global.envParams.deeplink = url
    if (isExistMainWindow()) {
      if (global.envParams.deeplink) global.lx.event_app.deeplink(global.envParams.deeplink)
      else showMainWindow()
    } else {
      startApp()
    }
  })
}

export const listenerAppEvent = (startApp: () => void) => {
  app.on('web-contents-created', (event, contents) => {
    contents.on('will-navigate', (event, navigationUrl) => {
      if (process.env.NODE_ENV !== 'production') {
        console.log('navigation to url:', navigationUrl.length > 130 ? navigationUrl.substring(0, 130) + '...' : navigationUrl)
        return
      }
      if (!navigationUrlWhiteList.some(url => url.test(navigationUrl))) {
        event.preventDefault()
        return
      }
      console.log('navigation to url:', navigationUrl)
    })
    contents.setWindowOpenHandler(({ url }) => {
      if (!/^devtools/.test(url) && /^https?:\/\//.test(url)) {
        void shell.openExternal(url)
      }
      console.log(url)
      return { action: 'deny' }
    })
    contents.on('will-attach-webview', (event, webPreferences, params) => {
      // Strip away preload scripts if unused or verify their location is legitimate
      delete webPreferences.preload
      // delete webPreferences.preloadURL

      // Disable Node.js integration
      webPreferences.nodeIntegration = false

      // Verify URL being loaded
      if (!navigationUrlWhiteList.some(url => url.test(params.src))) {
        event.preventDefault()
      }
    })

    // disable create dictionary
    // https://github.com/lyswhut/lx-music-desktop/issues/773
    contents.session.setSpellCheckerDictionaryDownloadURL('http://0.0.0.0')
  })

  app.on('activate', () => {
    if (isExistMainWindow()) {
      showMainWindow()
    } else {
      startApp()
    }
  })

  app.on('before-quit', () => {
    global.lx.isSkipTrayQuit = true
  })
  app.on('window-all-closed', () => {
    if (isMac) return

    app.quit()
  })

  const initScreenParams = () => {
    global.envParams.workAreaSize = screen.getPrimaryDisplay().workAreaSize
  }
  app.on('ready', () => {
    screen.on('display-metrics-changed', initScreenParams)
    initScreenParams()
  })

  nativeTheme.addListener('updated', () => {
    const shouldUseDarkColors = nativeTheme.shouldUseDarkColors
    if (shouldUseDarkColors == global.lx.theme.shouldUseDarkColors) return
    global.lx.theme.shouldUseDarkColors = shouldUseDarkColors
    global.lx?.event_app.system_theme_change(shouldUseDarkColors)
  })

  const setProxy = () => {
    const proxy = getProxy()
    if (proxy) {
      setProxyByHost(proxy.host, proxy.port ? String(proxy.port) : undefined)
    } else setProxyByHost()
  }
  global.lx.event_app.on('updated_config', (keys, setting) => {
    if (keys.includes('network.proxy.enable') || (global.lx.appSetting['network.proxy.enable'] && keys.some(k => k.includes('network.proxy.')))) {
      setProxy()
    }

    if (keys.includes('player.volume')) {
      global.lx.event_app.player_status({ volume: Math.trunc(setting['player.volume']! * 100) })
    }
    if (keys.includes('player.isMute')) {
      global.lx.event_app.player_status({ mute: setting['player.isMute'] })
    }
  })
  global.lx.event_app.on('app_inited', () => {
    setProxy()
    global.lx.event_app.player_status({ volume: Math.trunc(global.lx.appSetting['player.volume'] * 100) })
    global.lx.event_app.player_status({ mute: global.lx.appSetting['player.isMute'] })
  })
}

const initTheme = () => {
  global.lx.theme = getTheme()
  const themeConfigKeys = ['theme.id', 'theme.lightId', 'theme.darkId']
  global.lx.event_app.on('updated_config', (keys) => {
    let requireUpdate = false
    for (const key of keys) {
      if (themeConfigKeys.includes(key)) {
        requireUpdate = true
        break
      }
    }
    if (requireUpdate) {
      global.lx.theme = getTheme()
      global.lx.event_app.theme_change()
    }
  })
  global.lx.event_app.on('system_theme_change', () => {
    if (global.lx.appSetting['theme.id'] == 'auto') {
      global.lx.theme = getTheme()
      global.lx.event_app.theme_change()
    }
  })
}

const backupDB = (backupPath: string) => {
  const dbPath = path.join(global.lxDataPath, 'lx.data.db')
  try {
    renameSync(dbPath, backupPath)
  } catch {}
  try {
    renameSync(`${dbPath}-wal`, `${backupPath}-wal`)
  } catch {}
  try {
    renameSync(`${dbPath}-shm`, `${backupPath}-shm`)
  } catch {}
  openDirInExplorer(backupPath)
}

let isInitialized = false

/**
 * 初始化数据库；校验失败（`init` 返回 `null`）时走既有恢复口径：弹窗告知 → 旧库改名备份 → 重建空库。
 *
 * **本函数保证不抛出**：它被 `initAppSetting` 调用，而后者跑在 `registerModules()`（建窗口）之前，
 * 一旦 reject，界面永远不会出现（`main/index.ts` 的 `void initAppSetting().then(...)` 没有 catch）。
 * 宁可带着一个降级的库把窗口开起来、把错误写进日志，也不要「点了图标什么都没发生」。
 * （2026-09-26 全历史自审查发现：`db.init` 里的 pragma/migrate 曾在 try/catch 之外，任一处抛错即此后果。）
 */
const initDBWithRecovery = async(): Promise<boolean | null> => {
  try {
    let dbFileExists = await global.lx.worker.dbService.init(global.lxDataPath)
    if (dbFileExists === null) {
      const backupPath = path.join(global.lxDataPath, `lx.data.db.${Date.now()}.bak`)
      dialog.showMessageBoxSync({
        type: 'warning',
        message: 'Database verify failed',
        detail: `数据库表结构校验失败，我们将把有问题的数据库备份到：${backupPath}\n若此问题导致你的数据丢失，你可以尝试从备份文件找回它们。\n\nThe database table structure verification failed, we will back up the problematic database to: ${backupPath}\nIf this problem causes your data to be lost, you can try to retrieve them from the backup file.`,
      })
      backupDB(backupPath)
      dbFileExists = await global.lx.worker.dbService.init(global.lxDataPath)
    }
    return dbFileExists
  } catch (error) {
    log.error('[db] 初始化失败（已跳过，界面仍会打开；数据库相关功能不可用）：', error)
    return null
  }
}

export const initAppSetting = async() => {
  if (!global.lx.inited) {
    const config = await initHotKey()
    global.lx.hotKey.config.local = config.local
    global.lx.hotKey.config.global = config.global
    global.lx.inited = true
  }

  if (!isInitialized) {
    const dbFileExists = await initDBWithRecovery()
    global.lx.appSetting = (await initSetting()).setting
    if (!dbFileExists) await migrateDBData().catch(err => { log.error(err) })
    // URL 缓存回收（设置页重构票 08）：设置与库都就绪之后回收一次。
    // await 是有意的——本函数跑在 `registerModules()`（建窗口）之前，窗口还没出现就收完，
    // 不可能删到「正在播的那条 URL」；两个阈值默认都是 0 时 worker 直接返回、不读库。
    await recycleMusicUrlCache()
    initTheme()
    if (envParams.cmdParams.dt == null) envParams.cmdParams.dt = !global.lx.appSetting['common.transparentWindow']
  }
  // global.lx.theme = getTheme()

  isInitialized ||= true
}

export const quitApp = () => {
  global.lx.isSkipTrayQuit = true
  app.quit()
}
