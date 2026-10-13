import { isEmpty, setPause, setPlay, setResource, setStop } from '@renderer/plugins/player'
import { isPlay, playedList, playInfo, playMusicInfo, tempPlayList, musicInfo as _musicInfo } from '@renderer/store/player/state'
import {
  getList,
  clearPlayedList,
  clearTempPlayeList,
  setPlayMusicInfo,
  addPlayedList,
  setMusicInfo,
  setAllStatus,
  removeTempPlayList,
  setPlayListId,
  removePlayedList,
} from '@renderer/store/player/action'
import { appSetting } from '@renderer/store/setting'
import { getMusicUrl, getPicPath, getLyricInfo } from '../music/index'
import { LIST_IDS } from '@common/constants'
import { filterList } from './utils'
import { requestMsg } from '@renderer/utils/message'
import { getRandom } from '@renderer/utils/index'
import { setTempList } from '@renderer/store/list/action'
import { tempListMeta } from '@renderer/store/list/state'
import { setAligning } from '@renderer/store/player/lyric'
import { addFavSongToCloud, removeFavSongFromCloud, favErrorText } from '@renderer/store/user/action'
import { dialog } from '@renderer/plugins/Dialog'
import { addDislikeWithCloud } from '@renderer/core/dislikeList'
import { isUnavailableError, isUnavailableMusic, hintUnavailableMusic } from '@renderer/core/music/unavailable'
import { MAX_CONSECUTIVE_UNAVAILABLE_SKIP, unavailableSkipGuard } from './unavailableSkip'
// import { checkMusicFileAvailable } from '@renderer/utils/music'

let gettingUrlId = ''
const createGettingUrlId = (musicInfo: LX.Music.MusicInfo | LX.Download.ListItem) => {
  const tInfo = 'progress' in musicInfo ? musicInfo.metadata.musicInfo.meta.toggleMusicInfo : musicInfo.meta.toggleMusicInfo
  return `${musicInfo.id}_${tInfo?.id ?? ''}`
}
const createDelayNextTimeout = (getDelayMs: () => number) => {
  let timeout: NodeJS.Timeout | null
  const clearDelayNextTimeout = () => {
    // console.log(this.timeout)
    if (timeout) {
      clearTimeout(timeout)
      timeout = null
    }
  }

  const addDelayNextTimeout = () => {
    // 定时器是模块级单例，延时要**在启动时现读设置**（`player.errorSkipDelay` / `player.getUrlTimeout`
    // 改了立即生效，不用重启；烘进闭包的话得等下一次模块加载）
    const delay = getDelayMs()
    clearDelayNextTimeout()
    timeout = setTimeout(() => {
      timeout = null
      if (window.lx.isPlayedStop) return
      console.warn('delay next timeout timeout', delay)
      void playNext(true)
    }, delay)
  }

  return {
    clearDelayNextTimeout,
    addDelayNextTimeout,
  }
}
const { addDelayNextTimeout, clearDelayNextTimeout } = createDelayNextTimeout(() => appSetting['player.errorSkipDelay'] * 1000)
const { addDelayNextTimeout: addLoadTimeout, clearDelayNextTimeout: clearLoadTimeout } = createDelayNextTimeout(() => appSetting['player.getUrlTimeout'] * 1000)

/**
 * 检查音乐信息是否已更改
 */
const diffCurrentMusicInfo = (curMusicInfo: LX.Music.MusicInfo | LX.Download.ListItem): boolean => {
  // return curMusicInfo !== playMusicInfo.musicInfo || isPlay.value
  return gettingUrlId != createGettingUrlId(curMusicInfo) || curMusicInfo.id != playMusicInfo.musicInfo?.id || isPlay.value
}

let cancelDelayRetry: (() => void) | null = null
const delayRetry = async(musicInfo: LX.Music.MusicInfo | LX.Download.ListItem, isRefresh = false, quality?: LX.Quality, fallbackFirst?: boolean): Promise<string | null> => {
  // if (cancelDelayRetry) cancelDelayRetry()
  return new Promise<string | null>((resolve, reject) => {
    const time = getRandom(2, 6)
    setAllStatus(window.i18n.t('player__getting_url_delay_retry', { time }))
    const tiemout = setTimeout(() => {
      getMusicPlayUrl(musicInfo, isRefresh, true, quality, fallbackFirst).then((result) => {
        cancelDelayRetry = null
        resolve(result)
      }).catch(async(err: any) => {
        cancelDelayRetry = null
        reject(err)
      })
    }, time * 1000)
    cancelDelayRetry = () => {
      clearTimeout(tiemout)
      cancelDelayRetry = null
      resolve(null)
    }
  })
}
/**
 * @param quality 指定档位（只由失败策略 `degrade` 传入：降档重取）。不传 = 按 `player.playQuality` 现算
 * @param fallbackFirst 这次取流先试网易云兜底（`player.wyFallback`），由 `setMusicUrl` 透传
 */
