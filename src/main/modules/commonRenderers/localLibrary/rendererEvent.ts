import { mainHandle } from '@common/mainIpc'
import { LOCAL_LIBRARY_EVENT_NAME } from '@common/ipcNames'

/**
 * 本地媒体库的通道（票 01/02）：行数据走 `dbService` worker，文件托管在渲染侧 worker——
 * 两侧互不越界（架构约束：主进程唯一 `new Database`；文件 IO 不进主进程）。
 * 与既有列表通道同口径：不做来源窗口校验（行级媒体元数据，非凭证类）。
 */
export default () => {
  mainHandle<LX.LocalLibrary.Track[]>(LOCAL_LIBRARY_EVENT_NAME.get_all, async() => {
    return global.lx.worker.dbService.localLibraryAll()
  })
  mainHandle<LX.LocalLibrary.TrackInput[]>(LOCAL_LIBRARY_EVENT_NAME.add, async({ params: tracks }) => {
    return global.lx.worker.dbService.localLibraryAdd(tracks)
  })
  mainHandle<LX.LocalLibrary.Track, boolean>(LOCAL_LIBRARY_EVENT_NAME.update, async({ params: track }) => {
    return global.lx.worker.dbService.localLibraryUpdate(track)
  })
  mainHandle<string[]>(LOCAL_LIBRARY_EVENT_NAME.remove, async({ params: ids }) => {
    return global.lx.worker.dbService.localLibraryRemove(ids)
  })
  mainHandle<string[], LX.LocalLibrary.Track[]>(LOCAL_LIBRARY_EVENT_NAME.get_by_ids, async({ params: ids }) => {
    return global.lx.worker.dbService.localLibraryGetByIds(ids)
  })
  mainHandle<number>(LOCAL_LIBRARY_EVENT_NAME.count, async() => {
    return global.lx.worker.dbService.localLibraryCount()
  })
}
