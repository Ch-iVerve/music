export const URL_SCHEME_RXP = /^chiverve-music:\/\//

export const SPLIT_CHAR = {
  DISLIKE_NAME: '@',
  DISLIKE_NAME_ALIAS: '#',
} as const

export const STORE_NAMES = {
  APP_SETTINGS: 'config_v2',
  DATA: 'data',
  SYNC: 'sync',
  HOTKEY: 'hot_key',
  USER_API: 'user_api',
  LRC_RAW: 'lyrics',
  LRC_EDITED: 'lyrics_edited',
  THEME: 'theme',
  SOUND_EFFECT: 'sound_effect',
  /** QQ 音乐登录凭证（明文 JSON，权限依赖数据目录；见 docs/specs/0001 §2.3） */
  QQ_AUTH: 'qq_auth',
} as const

export const APP_EVENT_NAMES = {
  winMainName: 'win_main',
  winLyricName: 'win_lyric',
  trayName: 'tray',
} as const

export const LIST_IDS = {
  DEFAULT: 'default',
  LOVE: 'love',
  TEMP: 'temp',
  DOWNLOAD: 'download',
  PLAY_LATER: null,
  /** 本地媒体库「全部本地音乐」固定节点（本地媒体库票 03）：不是一张歌单，是库聚合视图的选择器 id */
  LOCAL_LIBRARY: 'local_library',
} as const

export const DATA_KEYS = {
  viewPrevState: 'viewPrevState',
  playInfo: 'playInfo',
  searchHistoryList: 'searchHistoryList',
  listScrollPosition: 'listScrollPosition',
  listPrevSelectId: 'listPrevSelectId',
  listUpdateInfo: 'listUpdateInfo',

  leaderboardSetting: 'leaderboardSetting',
  songListSetting: 'songListSetting',
  searchSetting: 'searchSetting',
} as const

// 在线源只有 tx（见 LX.OnlineSource 的说明）。这些默认值在首次进入对应页面时生效，
// id 取自 tx 自己的清单：榜单见 tx/leaderboard.js 的 boardList（tx__26 = 热歌榜），
// 歌单排序见 tx/songList.js 的 sortList（-1 推荐 / 3 最热 / 2 最新）。
export const DEFAULT_SETTING = {
  leaderboard: {
    source: 'tx',
    boardId: 'tx__26',
  },

  songList: {
    source: 'tx',
    sortId: '-1',
    tagId: '',
  },

  search: {
    temp_source: 'tx',
    source: 'tx',
    type: 'music',
  },

  viewPrevState: {
    url: '/search',
    query: {},
  },
}

export const DOWNLOAD_STATUS = {
  RUN: 'run',
  WAITING: 'waiting',
  PAUSE: 'pause',
  ERROR: 'error',
  COMPLETED: 'completed',
} as const

export const QUALITYS = ['flac24bit', 'flac', 'wav', 'ape', '320k', '192k', '128k'] as const

export const TRAY_AUTO_ID = -1