const getMusicPlayUrl = async(musicInfo: LX.Music.MusicInfo | LX.Download.ListItem, isRefresh = false, isRetryed = false, quality?: LX.Quality, fallbackFirst?: boolean): Promise<string | null> => {
  // this.musicInfo.url = await getMusicPlayUrl(targetSong, type)
  setAllStatus(window.i18n.t('player__getting_url'))
  if (appSetting['player.autoSkipOnError']) addLoadTimeout()

  // const type = getPlayType(appSetting['player.highQuality'], musicInfo)
  // 在线源只剩 tx，toggleMusicInfo 是用户手动指定的同源另一版本（如现场版），仍优先播放
  let toggleMusicInfo = ('progress' in musicInfo ? musicInfo.metadata.musicInfo : musicInfo).meta.toggleMusicInfo

  return (toggleMusicInfo ? getMusicUrl({
    musicInfo: toggleMusicInfo,
    isRefresh,
    quality,
    fallbackFirst,
  }) : Promise.reject(new Error('not found'))).catch(async() => {
    return getMusicUrl({
      musicInfo,
      isRefresh,
      quality,
      fallbackFirst,
    })
  }).then(url => {
    if (window.lx.isPlayedStop || diffCurrentMusicInfo(musicInfo)) return null

    return url
  // eslint-disable-next-line @typescript-eslint/promise-function-async
  }).catch(err => {
    // console.log('err', err.message)
    if (window.lx.isPlayedStop ||
      diffCurrentMusicInfo(musicInfo) ||
      err.message == requestMsg.cancelRequest) return null

    if (err.message == requestMsg.tooManyRequests) return delayRetry(musicInfo, isRefresh, quality, fallbackFirst)

    // 「不可播」是确定性结论（所有档位都问过、服务端都没给直链），重取一次也一样：
    // 直接抛给上层去登记 / 跳过，不再白刷一轮（判据见 core/music/unavailable.ts）
    if (isUnavailableError(err)) throw err

    if (!isRetryed) return getMusicPlayUrl(musicInfo, isRefresh, true, quality, fallbackFirst)

    throw err
  })
}

/**
 * 失效曲（无版权 / 已下架）的统一处理：提示 + （开着自动切歌时）立刻跳过它。
 *
 * 为什么**不走 `window.app_event.error()`**：那条路会先按 `player.onUrlFailStrategy` 重试
 * （默认再取两轮流，每轮 4 个档位）再等 `player.errorSkipDelay` 才切歌——而这里的结论
 * （所有档位都没有直链）是确定性的，重试与降档都不会变，白刷接口还拖慢跳过。
 * 队列推进本身仍交给 `playNext`（随机 / 已播历史 / 临时列表那几套逻辑一个字不改）。
 *
 * 跳过有上限（`unavailableSkipGuard`）：整队列都失效时跳满 5 首就停下并提示，别一路空转。
 */
const handleUnavailableMusic = () => {
  hintUnavailableMusic()
  if (!appSetting['player.autoSkipOnError']) return
  // 单曲循环没有「下一首」可跳（`playNext` 会解回同一首），只提示、别空转
  if (appSetting['player.togglePlayMethod'] == 'singleLoop') return
  if (unavailableSkipGuard.take()) {
    console.warn('skip unavailable music')
    void playNext(true)
    return
  }
  setAllStatus(window.i18n.t('player__unavailable_skip_limit', { num: MAX_CONSECUTIVE_UNAVAILABLE_SKIP }))
}

/**
 * @param fallbackFirst 这次先试网易云兜底（只由「播放失败重试用尽」那一次传入，
 *   见 `usePlayEvent.ts` 的 `handleError`）
 */
