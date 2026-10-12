<template lang="pug">
div
  h3 {{ $t('setting__backup_part') }}
  .p
    base-btn.btn.gap-left(min data-setting-id="data_backup_import_list" @click="handleImportPlayList") {{ $t('setting__backup_part_import_list') }}
    base-btn.btn.gap-left(min data-setting-id="data_backup_export_list" @click="handleExportPlayList") {{ $t('setting__backup_part_export_list') }}
    base-btn.btn.gap-left(min data-setting-id="data_backup_import_setting" @click="handleImportSetting") {{ $t('setting__backup_part_import_setting') }}
    base-btn.btn.gap-left(min data-setting-id="data_backup_export_setting" @click="handleExportSetting") {{ $t('setting__backup_part_export_setting') }}
  h3 {{ $t('setting__backup_all') }}
  .p
    base-btn.btn.gap-left(min data-setting-id="data_backup_import_all" @click="handleImportAllData") {{ $t('setting__backup_all_import') }}
    base-btn.btn.gap-left(min data-setting-id="data_backup_export_all" @click="handleExportAllData") {{ $t('setting__backup_all_export') }}
  h3 {{ $t('setting__backup_other') }}
  .p
    base-btn.btn.gap-left(min data-setting-id="data_backup_export_txt" @click="handleExportPlayListToText") {{ $t('setting__backup_other_export_list_text') }}
    base-btn.btn.gap-left(min data-setting-id="data_backup_export_csv" @click="handleExportPlayListToCsv") {{ $t('setting__backup_other_export_list_csv') }}
</template>

<script>
import { toRaw } from '@common/utils/vueTools'
import {
  toNewMusicInfo,
  filterMusicList,
  fixNewMusicInfoQuality,
} from '@renderer/utils'
import {
  showSelectDialog,
  openSaveDir,
} from '@renderer/utils/ipc'
import { dialog } from '@renderer/plugins/Dialog'
import useImportTip from '@renderer/utils/compositions/useImportTip'
import { useI18n } from '@renderer/plugins/i18n'
import { getListMusics, overwriteListFull } from '@renderer/store/list/action'
import { userLists } from '@renderer/store/list/state'
import { appSetting, updateSetting } from '@renderer/store/setting'
import migrateSetting from '@common/utils/migrateSetting'
import { mergeImportedLists } from './listDataImport'

/**
 * 「数据与存储 → 备份与恢复」的 8 个按钮（票 03 从旧 `SettingBackup.vue` 整体搬来）。
 *
 * 8 个按钮全是**非 key 控件**：2026-09-25 起按 `NonKeyItem` 登记进元数据（`data_backup_*`），
 * 每个按钮挂 `data-setting-id` 让搜索能精确高亮（此前只能搜到「备份与恢复」这个组标题）。
 * 搬运时**行为一字未改**：三个子块（部分数据 / 所有数据 / 其他备份格式）保留为无 id 的 `h3`
 * 子标题（有 id 就会变成元数据之外的野锚点）。默认文件名票 04 已从上游的旧前缀改成 `chiverve_*`
 * （`.lxmc` 后缀是上游的配置文件格式名，与 `readLxConfigFile` 同一套，不动）。
 *
 * 导入设置的副作用（**别当 bug 修**）：`common.isAgreePact` 被强制写成 false
 * （`importOldSettingData` / `importNewSettingData`），下次启动会重新走协议弹窗。
 */
