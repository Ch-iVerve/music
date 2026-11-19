
import { throttle } from '@common/utils/common'
import { getSearchHistoryMaxNum, nextHistoryList } from '@common/settings/searchHistory'
import { toRaw } from '@common/utils/vueTools'
import {
  getSearchHistoryList,
  saveSearchHistoryList,
} from '@renderer/utils/ipc'
import { appSetting } from '../setting'
import { searchText, historyList } from './state'


export const setSearchText = (text: string) => {
  searchText.value = text
}

let isInitedSearchHistory = false
const saveSearchHistoryListThrottle = throttle((list: LX.List.SearchHistoryList) => {
  saveSearchHistoryList(list)
}, 500)


/**
 * 拉历史词。失败**不抛**（2026-09-26 审查）：历史词是非关键路径，且调用点全是
 * `void getHistoryList()`——抛出去会变成未处理 rejection（dev 下 webpack-dev-server
 * 据此弹全屏浮层，吞掉真实鼠标输入，同类问题已修过一例）。
 * 读不到就当没有历史，下次再进来还会重试（失败不置 `isInitedSearchHistory`）。
 */
export const getHistoryList = async() => {
  if (isInitedSearchHistory || historyList.length) return
  try {
    historyList.push(...(await getSearchHistoryList() ?? []))
    isInitedSearchHistory ||= true
  } catch (err) {
    console.log('[search] get history list failed:', err)
  }
}
export const addHistoryWord = async(word: string) => {
  if (!appSetting['search.isShowHistorySearch']) return
  // 条数上限（`search.historyMaxNum`，0 = 不记历史）：总闸是上面的 isShowHistorySearch，这里是条数闸。
  // 上限为 0 时直接返回，不动已有历史（「不记」不等于「清空」，清空有独立入口）
  const maxNum = getSearchHistoryMaxNum(appSetting)
  if (maxNum < 1) return
  // 这一句也是本函数唯一会 await 的地方：它已经不再抛（见上），所以整个函数对调用方是安全的
  if (!isInitedSearchHistory) await getHistoryList()
  let index = historyList.indexOf(word)
  if (index == 0) return
  // 置顶 + 去重 + 截断三步都在纯函数里（规则与量程见 common/settings/searchHistory.ts，单测覆盖）；
  // 整体替换而不是就地 splice，是为了让「列表内容只由纯函数决定」这件事在代码里看得出来
  historyList.splice(0, historyList.length, ...nextHistoryList(historyList, word, maxNum))
  saveSearchHistoryListThrottle(toRaw(historyList))
}
export const removeHistoryWord = (index: number) => {
  historyList.splice(index, 1)
  saveSearchHistoryListThrottle(toRaw(historyList))
}
export const clearHistoryList = (id: string) => {
  historyList.splice(0, historyList.length)
  saveSearchHistoryList([])
}