export const setMusicUrl = (musicInfo: LX.Music.MusicInfo | LX.Download.ListItem, isRefresh?: boolean, quality?: LX.Quality, fallbackFirst?: boolean) => {
  // if (appSetting['player.autoSkipOnError']) addLoadTimeout()
  if (!diffCurrentMusicInfo(musicInfo)) return
  if (cancelDelayRetry) cancelDelayRetry()
  gettingUrlId = createGettingUrlId(musicInfo)
  // 已知失效的曲不再打一次取流（否则每次跳过都要发一轮 vkey，正是探针警告的限流来源）
  if (isUnavailableMusic(musicInfo)) {
    handleUnavailableMusic()
    return
  }
  void getMusicPlayUrl(musicInfo, isRefresh, false, quality, fallbackFirst).then((url) => {
    if (!url) return
    // 真取到流 = 队列没在「连续失效」里打转，跳过计数归零
    unavailableSkipGuard.reset()
    setResource(url)
  }).catch((err: any) => {
    console.log(err)
    // 取流结论是「不可播」：登记已在 `core/music/online.ts` 挂上，这里负责跳过它
    if (isUnavailableError(err)) {
      handleUnavailableMusic()
      return
    }
    setAllStatus(err.message)
    window.app_event.error()
    if (appSetting['player.autoSkipOnError']) addDelayNextTimeout()
  }).finally(() => {
    if (musicInfo === playMusicInfo.musicInfo) {
      gettingUrlId = ''
      clearLoadTimeout()
    }
  })
}

// 恢复上次播放的状态
const handleRestorePlay = async(restorePlayInfo: LX.Player.SavedPlayInfo) => {
  const musicInfo = playMusicInfo.musicInfo
  if (!musicInfo) return

  setImmediate(() => {
    if (musicInfo.id != playMusicInfo.musicInfo?.id) return
    window.app_event.setProgress(appSetting['player.isSavePlayTime'] ? restorePlayInfo.time : 0, restorePlayInfo.maxTime)
    window.app_event.pause()
  })


  void getPicPath({ musicInfo, listId: playMusicInfo.listId }).then((url: string) => {
    if (musicInfo.id != playMusicInfo.musicInfo?.id || url == _musicInfo.pic) return
    setMusicInfo({ pic: url })
    window.app_event.picUpdated()
  }).catch(_ => _)

  void getLyricInfo({ musicInfo }).then((lyricInfo) => {
    if (musicInfo.id != playMusicInfo.musicInfo?.id) return
    setMusicInfo({
      lrc: lyricInfo.lyric,
      tlrc: lyricInfo.tlyric,
      lxlrc: lyricInfo.lxlyric,
      rlrc: lyricInfo.rlyric,
      rawlrc: lyricInfo.rawlrcInfo.lyric,
    })
    window.app_event.lyricUpdated()
  }).catch((err) => {
    console.log(err)
    if (musicInfo.id != playMusicInfo.musicInfo?.id) return
    // 本地曲目的「无结果」是常态不是故障（本地缓存/内嵌/同曲多源都没词）——文案按「未找到歌词」说，
    // 「获取失败」只留给在线源（体验走查 2026-10-11）。musicInfo 联合里有 ListItem，先收窄再取 source
    setAllStatus(window.i18n.t(('source' in musicInfo && musicInfo.source == 'local') ? 'lyric__no_lyric' : 'lyric__load_error'))
  }).finally(() => {
    // 歌词结果落定（成功/失败都算）——对齐窗口到此关上，「有没有歌词」可以下结论。
    // 过期响应不关窗：窗口已归切歌后的新歌所有
    if (musicInfo.id == playMusicInfo.musicInfo?.id) setAligning(false)
  })

  if (appSetting['player.togglePlayMethod'] == 'random' && !playMusicInfo.isTempPlay) addPlayedList({ ...playMusicInfo as LX.Player.PlayMusicInfo })
}


