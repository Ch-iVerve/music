// import './app_setting'

declare namespace LX {
  interface CmdParams {
    /**
     * 搜索，启动软件时自动在搜索框搜索指定的内容，例如：-search="突然的自我 - 伍佰"
     */
    search?: string

    /**
     * 禁用硬件加速启动
     */
    dha?: boolean

    /**
     * 以非透明模式启动
     */
    dt?: boolean

    /**
     * 禁用硬件媒体密钥处理
     */
    dhmkh?: boolean

    /**
     * 设置代理服务器，代理应用的所有流量，例：-proxy-server="127.0.0.1:1081"（不支持设置账号密码，v1.17.0起新增）。注：应用内“设置-网络-代理设置”仅代理接口请求的流量，优先级更高
     */
    'proxy-server'?: string

    /**
     * 以分号分隔的主机列表绕过代理服务器，例：-proxy-bypass-list="<local>;*.google.com;*foo.com;1.2.3.4:5678"（与-proxy-server一起使用才有效，v1.17.0起新增）。注：此设置对应用内接口请求无效
     */
    'proxy-bypass-list'?: string

    /**
     * 启动时播放指定列表的音乐
     */
    play?: string

    /**
     * 启动后最小化到系统托盘
     */
    hidden?: boolean

    [key: string]: boolean | number | string
  }

  /**
   * 本产品的在线音源只有 QQ 音乐一条线。
   *
   * 收敛成单值是有意的：多渠道的**结构**（musicSdk 的源注册表、api-source-info
   * 的 supportQualitys、store 的按源分派）都保留着——将来要加源时按 AGENTS.md
   * 「新增一个在线音源」的清单加即可。类型层面只承认已实现的源，这样任何"假设源
   * 有多个"的代码在编译期就会报出来，不会留成隐藏分支。
   */
  type OnlineSource = 'tx'
  type Source = OnlineSource | 'local'
  type Quality = '128k' | '320k' | 'flac' | 'flac24bit' | '192k' | 'ape' | 'wav'

  type QualityList = Partial<Record<LX.Source, LX.Quality[]>>

  interface EnvParams {
    deeplink?: string | null
    cmdParams: CmdParams
    workAreaSize?: Electron.Size
    /** 本地媒体库的托管目录（`<userData>/media/`，主进程惰性创建；渲染侧不自行拼接 userData） */
    mediaDir: string
  }

  interface HotKey {
    name: string
    action: string
    type: keyof typeof keyName
  }

  interface HotKeyDownInfo {
    type: 'local' | 'global'
    key: string
  }

  interface HotKeyConfig {
    enable: boolean
    keys: Record<string, HotKey>
  }
  interface HotKeyConfigAll {
    local: HotKeyConfig
    global: HotKeyConfig
  }
  interface RegisterKeyInfo {
    key: string
    info: HotKey
  }
  type HotKeyState = Map<string, {
    status: boolean
    info: HotKey
  }>
  interface HotKeyActionWrap<T, D> {
    action: T
    data: D
    source?: string
  }
  type HotKeyActions = HotKeyActionWrap<'config', HotKeyConfigAll>
  | HotKeyActionWrap<'enable', boolean>
  | HotKeyActionWrap<'register', RegisterKeyInfo>
  | HotKeyActionWrap<'unregister', string>

  interface HotKeyEvent {
    type: string
    key: string
  }

  interface TaskBarButtonFlags {
    empty: boolean
    collect: boolean
    play: boolean
    next: boolean
    prev: boolean
  }
}