export default {
  name: 'SettingDataBackup',
  setup() {
    const t = useI18n()
    const showImportTip = useImportTip()

    /**
     * 本地已有列表：**全部是自建列表**（保留列表 `default`/`love` 已退休，没有第 0 项的特殊含义）。
     *
     * 导出时这两条都不写进备份文件；导入侧按 `id` 认列表并**跳过**旧备份里的遗留段
     * （见 `listDataImport.ts` 的 `RETIRED_LIST_IDS`）。
     */
    const getAllLists = async() => {
      const lists = []

      for await (const list of userLists) {
        lists.push(await getListMusics(list.id).then(musics => ({ ...toRaw(list), list: toRaw(musics) })))
      }

      return lists
    }

    const importOldListData = async(lists) => {
      const { userList } = mergeImportedLists(
        await getAllLists(),
        lists,
        (musicList) => filterMusicList(musicList.map(m => toNewMusicInfo(m))),
      )
      await overwriteListFull({ userList })
    }
    const importNewListData = async(lists) => {
      const { userList } = mergeImportedLists(
        await getAllLists(),
        lists,
        (musicList) => filterMusicList(musicList).map(m => fixNewMusicInfoQuality(m)),
      )
      await overwriteListFull({ userList })
    }
    const importOldSettingData = (setting) => {
      console.log(setting)
      setting = migrateSetting(setting)
      setting['common.isAgreePact'] = false
      updateSetting(setting)
    }
    const importNewSettingData = (setting) => {
      setting['common.isAgreePact'] = false
      updateSetting(setting)
    }

    const importAllData = async(path) => {
      let allData
      try {
        allData = await window.lx.worker.main.readLxConfigFile(path)
      } catch (error) {
        return
      }

      switch (allData.type) {
        case 'allData':
          // 0.6.2 及以前版本的列表数据：列表都在 `playList` 里按 id 认，试听列表由
          // `mergeImportedLists` 跳过；这一档只有「设置 + 试听列表」的老文件（带 `defaultList`）
          // 的列表部分就整块丢掉，设置照旧导入——用户已接受早版本点过的歌不导入（票 08 契约 1）
          if (allData.defaultList) console.log('[list import] 跳过 0.6.2 备份里的试听列表（该列表已删除）')
          else await importOldListData(allData.playList)
          importOldSettingData(allData.setting)
          break
        case 'allData_v2':
          await importNewListData(allData.playList)
          importNewSettingData(allData.setting)
          break
        default: { showImportTip(allData.type) }
      }
    }
    const handleImportAllData = () => {
      void showSelectDialog({
        title: t('setting__backup_all_import_desc'),
        properties: ['openFile'],
        filters: [
          { name: 'Setting', extensions: ['json', 'lxmc'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      }).then(result => {
        if (result.canceled) return
        void dialog.confirm({
          message: t('setting__backup_part_import_list_confirm'),
          cancelButtonText: t('cancel_button_text'),
          confirmButtonText: t('confirm_button_text'),
        }).then(confirm => {
          if (!confirm) return
          void importAllData(result.filePaths[0])
        })
      })
    }

    const exportAllData = async(path) => {
      let allData = {
        type: 'allData_v2',
        setting: { ...appSetting },
        playList: await getAllLists(),
      }
      void window.lx.worker.main.saveLxConfigFile(path, allData)
    }
    const handleExportAllData = () => {
      void openSaveDir({
        title: t('setting__backup_all_export_desc'),
        defaultPath: 'chiverve_datas_v2.lxmc',
      }).then(result => {
        if (result.canceled) return
        void exportAllData(result.filePath)
      })
    }

    const exportSetting = (path) => {
      const data = {
        type: 'setting_v2',
        data: { ...appSetting },
      }
      void window.lx.worker.main.saveLxConfigFile(path, data)
    }
    const handleExportSetting = () => {
      void openSaveDir({
        title: t('setting__backup_part_export_setting_desc'),
        defaultPath: 'chiverve_setting_v2.lxmc',
      }).then(result => {
        if (result.canceled) return
        exportSetting(result.filePath)
      })
    }

    const importSetting = async(path) => {
      let settingData
      try {
        settingData = await window.lx.worker.main.readLxConfigFile(path)
      } catch (error) {
        return
      }

      switch (settingData.type) {
        case 'setting':
          importOldSettingData(settingData.data)
          break
        case 'setting_v2':
          importNewSettingData(settingData.data)
          break
        default: { showImportTip(settingData.type) }
      }
    }
    const handleImportSetting = () => {
      void showSelectDialog({
        title: t('setting__backup_part_import_setting_desc'),
        properties: ['openFile'],
        filters: [
          { name: 'Setting', extensions: ['json', 'lxmc'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      }).then(result => {
        if (result.canceled) return
        void importSetting(result.filePaths[0])
      })
    }

    const exportPlayList = async(path) => {
      const data = {
        type: 'playList_v2',
        data: await getAllLists(),
      }
      void window.lx.worker.main.saveLxConfigFile(path, data)
    }
    const handleExportPlayList = () => {
      void openSaveDir({
        title: t('setting__backup_part_export_list_desc'),
        defaultPath: 'chiverve_list.lxmc',
      }).then(result => {
        if (result.canceled) return
        void exportPlayList(result.filePath)
      })
    }

    const importPlayList = async(path) => {
      let listData
      try {
        listData = await window.lx.worker.main.readLxConfigFile(path)
      } catch (error) {
        return
      }
      console.log(listData.type)

      switch (listData.type) {
        // 0.6.2 及以前的「单条试听列表」文件：这条列表（票 08）已从库里删掉，没地方可导——
        // 跳过（不并进「我的收藏」，也不新建一条同 id 的自建列表），与 `mergeImportedLists` 同口径
        case 'defautlList':
          console.log('[list import] 跳过 0.6.2 的试听列表文件（该列表已删除）')
          break
        case 'playList':
          await importOldListData(listData.data)
          break
        case 'playList_v2':
          await importNewListData(listData.data)
          break
        default: { showImportTip(listData.type) }
      }
    }
    const handleImportPlayList = () => {
      void showSelectDialog({
        title: t('setting__backup_part_import_list_desc'),
        properties: ['openFile'],
        filters: [
          { name: 'Play List', extensions: ['json', 'lxmc'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      }).then(result => {
        if (result.canceled) return
        void dialog.confirm({
          message: t('setting__backup_part_import_list_confirm'),
          cancelButtonText: t('cancel_button_text'),
          confirmButtonText: t('confirm_button_text'),
        }).then(confirm => {
          if (!confirm) return
          void importPlayList(result.filePaths[0])
        })
      })
    }

    const exportPlayListToText = async(savePath, isMerge) => {
      const lists = await getAllLists()
      await window.lx.worker.main.exportPlayListToText(savePath, lists, isMerge)
    }
    const handleExportPlayListToText = async() => {
      const confirm = await dialog.confirm({
        message: t('setting__backup_other_export_list_text_confirm'),
        cancelButtonText: t('cancel_button_text'),
        confirmButtonText: t('confirm_button_text'),
      })
      if (confirm) {
        void openSaveDir({
          title: t('setting__backup_other_export_dir'),
          defaultPath: 'chiverve_list_all.txt',
        }).then(result => {
          if (result.canceled) return
          let path = result.filePath
          if (!path.endsWith('.txt')) path += '.txt'
          void exportPlayListToText(path, true)
        })
      } else {
        void showSelectDialog({
          title: t('setting__backup_other_export_dir'),
          properties: ['openDirectory'],
        }).then(result => {
          if (result.canceled) return
          void exportPlayListToText(result.filePaths[0], false)
        })
      }
    }

    const exportPlayListToCsv = async(savePath, isMerge) => {
      const lists = await getAllLists()
      await window.lx.worker.main.exportPlayListToCSV(savePath, lists, isMerge, `${t('music_name')},${t('music_singer')},${t('music_album')}\n`)
    }
    const handleExportPlayListToCsv = async() => {
      const confirm = await dialog.confirm({
        message: t('setting__backup_other_export_list_text_confirm'),
        cancelButtonText: t('cancel_button_text'),
        confirmButtonText: t('confirm_button_text'),
      })
      if (confirm) {
        void openSaveDir({
          title: t('setting__backup_other_export_dir'),
          defaultPath: 'chiverve_list_all.csv',
        }).then(result => {
          if (result.canceled) return
          let path = result.filePath
          if (!path.endsWith('.csv')) path += '.csv'
          void exportPlayListToCsv(path, true)
        })
      } else {
        void showSelectDialog({
          title: t('setting__backup_other_export_dir'),
          properties: ['openDirectory'],
        }).then(result => {
          if (result.canceled) return
          void exportPlayListToCsv(result.filePaths[0], false)
        })
      }
    }

    return {
      handleExportPlayList,
      handleImportPlayList,
      handleExportSetting,
      handleImportSetting,
      handleExportAllData,
      handleImportAllData,
      handleExportPlayListToText,
      handleExportPlayListToCsv,
    }
  },
}
</script>