// 处理音乐播放
const handlePlay = () => {
  window.lx.isPlayedStop &&= false

  resetRandomNextMusicInfo()
  if (window.lx.restorePlayInfo) {
    void handleRestorePlay(window.lx.restorePlayInfo)
    window.lx.restorePlayInfo = null
    return
  }
  const musicInfo = playMusicInfo.musicInfo

  if (!musicInfo) return

  setStop()
  window.app_event.pause()

  clearDelayNextTimeout()
  clearLoadTimeout()


  if (appSetting['player.togglePlayMethod'] == 'random' && !playMusicInfo.isTempPlay) addPlayedList({ ...(playMusicInfo as LX.Player.PlayMusicInfo) })

  setMusicUrl(musicInfo)

  void getPicPath({ musicInfo, listId: playMusicInfo.listId }).then((url: string) => {
    if (musicInfo.id != playMusicInfo.musicInfo?.id || url == _musicInfo.pic) return
    setMusicInfo({ pic: url })
    window.app_event.picUpdated()
  }).catch(_ => _)

  void getLyricInfo({ musicInfo }).then((lyricInfo) => {
    if (musicInfo.id != playMusicInfo.musicInfo?.id) return
    setMusicInfo({
      lrc: lyricInfo.lyric,
      tlrc: lyricInfo.tlyric,
      lxlrc: lyricInfo.lxlyric,
      rlrc: lyricInfo.rlyric,
      rawlrc: lyricInfo.rawlrcInfo.lyric,
    })
    window.app_event.lyricUpdated()
  }).catch((err) => {
    console.log(err)
    if (musicInfo.id != playMusicInfo.musicInfo?.id) return
    // 本地曲目的「无结果」是常态不是故障（本地缓存/内嵌/同曲多源都没词）——文案按「未找到歌词」说，
    // 「获取失败」只留给在线源（体验走查 2026-10-11）。musicInfo 联合里有 ListItem，先收窄再取 source
    setAllStatus(window.i18n.t(('source' in musicInfo && musicInfo.source == 'local') ? 'lyric__no_lyric' : 'lyric__load_error'))
  }).finally(() => {
    // 歌词结果落定（成功/失败都算）——对齐窗口到此关上，「有没有歌词」可以下结论。
    // 过期响应不关窗：窗口已归切歌后的新歌所有
    if (musicInfo.id == playMusicInfo.musicInfo?.id) setAligning(false)
  })
}

/**
 * 播放列表内歌曲
 * @param listId 列表id
 * @param id 歌曲id
 */
export const playListById = (listId: string, id: string) => {
  const prevListId = playInfo.playerListId
  setPlayListId(listId)
  // pause()
  const musicInfo = getList(listId).find(m => m.id == id)
  if (!musicInfo) return
  setPlayMusicInfo(listId, musicInfo)
  if (appSetting['player.isAutoCleanPlayedList'] || prevListId != listId) clearPlayedList()
  clearTempPlayeList()
  // 用户手动起播 = 新的播放意图，「连续失效跳过」的计数从头算（自动连播才会累加）
  unavailableSkipGuard.reset()
  handlePlay()
}

/**
 * 播放列表内歌曲
 * @param listId 列表id
 * @param index 播放的歌曲位置
 */
export const playList = (listId: string, index: number) => {
  const prevListId = playInfo.playerListId
  setPlayListId(listId)
  // pause()
  setPlayMusicInfo(listId, getList(listId)[index])
  if (appSetting['player.isAutoCleanPlayedList'] || prevListId != listId) clearPlayedList()
  clearTempPlayeList()
  // 同上：手动点播就重置跳过计数（`playMusicList` 也走这里）
  unavailableSkipGuard.reset()
  handlePlay()
}

/**
 * 播放「一整个列表」：把这份列表灌进临时播放列表（`LIST_IDS.TEMP`）后从 index 开始播。
 *
 * 点单曲 = 从这首开始连播它所在的列表（ui-polish 工单 06 的方案 B）与专辑/歌单的「播放」按钮
 * 共用这条路径，所以「下一首」永远是**当前列表**里的下一首，而不是试听列表里攒下的杂歌。
 *
 * `list` 用副本灌进去：`setTempList` 内部走 `overwriteListMusics` 原地 splice，
 * 传原数组会因为引用同一个数组而出问题（订阅方看到的下标会漂）。
 */
export const playMusicList = async(listId: string, list: LX.Music.MusicInfo[], index: number = 0) => {
  if (!list?.length) return
  if (index < 0) index = 0
  else if (index > list.length - 1) index = list.length - 1
  // 换了「底层列表」就把已播放历史清掉：历史属于那个队列，否则随机/上一首会走错地方。
  // `playList` 里那条只比较播放器当前的 listId，而这里换列表时它一直是 TEMP，判不出来。
  const isOtherList = tempListMeta.id != listId
  // 走这条路的都是在线列表（本地列表播自己的 listId，见 ListMusicTable/usePlay.js），
  // 所以这里按在线对象交给临时列表
  await setTempList(listId, [...list] as LX.Music.MusicInfoOnline[])
  if (isOtherList) clearPlayedList()
  playList(LIST_IDS.TEMP, index)
}

