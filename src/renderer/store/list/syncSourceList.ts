import { setListUpdateTime } from '@renderer/utils/data'
import { BOARD_QUEUE_PREFIX } from '@renderer/utils/queueIds'
import { setFetchingListStatus, overwriteListMusics, setUpdateTime } from './action'
import { getListDetailAll } from '@renderer/store/songList/action'
import { getListDetailAll as getBoardListAll } from '@renderer/store/leaderboard/action'
import { dateFormat } from '@common/utils/common'

const fetchList = async(id: string, source: LX.OnlineSource, sourceListId: string) => {
  setFetchingListStatus(id, true)

  let promise
  // 榜单的「复制到我的歌单」把身份（`board__<id>`，与队列身份同一串）存进了 sourceListId，
  // 这里反解出榜单 id 走榜单接口；前缀的家在 @renderer/utils/queueIds（票 06 M3）
  if (sourceListId.startsWith(BOARD_QUEUE_PREFIX)) {
    const id = sourceListId.slice(BOARD_QUEUE_PREFIX.length)
    promise = id ? getBoardListAll(id, true) : Promise.reject(new Error('id not defined: ' + sourceListId))
  } else {
    promise = getListDetailAll(sourceListId, source, true)
  }
  return promise.finally(() => {
    setFetchingListStatus(id, false)
  })
}

export default async(targetListInfo: LX.List.UserListInfo) => {
  // console.log(targetListInfo)
  if (!targetListInfo.source || !targetListInfo.sourceListId) return
  const list = await fetchList(targetListInfo.id, targetListInfo.source, targetListInfo.sourceListId)
  // console.log(list)
  void overwriteListMusics({ listId: targetListInfo.id, musicInfos: list })
  const now = Date.now()
  void setListUpdateTime(targetListInfo.id, now)
  setUpdateTime(targetListInfo.id, dateFormat(now))
}
