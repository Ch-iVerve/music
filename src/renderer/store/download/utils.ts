import { appSetting } from '@renderer/store/setting'
import { userLists } from '@renderer/store/list/listManage'
import { filterFileName } from '@common/utils/common'
import { clipFileNameLength } from '@common/utils/tools'
import { joinPath } from '@common/utils/nodejs'

export const buildSavePath = (musicInfo: LX.Download.ListItem) => {
  let savePath = appSetting['download.savePath']
  if (appSetting['download.isSavePathGroupByListName']) {
    let dirName: string | undefined
    const listId = musicInfo.metadata.listId
    // 来源列表只剩自建列表：`love`（本地收藏）与 `default`（试听列表）都已退休，不再有它们的目录名分支
    dirName = userLists.find(list => list.id === listId)?.name
    // 来源列表认不出来（例如搜索、排行榜直接下载，或旧任务的 `listId` 是被删除的保留列表 id）时
    // **不再套子目录**：拿已退休概念的名字做目录名会把它们又印在磁盘上。
    if (dirName) dirName = filterFileName(dirName)
    if (dirName) savePath = joinPath(savePath, clipFileNameLength(dirName))
  }
  return savePath
}