const handleToggleStop = () => {
  stop()
  setTimeout(() => {
    setPlayMusicInfo(null, null)
  })
}
const randomNextMusicInfo = {
  info: null as LX.Player.PlayMusicInfo | null,
  // index: -1,
}
export const resetRandomNextMusicInfo = () => {
  if (randomNextMusicInfo.info) {
    randomNextMusicInfo.info = null
    // randomNextMusicInfo.index = -1
  }
}

export const getNextPlayMusicInfo = async(): Promise<LX.Player.PlayMusicInfo | null> => {
  if (tempPlayList.length) { // 如果稍后播放列表存在歌曲则直接播放改列表的歌曲
    const playMusicInfo = tempPlayList[0]
    return playMusicInfo
  }

  if (playMusicInfo.musicInfo == null) return null

  if (randomNextMusicInfo.info) return randomNextMusicInfo.info

  // console.log(playInfo.playerListId)
  const currentListId = playInfo.playerListId
  if (!currentListId) return null
  const currentList = getList(currentListId)

  if (playedList.length) { // 移除已播放列表内不存在原列表的歌曲
    let currentId: string
    if (playMusicInfo.isTempPlay) {
      const musicInfo = currentList[playInfo.playerPlayIndex]
      if (musicInfo) currentId = musicInfo.id
    } else {
      currentId = playMusicInfo.musicInfo.id
    }
    // 从已播放列表移除播放列表已删除的歌曲
    let index
    for (index = playedList.findIndex(m => m.musicInfo.id === currentId) + 1; index < playedList.length; index++) {
      const playMusicInfo = playedList[index]
      const currentId = playMusicInfo.musicInfo.id
      if (playMusicInfo.listId == currentListId && !currentList.some(m => m.id === currentId)) {
        removePlayedList(index)
        continue
      }
      break
    }

    if (index < playedList.length) return playedList[index]
  }
  // const isCheckFile = findNum > 2 // 针对下载列表，如果超过两次都碰到无效歌曲，则过滤整个列表内的无效歌曲
  let { filteredList, playerIndex } = await filterList({ // 过滤已播放歌曲
    listId: currentListId,
    list: currentList,
    playedList,
    playerMusicInfo: currentList[playInfo.playerPlayIndex],
    isNext: true,
  })

  if (!filteredList.length) return null
  // let currentIndex: number = filteredList.indexOf(currentList[playInfo.playerPlayIndex])
  if (playerIndex == -1 && filteredList.length) playerIndex = 0
  let nextIndex = playerIndex

  let togglePlayMethod = appSetting['player.togglePlayMethod']
  switch (togglePlayMethod) {
    case 'listLoop':
      nextIndex = playerIndex === filteredList.length - 1 ? 0 : playerIndex + 1
      break
    case 'random':
      nextIndex = getRandom(0, filteredList.length)
      break
    case 'list':
      nextIndex = playerIndex === filteredList.length - 1 ? -1 : playerIndex + 1
      break
    case 'singleLoop':
      break
    default:
      return null
  }
  if (nextIndex < 0) return null

  const nextPlayMusicInfo = {
    musicInfo: filteredList[nextIndex],
    listId: currentListId,
    isTempPlay: false,
  }

  if (togglePlayMethod == 'random') {
    randomNextMusicInfo.info = nextPlayMusicInfo
    // randomNextMusicInfo.index = nextIndex
  }
  return nextPlayMusicInfo
}

const handlePlayNext = (playMusicInfo: LX.Player.PlayMusicInfo) => {
  // pause()
  setPlayMusicInfo(playMusicInfo.listId, playMusicInfo.musicInfo, playMusicInfo.isTempPlay)
  handlePlay()
}
/**
 * 下一曲
 * @param isAutoToggle 是否自动切换
 * @returns
 */
