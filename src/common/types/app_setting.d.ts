import type { I18n } from '../../lang/i18n'

declare global {

  declare namespace LX {
    type AddMusicLocationType = 'top' | 'bottom'

    interface AppSetting {
      version: string

      /**
       * 窗口大小id
       */
      'common.windowSizeId': number

      /**
       * 窗口大小id
       */
      'common.fontSize': number

      /**
       * 是否以全屏启动
       */
      'common.startInFullscreen': boolean

      /**
       * 语言id
       */
      'common.langId': I18n['locale'] | null

      /**
       * api id
       */
      'common.apiSource': string

      /**
       * 音源名称类型，原名、别名
       */
      'common.sourceNameType': 'alias' | 'real'

      /**
       * 显示的字体
       */
      'common.font': string

      /**
       * 是否启用动画
       */
      'common.isShowAnimation': boolean

      /**
       * 是否启用随机弹窗动画
       */
      'common.randomAnimate': boolean

      /**
       * 是否同意软件协议
       */
      'common.isAgreePact': boolean

      /**
       * 控制按钮位置，左边、右边
       */
      'common.controlBtnPosition': 'left' | 'right'

      /**
       * 播放栏进度条样式
       */
      'common.playBarProgressStyle': 'mini' | 'full' | 'middle'

      /**
       * 启用透明窗口
       */
      'common.transparentWindow': boolean

      /**
       * 启动时自动播放歌曲
       */
      'player.startupAutoPlay': boolean

      /**
       * 切歌模式
       */
      'player.togglePlayMethod': 'listLoop' | 'random' | 'list' | 'singleLoop' | 'none'

      /**
       * 优先播放的音质
       */
      'player.playQuality': LX.Quality

      /**
       * 是否显示任务栏进度条
       */
      'player.isShowTaskProgess': boolean


      /**
       * 是否将歌词显示在状态栏
       */
      'player.isShowStatusBarLyric': boolean

      /**
       * 音量大小
       */
      'player.volume': number

      /**
       * 播放歌曲时是否阻止电脑休眠
       */
      'player.powerSaveBlocker': boolean

      /**
       * 是否静音
       */
      'player.isMute': boolean

      /**
       * 播放速率
       */
      'player.playbackRate': number

      /**
       * 是否自动调整音频的音高以补偿对播放速率设置所做的更改
       */
      'player.preservesPitch': boolean

      /**
       * 使用设备能处理的最大声道数输出音频
       */
      'player.isMaxOutputChannelCount': boolean

      /**
       * 音频输出设备id
       */
      'player.mediaDeviceId': string

      /**
       * 是否在音频输出设备更改时暂停播放
       */
      'player.isMediaDeviceRemovedStopPlay': boolean

      /**
       * 是否显示歌词翻译
       */
      'player.isShowLyricTranslation': boolean

      /**
       * 是否显示歌词罗马音
       */
      'player.isShowLyricRoma': boolean

      /**
       * 是否调换翻译歌词与罗马音歌词位置
       */
      'player.isSwapLyricTranslationAndRoma': boolean

      /**
       * 是否将歌词从简体转换为繁体
       */
      'player.isS2t': boolean

      /**
       * 是否播放卡拉OK歌词
       */
      'player.isPlayLxlrc': boolean

      /**
       * 启动软件时是否恢复上次播放进度
       */
      'player.isSavePlayTime': boolean

      /**
       * 是否启用音频可视化
       */
      'player.audioVisualization': boolean

      /**
       * 定时暂停播放-是否等待歌曲播放完毕再暂停
       */
      'player.waitPlayEndStop': boolean

      /**
       * 定时暂停播放-倒计时时间（分钟）
       *
       * 空串 = 未设置（不自动停播）；设置页与弹窗写入的都是数字（`Number(...)` 的结果）。
       * 2026-09-26 自审查修正：原声明为 `string`，与运行期真值（`'' | number`）漂移，
       * 而写入点都在纯 JS 的 `.vue` 里，tsc 抓不到。
       */
      'player.waitPlayEndStopTime': number | ''

      /**
       * 环境音效文件名
       */
      'player.soundEffect.convolution.fileName': string | null

      /**
       * 环境音效原始输出增益
       */
      'player.soundEffect.convolution.mainGain': number

      /**
       * 环境音效输出增益
       */
      'player.soundEffect.convolution.sendGain': number

      /**
       * 均衡器 31hz 值
       */
      'player.soundEffect.biquadFilter.hz31': number

      /**
       * 均衡器 62hz 值
       */
      'player.soundEffect.biquadFilter.hz62': number

      /**
       * 均衡器 125hz 值
       */
      'player.soundEffect.biquadFilter.hz125': number

      /**
       * 均衡器 250hz 值
       */
      'player.soundEffect.biquadFilter.hz250': number

      /**
       * 均衡器 500hz 值
       */
      'player.soundEffect.biquadFilter.hz500': number

      /**
       * 均衡器 1000hz 值
       */
      'player.soundEffect.biquadFilter.hz1000': number

      /**
       * 均衡器 2000hz 值
       */
      'player.soundEffect.biquadFilter.hz2000': number

      /**
       * 均衡器 4000hz 值
       */
      'player.soundEffect.biquadFilter.hz4000': number

      /**
       * 均衡器 8000hz 值
       */
      'player.soundEffect.biquadFilter.hz8000': number

      /**
       * 均衡器 16000hz 值
       */
      'player.soundEffect.biquadFilter.hz16000': number

      /**
       * 3D立体环绕是否启用
       */
      'player.soundEffect.panner.enable': boolean

      /**
       * 3D立体环绕声音距离
       */
      'player.soundEffect.panner.soundR': number

      /**
       * 3D立体环绕速度
       */
      'player.soundEffect.panner.speed': number

      /**
       * 升降声调
       */
      'player.soundEffect.pitchShifter.playbackRate': number

      /**
       * 是否启用音频加载失败时自动切歌
       */
      'player.autoSkipOnError': boolean

      /**
       * 点击相同列表内的歌曲切歌时是否清空已播放列表（随机模式下列表内所有歌曲会重新参与随机）
       */
      'player.isAutoCleanPlayedList': boolean

      /**
       * 出链失败重试间隔（秒）：加载中每过这么久刷新一次 URL（第二次仍失败才按失败策略处理）
       */
      'player.retryUrlDelay': number

      /**
       * 同源刷新 URL 的次数上限（次）：策略 retry 下是刷新次数，degrade 下是允许降的档数
       */
      'player.retryUrlMaxNum': number

      /**
       * 失败（出链失败 / 取流失败）后自动下一首的延迟（秒）
       */
      'player.errorSkipDelay': number

      /**
       * 取流等待上限（秒）：超过则视为取流失败，刷新 URL 或切歌
       */
      'player.getUrlTimeout': number

      /**
       * 卡顿（buffering）判定阈值（秒）：卡住这么久才开始往前跳
       */
      'player.stallSkipThreshold': number

      /**
       * 卡顿跳转步长下限（秒）
       */
      'player.stallSkipMin': number

      /**
       * 卡顿跳转步长上限（秒）
       */
      'player.stallSkipMax': number

      /**
       * 快进/快退快捷键的步长（秒）
       */
      'player.skipStepSeconds': number

      /**
       * 音量快捷键的步进，单位 %（4 = 0.04）
       */
      'player.volumeStep': number

      /**
       * 取流失败策略：retry（同源刷新 URL，上限 `retryUrlMaxNum`）/ degrade（沿档位阶梯降档重取）/
       * error（不重试，直接按 `errorSkipDelay` 提示或跳过）
       */
      'player.onUrlFailStrategy': 'retry' | 'degrade' | 'error'

      /**
       * 主源（QQ）取不到流、或取了流也播不成时，静默用网易云的同一首歌顶替
       * （实现见 `renderer/core/music/wyFallback`）。默认开。
       */
      'player.wyFallback': boolean

      /**
       * 播放详情页-是否缩放当前播放的歌词行
       */
      'playDetail.isZoomActiveLrc': boolean

      /**
       * 播放详情页-是否允许通过歌词调整播放进度
       */
      'playDetail.isShowLyricProgressSetting': boolean

      /**
       * 播放详情页-歌词字体大小
       */
      'playDetail.style.fontSize': number

      /**
       * 播放详情页-歌词对齐方式
       */
      'playDetail.style.align': 'center' | 'left' | 'right'

      /**
       * 播放详情页-是否延迟桌面歌词滚动
       */
      'playDetail.isDelayScroll': boolean

      /**
       * 本地歌（`source == 'local'`）取歌词的来源优先级：
       * localFirst = 先「歌词缓存 + 同目录 .lrc 文件」，都没有才请求在线歌词（默认，改造前行为）；
       * onlineFirst = 反过来。任一侧拿不到都会回落到另一侧（断网 / 未登录时本地 `.lrc` 照样出词）。
       * 在线歌曲没有本地歌词可查，不看这个值。取值与默认值见 `common/settings/lyricSource.ts`
       */
      'lyric.sourcePriority': 'localFirst' | 'onlineFirst'


      /**
       * 是否启用桌面歌词
       */
      'desktopLyric.enable': boolean

      /**
       * 是否锁定桌面歌词
       */
      'desktopLyric.isLock': boolean

      /**
       * 是在置顶桌面
       */
      'desktopLyric.isAlwaysOnTop': boolean

      /**
       * 是否自动刷新歌词置顶
       */
      'desktopLyric.isAlwaysOnTopLoop': boolean

      /**
       * 是否将歌词进程显示在任务栏
       */
      'desktopLyric.isShowTaskbar': boolean

      /**
       * 是否启用音频可视化
       */
      'desktopLyric.audioVisualization': boolean

      /**
       * 是否在全屏时隐藏歌词
       */
      'desktopLyric.fullscreenHide': boolean

      /**
       * 是否在暂停时隐藏歌词
       */
      'desktopLyric.pauseHide': boolean

      /**
       * 桌面歌词窗口宽度
       */
      'desktopLyric.width': number

      /**
       * 桌面歌词窗口高度
       */
      'desktopLyric.height': number

      /**
       * 桌面歌词窗口x坐标
       */
      'desktopLyric.x': number | null

      /**
       * 桌面歌词窗口y坐标
       */
      'desktopLyric.y': number | null

      /**
       * 是否允许桌面歌词窗口拖出主屏幕之外
       */
      'desktopLyric.isLockScreen': boolean

      /**
       * 是否延迟桌面歌词滚动
       */
      'desktopLyric.isDelayScroll': boolean

      /**
       * 歌词滚动位置
       */
      'desktopLyric.scrollAlign': 'top' | 'center'

      /**
       * 是否在鼠标划过桌面歌词窗口时降低歌词透明度
       */
      'desktopLyric.isHoverHide': boolean

      /**
       * 歌词方向
       */
      'desktopLyric.direction': 'horizontal' | 'vertical'

      /**
       * 歌词对齐方式
       */
      'desktopLyric.style.align': 'center' | 'left' | 'right'

      /**
       * 桌面歌词字体
       */
      'desktopLyric.style.font': string

      /**
       * 桌面歌词字体大小
       */
      'desktopLyric.style.fontSize': number

      /**
       * 歌词间距大小
       */
      'desktopLyric.style.lineGap': number

      /**
       * 桌面歌词字体透明度
       */
      'desktopLyric.style.opacity': number

      /**
       * 桌面歌词是否允许换行
       */
      'desktopLyric.style.ellipsis': boolean

      /**
       * 是否缩放当前正在播放的桌面歌词
       */
      'desktopLyric.style.isZoomActiveLrc': boolean

      /**
       * 是否加粗逐字歌词字体
       */
      'desktopLyric.style.isFontWeightFont': boolean

      /**
       * 是否加粗逐行歌词字体
       */
      'desktopLyric.style.isFontWeightLine': boolean

      /**
       * 是否加粗翻译、罗马音字体
       */
      'desktopLyric.style.isFontWeightExtended': boolean

      /**
       * 是否启用双击列表里的歌曲时自动切换到当前列表播放（仅对歌单、排行榜有效）
       */
      'list.isClickPlayList': boolean

      /**
       * 是否显示歌曲来源（仅对我的列表有效）
       */
      'list.isShowSource': boolean

      /**
       * 是否自动恢复列表滚动位置（仅对我的列表有效）
       */
      'list.isSaveScrollLocation': boolean

      /**
       * 添加歌曲到我的列表时的方式
       */
      'list.addMusicLocationType': LX.AddMusicLocationType

      /**
       * 是否显示列表操作按钮列
       */
      'list.actionButtonsVisible': boolean

      /**
       * 列表每页条数（设置页给 10 / 20 / 30 / 50 / 100 五档，默认 30）。
       * renderer 侧唯一取值口是 `common/settings/pageSize.ts` 的 `getPageSize()`。
       * 改完不强制刷新已加载的列表，下次进页 / 翻页 / 加载更多时生效。
       * ⚠️ 发现页「推荐歌单」固定 9 条（卡片 3×3 与面板固定高度配平），不受它影响
       */
      'list.pageSize': number

      /**
       * 最大并发下载数
       */
      'download.maxDownloadNum': number

      /**
       * 请求的档位在当前音源不支持时是否静默降档（false = 跳过该歌并提示）
       */
      'download.degradeWhenUnsupported': boolean

      /**
       * URL 缓存（`music_url` 表，保存在线取流拿到的「歌曲id_音质 → URL」）的保留天数，
       * 单位：天。`0` = 不按时间回收（默认）。
       *
       * 消费点：`main/utils/index.ts` 的 `recycleMusicUrlCache`（每次启动回收一次）与设置页的
       * 「立即回收」按钮。判过期按行的**写入时间**（每次取流成功会重写这行、刷新时间）。
       * 老库迁移上来的行 `created_at` 是 0，按「最旧」处理（先被回收）。
       */
      'cache.musicUrlKeepDays': number

      /**
       * URL 缓存的容量上限，单位：MB。`0` = 不按容量回收（默认）。
       *
       * 占用判定用 `LENGTH(id) + LENGTH(url)` 近似（乐观估计，不含 SQLite 的页 / 索引开销），
       * 超出时从最旧的行开始删到上限内。
       */
      'cache.maxSizeMB': number

      /**
       * 主题id
       */
      'theme.id': string

      /**
       * 亮色主题id
       */
      'theme.lightId': string

      /**
       * 暗色主题id
       */
      'theme.darkId': string

      /**
       * 是否显示热门搜索
       */
      'search.isShowHotSearch': boolean

      /**
       * 是否显示搜索历史
       */
      'search.isShowHistorySearch': boolean

      /**
       * 搜索历史最多保留几条（默认 15，设置页量程 0–100）：**0 = 不记历史**（已有的历史不动，只是
       * 不再往进记）。上面的 `isShowHistorySearch` 是总闸，这里是条数闸；裁剪与取值见
       * `common/settings/searchHistory.ts`
       */
      'search.historyMaxNum': number

      /**
       * 软件启动时是否自动聚焦搜索框
       */
      'search.isFocusSearchBox': boolean

      /**
       * 是否启用代理
       */
      'network.proxy.enable': boolean

      /**
       * 代理服务器地址
       */
      'network.proxy.host': string

      /**
       * 代理服务器端口号
       */
      'network.proxy.port': string

      /**
       * 是否启用托盘
       */
      'tray.enable': boolean

      /**
       * 是否关闭时是否最小化到托盘
       */
      // 'tray.isToTray': boolean

      /**
       * 托盘主题id
       */
      'tray.themeId': number

      /**
       * 同步服务模式
       */
      'sync.mode': 'server' | 'client'

      /**
       * 是否启用同步服务
       */
      'sync.enable': boolean

      /**
       * 同步服务端口号
       */
      'sync.server.port': '23332' | string

      /**
       * 最大备份快照数
       */
      'sync.server.maxSsnapshotNum': number
      /**
       * 同步服务地址
       */
      'sync.client.host': string


      /**
       * 是否启用开放API服务
       */
      'openAPI.enable': boolean

      /**
       * API服务端口号
       */
      'openAPI.port': '23330' | string

      /**
       * 是否绑定到局域网
       */
      'openAPI.bindLan': boolean

      /**
       * 是否在离开搜索界面时自动清空搜索框
       */
      'odc.isAutoClearSearchInput': boolean

      /**
       * 是否在离开搜索界面时自动清空搜索结果列表
       */
      'odc.isAutoClearSearchList': boolean
    }
  }

}
