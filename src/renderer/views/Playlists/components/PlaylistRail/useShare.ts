import { showSelectDialog } from '@renderer/utils/ipc'
import { useI18n } from '@renderer/plugins/i18n'
import { toNewMusicInfo, fixNewMusicInfoQuality, filterMusicList } from '@renderer/utils'
import { updateUserList, addListMusics, overwriteListMusics, createUserList } from '@renderer/store/list/action'
import { loveList, userLists } from '@renderer/store/list/state'
import useImportTip from '@renderer/utils/compositions/useImportTip'
import { dialog } from '@renderer/plugins/Dialog'
import { LIST_IDS } from '@common/constants'


export default () => {
  const t = useI18n()
  const showImportTip = useImportTip()

  const handleImportList = (listInfo: LX.List.MyListInfo, index: number) => {
    void showSelectDialog({
      title: t('lists__import_part_desc'),
      properties: ['openFile'],
      filters: [
        { name: 'Play List Part', extensions: ['json', 'lxmc'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    }).then(async result => {
      if (result.canceled) return
      const filePath = result.filePaths[0]
      if (!filePath) return
      let configData: any
      try {
        configData = await window.lx.worker.main.readLxConfigFile(filePath)
      } catch (error) {
        return
      }
      let listData: LX.ConfigFile.MyListInfoPart['data']
      switch (configData.type) {
        case 'playListPart':
          listData = configData.data
          listData.list = filterMusicList(listData.list.map(m => toNewMusicInfo(m)))
          break
        case 'playListPart_v2':
          listData = configData.data
          listData.list = filterMusicList(listData.list).map(m => fixNewMusicInfoQuality(m))
          break
        default:
          showImportTip(configData.type)
          return
      }

      // 单列表文件里带的是「试听列表」（`default`，票 08 已从数据层删除）时直接跳过：
      // 不能落进任何一条现有列表（用户明确不让它并进「我的收藏」），也不能拿它的 id 去
      // 新建自建列表——那会让已删除的保留 id 借尸还魂，`list_data_overwrite` 一跑就把它清掉。
      if (listData.id == LIST_IDS.DEFAULT) {
        console.log('[list import] 跳过试听列表（该列表已删除）')
        return
      }

      const targetList = [loveList, ...userLists].find(l => l.id == listData.id)
      if (targetList) {
        const confirm = await dialog.confirm({
          message: t('lists__import_part_confirm', { importName: listData.name, localName: targetList.name }),
          cancelButtonText: t('lists__import_part_button_cancel'),
          confirmButtonText: t('lists__import_part_button_confirm'),
        })
        if (confirm) {
          listData.name = targetList.name
          switch (listData.id) {
            case loveList.id:
              break
            default:
              void updateUserList([
                {
                  name: listData.name,
                  id: listData.id,
                  source: (listData as LX.List.UserListInfo).source,
                  sourceListId: (listData as LX.List.UserListInfo).sourceListId,
                  locationUpdateTime: (targetList as LX.List.UserListInfo).locationUpdateTime,
                },
              ])
              break
          }
          void overwriteListMusics({
            listId: listData.id,
            musicInfos: listData.list.map(m => fixNewMusicInfoQuality(m)),
          })
          return
        }
        listData.id += `__${Date.now()}`
      }
      void createUserList({
        position: index,
        name: listData.name,
        id: listData.id,
        source: (listData as LX.List.UserListInfo).source,
        sourceListId: (listData as LX.List.UserListInfo).sourceListId,
      })
      void addListMusics(listData.id, listData.list.map(m => fixNewMusicInfoQuality(m)))
    })
  }

  return {
    handleImportList,
  }
}