export const playNext = async(isAutoToggle = false): Promise<void> => {
  console.log('skip next', isAutoToggle)
  if (tempPlayList.length) { // 如果稍后播放列表存在歌曲则直接播放改列表的歌曲
    const playMusicInfo = tempPlayList[0]
    removeTempPlayList(0)
    handlePlayNext(playMusicInfo)
    console.log('play temp list')
    return
  }

  if (playMusicInfo.musicInfo == null) {
    handleToggleStop()
    console.log('musicInfo empty')
    return
  }

  // console.log(playInfo.playerListId)
  const currentListId = playInfo.playerListId
  if (!currentListId) {
    handleToggleStop()
    console.log('currentListId empty')
    return
  }
  const currentList = getList(currentListId)

  if (playedList.length) { // 移除已播放列表内不存在原列表的歌曲
    let currentId: string
    if (playMusicInfo.isTempPlay) {
      const musicInfo = currentList[playInfo.playerPlayIndex]
      if (musicInfo) currentId = musicInfo.id
    } else {
      currentId = playMusicInfo.musicInfo.id
    }
    // 从已播放列表移除播放列表已删除的歌曲
    let index
    for (index = playedList.findIndex(m => m.musicInfo.id === currentId) + 1; index < playedList.length; index++) {
      const playMusicInfo = playedList[index]
      const currentId = playMusicInfo.musicInfo.id
      if (playMusicInfo.listId == currentListId && !currentList.some(m => m.id === currentId)) {
        removePlayedList(index)
        continue
      }
      break
    }

    if (index < playedList.length) {
      handlePlayNext(playedList[index])
      console.log('play played list')
      return
    }
  }
  if (randomNextMusicInfo.info) {
    handlePlayNext(randomNextMusicInfo.info)
    return
  }
  // const isCheckFile = findNum > 2 // 针对下载列表，如果超过两次都碰到无效歌曲，则过滤整个列表内的无效歌曲
  let { filteredList, playerIndex } = await filterList({ // 过滤已播放歌曲
    listId: currentListId,
    list: currentList,
    playedList,
    playerMusicInfo: currentList[playInfo.playerPlayIndex],
    isNext: true,
  })

  if (!filteredList.length) {
    handleToggleStop()
    console.log('filtered list empty')
    return
  }
  // let currentIndex: number = filteredList.indexOf(currentList[playInfo.playerPlayIndex])
  if (playerIndex == -1 && filteredList.length) playerIndex = 0
  let nextIndex = playerIndex

  let togglePlayMethod = appSetting['player.togglePlayMethod']
  if (!isAutoToggle) {
    switch (togglePlayMethod) {
      case 'list':
      case 'singleLoop':
      case 'none':
        togglePlayMethod = 'listLoop'
    }
  }
  switch (togglePlayMethod) {
    case 'listLoop':
      nextIndex = playerIndex === filteredList.length - 1 ? 0 : playerIndex + 1
      break
    case 'random':
      nextIndex = getRandom(0, filteredList.length)
      break
    case 'list':
      nextIndex = playerIndex === filteredList.length - 1 ? -1 : playerIndex + 1
      break
    case 'singleLoop':
      break
    default:
      nextIndex = -1
      console.log('stop toggle play', togglePlayMethod, isAutoToggle)
      return
  }
  if (nextIndex < 0) {
    console.log('next index empty')
    return
  }

  handlePlayNext({
    musicInfo: filteredList[nextIndex],
    listId: currentListId,
    isTempPlay: false,
  })
}

/**
 * 上一曲
 */
