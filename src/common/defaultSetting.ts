const isMac = process.platform == 'darwin'
const isWin = process.platform == 'win32'

/**
 * 设置的**唯一默认值来源**：主窗（`renderer/store/setting.ts`）与歌词窗
 * （`renderer-lyric/store/state.ts`，按 `LX.DesktopLyric.Config` 挑子集）都从这里取值。
 * **别在别处再写第二份默认值**——两份会漂移，而漂移只在「真值下发之前」可见（歌词窗首帧），
 * 人眼很难发现：歌词窗那份曾漂了 9 处（设置页重构票 12）。
 * 这里的改动会同时改「设置页显示的默认值」与「歌词窗首帧样式」；用户已存的配置文件不受影响。
 */
const defaultSetting: LX.AppSetting = {
  // 2.2.0 = 下载命名由三选一枚举改成模板串（`download.fileName` → `download.fileNameTemplate`），
  // 迁移在 migrateSetting.ts 末尾；老配置加载时按这个版本号判断要不要搬
  version: '2.2.0',

  'common.windowSizeId': 3,
  'common.fontSize': 16,
  'common.startInFullscreen': false,
  'common.langId': null,
  // 内置 QQ 音乐取流（api-source-info 的 id）。上游默认的 'temp' 是个没有实现的占位，
  // 留着它整条在线取流会失效（qualityList 为空 → 搜得到点不动）
  'common.apiSource': 'builtin',
  'common.sourceNameType': 'alias',
  'common.font': '',
  'common.isShowAnimation': true,
  'common.randomAnimate': true,
  'common.isAgreePact': false,
  'common.controlBtnPosition': isMac ? 'left' : 'right',
  'common.playBarProgressStyle': 'mini',
  'common.transparentWindow': !isMac,

  'player.startupAutoPlay': false,
  'player.togglePlayMethod': 'listLoop',
  'player.playQuality': '128k',
  'player.isShowTaskProgess': true,
  'player.isShowStatusBarLyric': false,
  'player.volume': 1,
  'player.powerSaveBlocker': true,
  'player.isMute': false,
  'player.playbackRate': 1,
  'player.preservesPitch': true,
  'player.isMaxOutputChannelCount': false,
  'player.mediaDeviceId': 'default',
  'player.isMediaDeviceRemovedStopPlay': false,
  'player.isShowLyricTranslation': false,
  'player.isShowLyricRoma': false,
  'player.isSwapLyricTranslationAndRoma': false,
  'player.isS2t': false,
  'player.isPlayLxlrc': !isMac,
  'player.isSavePlayTime': false,
  'player.audioVisualization': false,
  'player.waitPlayEndStop': true,
  'player.waitPlayEndStopTime': '',
  'player.autoSkipOnError': true,
  'player.isAutoCleanPlayedList': false,
  // 播放稳定性阈值（设置页「播放 → 播放稳定性」，票 06）：默认值 = 各自消费点原来的硬编码常量，
  // 所以老配置升级上来行为不变。时长类单位一律「秒」，设置页负责夹取（1–600 / 步进 1–20%）。
  'player.retryUrlDelay': 25, // 出链失败重试间隔（usePlayEvent 的加载超时）
  'player.retryUrlMaxNum': 2, // 同源刷新 URL 的次数上限（策略 retry / degrade 共用）
  'player.errorSkipDelay': 5, // 失败（或取流失败）后自动下一首的延迟
  'player.getUrlTimeout': 100, // 取流等待上限，超时即刷新 URL / 切歌
  'player.stallSkipThreshold': 3, // 卡顿判定阈值：卡住这么久才开始往前跳
  'player.stallSkipMin': 3, // 卡顿跳转步长下限（与 Max 组成随机区间）
  'player.stallSkipMax': 6, // 卡顿跳转步长上限
  'player.skipStepSeconds': 5, // 快进/快退快捷键的固定步长
  'player.volumeStep': 4, // 音量快捷键的步进，单位「%」（4 = 0.04）
  'player.onUrlFailStrategy': 'retry', // 取流失败策略：retry（默认，= 老行为）/ degrade / error
  // 主源取不到流时静默用网易云同曲顶替（renderer/core/music/wyFallback）。默认开：这是对「本来要
  // 跳过的歌」的补救，关掉即回到「取流失败就提示 / 跳过」的老行为
  'player.wyFallback': true,
  'player.soundEffect.convolution.fileName': '',
  'player.soundEffect.convolution.mainGain': 10,
  'player.soundEffect.convolution.sendGain': 0,
  'player.soundEffect.biquadFilter.hz31': 0,
  'player.soundEffect.biquadFilter.hz62': 0,
  'player.soundEffect.biquadFilter.hz125': 0,
  'player.soundEffect.biquadFilter.hz250': 0,
  'player.soundEffect.biquadFilter.hz500': 0,
  'player.soundEffect.biquadFilter.hz1000': 0,
  'player.soundEffect.biquadFilter.hz2000': 0,
  'player.soundEffect.biquadFilter.hz4000': 0,
  'player.soundEffect.biquadFilter.hz8000': 0,
  'player.soundEffect.biquadFilter.hz16000': 0,
  'player.soundEffect.panner.enable': false,
  'player.soundEffect.panner.soundR': 5,
  'player.soundEffect.panner.speed': 25,
  'player.soundEffect.pitchShifter.playbackRate': 1,

  'playDetail.isZoomActiveLrc': false,
  'playDetail.isShowLyricProgressSetting': false,
  'playDetail.style.fontSize': 140,
  'playDetail.style.align': 'center',
  'playDetail.isDelayScroll': true,
  // 本地歌取歌词的来源优先级（票 09）：localFirst = 改造前的行为（先「歌词缓存 + 同目录 .lrc」，
  // 都没有才请求在线歌词）。一侧拿不到一律回落到另一侧，见 core/music/local.ts 的文件头
  'lyric.sourcePriority': 'localFirst',

  'desktopLyric.enable': false,
  'desktopLyric.isLock': false,
  'desktopLyric.isAlwaysOnTop': false,
  'desktopLyric.isAlwaysOnTopLoop': false,
  'desktopLyric.isShowTaskbar': false,
  'desktopLyric.audioVisualization': false,
  'desktopLyric.fullscreenHide': true,
  'desktopLyric.pauseHide': true,
  'desktopLyric.width': 450,
  'desktopLyric.height': 300,
  'desktopLyric.x': null,
  'desktopLyric.y': null,
  'desktopLyric.isLockScreen': isWin,
  'desktopLyric.isDelayScroll': true,
  'desktopLyric.scrollAlign': 'center',
  'desktopLyric.isHoverHide': false,
  'desktopLyric.direction': 'horizontal',
  'desktopLyric.style.align': 'center',
  'desktopLyric.style.font': '',
  'desktopLyric.style.fontSize': 20,
  'desktopLyric.style.lineGap': 15,
  // 歌词未播/已播/阴影色不是设置项：只由主题派生，见 renderer-lyric/utils/lyricColors.ts（ADR-0007）
  'desktopLyric.style.opacity': 95,
  'desktopLyric.style.ellipsis': false,
  'desktopLyric.style.isZoomActiveLrc': false,
  'desktopLyric.style.isFontWeightFont': true,
  'desktopLyric.style.isFontWeightLine': true,
  'desktopLyric.style.isFontWeightExtended': true,

  'list.isClickPlayList': false,
  'list.isShowSource': true,
  'list.isSaveScrollLocation': true,
  'list.addMusicLocationType': 'top',
  'list.actionButtonsVisible': false,
  // 列表每页条数（票 09）：renderer 侧唯一取值口是 common/settings/pageSize.ts 的 getPageSize()，
  // 默认 30 = 改造前大多数列表的值。发现页「推荐歌单」固定 9 条（3×3 网格配平），不跟它走
  'list.pageSize': 30,

  'download.maxDownloadNum': 3,
  // 请求的档位在当前音源不支持、或这首歌没有该档资源时：true = 按现有逻辑静默降档，
  // false = 不创建任务并提示用户。默认 true = 改造前行为（消费点 `worker/download/utils.ts` 的 getMusicType）
  'download.degradeWhenUnsupported': true,

  // URL 缓存（`music_url` 表：在线取流时写的一行「歌曲id_音质 → URL」）的回收策略，
  // 设置页入口在「数据与存储 → 缓存回收策略」（票 08）。
  // 消费点两处：①启动时主进程 `main/utils/index.ts` 的 `recycleMusicUrlCache` 回收一次；
  // ②设置页「立即回收」按钮随时回收一次（见 ipc 的 `recycle_music_url`）。
  // **0 = 不自动清 / 不限**：两个都是 0（默认）时回收直接返回、连库都不读——缓存只增不减，
  // 行为与加这两个 key 之前完全一致。
  'cache.musicUrlKeepDays': 0, // 保留天数（0 = 不按时间回收）
  'cache.maxSizeMB': 0, // 容量上限 MB（0 = 不按容量回收）

  'search.isShowHotSearch': false,
  'search.isShowHistorySearch': false,
  'search.isFocusSearchBox': false,
  // 搜索历史最多留几条（票 09）：0 = 不记历史（已有的历史不动）。总闸是上面的 isShowHistorySearch，
  // 这里是条数闸；裁剪语义与量程见 common/settings/searchHistory.ts
  'search.historyMaxNum': 15,

  'network.proxy.enable': false,
  'network.proxy.host': '',
  'network.proxy.port': '',

  'tray.enable': false,
  // 'tray.isToTray': false,
  'tray.themeId': 0,

  'sync.mode': 'server',
  'sync.enable': false,
  'sync.server.port': '23332',
  'sync.server.maxSsnapshotNum': 5,
  'sync.client.host': '',

  'openAPI.enable': false,
  'openAPI.port': '23330',
  'openAPI.bindLan': false,

  // 'theme.id': 'blue_plus',
  'theme.id': 'green',
  'theme.lightId': 'green',
  'theme.darkId': 'black',

  'odc.isAutoClearSearchInput': false,
  'odc.isAutoClearSearchList': false,

}


// 使用新年皮肤
if (new Date().getMonth() < 2) {
  defaultSetting['theme.id'] = 'happy_new_year'
}


export default defaultSetting

