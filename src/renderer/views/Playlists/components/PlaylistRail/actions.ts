import { setFetchingListStatus } from '@renderer/store/list/action'
import { showSelectDialog } from '@renderer/utils/ipc'
import { importLocalFilesToList } from '@renderer/core/localLibrary'

/**
 * 右键「添加本地歌曲」（票 02 起为**托管导入**）：文件按内容哈希复制进媒体目录、写入曲目库，
 * 再以库条目引用进当前歌单；进度/取消/汇总由 LocalImportProgressModal 展示（core/localLibrary 驱动）。
 */
export const addLocalFile = async(listInfo: LX.List.UserListInfo) => {
  const { canceled, filePaths } = await showSelectDialog({
    title: window.i18n.t('lists__add_local_file_desc'),
    properties: ['openFile', 'multiSelections'],
    filters: [
      // https://support.google.com/chromebook/answer/183093
      // 3gp, .avi, .mov, .m4v, .m4a, .mp3, .mkv, .ogm, .ogg, .oga, .webm, .wav
      { name: 'Media File', extensions: ['mp3', 'flac', 'ogg', 'oga', 'wav', 'm4a'] },
      // { name: 'All Files', extensions: ['*'] },
    ],
  })
  if (canceled || !filePaths.length) return

  setFetchingListStatus(listInfo.id, true)
  try {
    await importLocalFilesToList(listInfo.id, filePaths)
  } finally {
    setFetchingListStatus(listInfo.id, false)
  }
}