export const playPrev = async(isAutoToggle = false): Promise<void> => {
  if (playMusicInfo.musicInfo == null) {
    handleToggleStop()
    return
  }

  const currentListId = playInfo.playerListId
  if (!currentListId) {
    handleToggleStop()
    return
  }
  const currentList = getList(currentListId)

  if (playedList.length) {
    let currentId: string
    if (playMusicInfo.isTempPlay) {
      const musicInfo = currentList[playInfo.playerPlayIndex]
      if (musicInfo) currentId = musicInfo.id
    } else {
      currentId = playMusicInfo.musicInfo.id
    }
    // 从已播放列表移除播放列表已删除的歌曲
    let index
    for (index = playedList.findIndex(m => m.musicInfo.id === currentId) - 1; index > -1; index--) {
      const playMusicInfo = playedList[index]
      const currentId = playMusicInfo.musicInfo.id
      if (playMusicInfo.listId == currentListId && !currentList.some(m => m.id === currentId)) {
        removePlayedList(index)
        continue
      }
      break
    }

    if (index > -1) {
      handlePlayNext(playedList[index])
      return
    }
  }

  // const isCheckFile = findNum > 2
  let { filteredList, playerIndex } = await filterList({ // 过滤已播放歌曲
    listId: currentListId,
    list: currentList,
    playedList,
    playerMusicInfo: currentList[playInfo.playerPlayIndex],
    isNext: false,
  })
  if (!filteredList.length) {
    handleToggleStop()
    return
  }

  // let currentIndex = filteredList.indexOf(currentList[playInfo.playerPlayIndex])
  if (playerIndex == -1 && filteredList.length) playerIndex = 0
  let nextIndex = playerIndex
  if (!playMusicInfo.isTempPlay) {
    let togglePlayMethod = appSetting['player.togglePlayMethod']
    if (!isAutoToggle) {
      switch (togglePlayMethod) {
        case 'list':
        case 'singleLoop':
        case 'none':
          togglePlayMethod = 'listLoop'
      }
    }
    switch (togglePlayMethod) {
      case 'random':
        nextIndex = getRandom(0, filteredList.length)
        break
      case 'listLoop':
      case 'list':
        nextIndex = playerIndex === 0 ? filteredList.length - 1 : playerIndex - 1
        break
      case 'singleLoop':
        break
      default:
        nextIndex = -1
        return
    }
    if (nextIndex < 0) return
  }

  handlePlayNext({
    musicInfo: filteredList[nextIndex],
    listId: currentListId,
    isTempPlay: false,
  })
}

/**
 * 恢复播放
 */
export const play = () => {
  window.lx.isPlayedStop &&= false
  if (playMusicInfo.musicInfo == null) return
  if (isEmpty()) {
    if (createGettingUrlId(playMusicInfo.musicInfo) != gettingUrlId) setMusicUrl(playMusicInfo.musicInfo)
    return
  }
  setPlay()
}

/**
 * 暂停播放
 */
export const pause = () => {
  setPause()
}

/**
 * 停止播放
 */
export const stop = () => {
  setStop()
  setTimeout(() => {
    window.app_event.stop()
  })
}

/**
 * 播放、暂停播放切换
 */
export const togglePlay = () => {
  window.lx.isPlayedStop &&= false
  if (isPlay.value) {
    pause()
  } else {
    play()
  }
}

/**
 * 收藏当前播放的歌曲（QQ 音乐「我喜欢」，云端 dirId=201）。
 *
 * 本地收藏已取消（2026-09-24）：这一路以前写本地 love 列表，界面退场后写进去也看不见，
 * 现在只写云端。快捷键 / 托盘 / 任务栏 / deeplink 四个入口都走这里，**失败必须弹出来**——
 * 收藏是用户主动动作，静默失败会让人以为已经收藏了。
 */
export const collectMusic = async() => {
  if (!playMusicInfo.musicInfo) return
  const minfo = 'progress' in playMusicInfo.musicInfo ? playMusicInfo.musicInfo.metadata.musicInfo : playMusicInfo.musicInfo
  try {
    // 本地歌曲没有 meta.id，会落 list_add__cloud_no_song_id 的提示（不静默）
    await addFavSongToCloud(minfo as LX.Music.MusicInfoOnline)
  } catch (err) {
    void dialog({ message: favErrorText(err) })
  }
}

/**
 * 取消收藏当前播放的歌曲（从 QQ「我喜欢」移除）。失败同样弹出来。
 */
export const uncollectMusic = async() => {
  if (!playMusicInfo.musicInfo) return
  const minfo = 'progress' in playMusicInfo.musicInfo ? playMusicInfo.musicInfo.metadata.musicInfo : playMusicInfo.musicInfo
  try {
    await removeFavSongFromCloud(minfo as LX.Music.MusicInfoOnline)
  } catch (err) {
    void dialog({ message: favErrorText(err) })
  }
}

/**
 * 不喜欢当前播放的歌曲
 */
export const dislikeMusic = async() => {
  if (!playMusicInfo.musicInfo) return
  const minfo = 'progress' in playMusicInfo.musicInfo ? playMusicInfo.musicInfo.metadata.musicInfo : playMusicInfo.musicInfo
  await addDislikeWithCloud(minfo)
  await playNext(true)
}
