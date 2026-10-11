import { computed, ref, reactive, nextTick } from '@common/utils/vueTools'
import { useI18n } from '@renderer/plugins/i18n'
import { userLists } from '@renderer/store/list/state'
import { addLocalFile } from './actions'

export default ({
  emit,

  handleRename,
  handleDuplicateList,
  handleSortList,
  handleImportList,
  handleShowExportWizard,
  handleRemove,
}) => {
  const menuControl = reactive({
    rename: true,
    duplicate: true,
    sort: true,
    local_file: true,
    import: true,
    export: true,
    remove: true,
  })
  const t = useI18n()
  const menuLocation = reactive({ x: 0, y: 0 })
  const isShowMenu = ref(false)

  // 本组件只服务本地歌单 tab 的左栏（CloudRail 不用它），所以没有 QQ 源列表：
  // 「更新 / 歌单详情页 / 复制歌单链接」在这里**永远置灰**，是纯噪声——直接不再出现（真机反馈：菜单太乱）。
  // 导出只留「导出…」向导：向导的 JSON 与旧「导出」的 .lxmc 同构（core/localLibrary/export.ts 的
  // playListPart_v2，应用自身导入可直接读回），两份导出入口只留一个。
  const menus = computed(() => {
    return [
      {
        name: t('lists__rename'),
        action: 'rename',
        disabled: !menuControl.rename,
      },
      {
        name: t('lists__sort_list'),
        action: 'sort',
        disabled: !menuControl.sort,
      },
      {
        name: t('lists__duplicate'),
        action: 'duplicate',
        disabled: !menuControl.duplicate,
      },
      {
        name: t('lists__select_local_file'),
        action: 'local_file',
        disabled: !menuControl.local_file,
      },
      {
        name: t('lists__import'),
        action: 'import',
        disabled: !menuControl.export,
      },
      // 导出向导（票 11）：JSON / m3u8 / 复制音频文件三选勾
      {
        name: t('playlists__export_wizard'),
        action: 'export_wizard',
        disabled: !menuControl.export,
      },
      {
        name: t('lists__remove'),
        action: 'remove',
        disabled: !menuControl.remove,
      },
    ]
  })

  const showMenu = (event, index) => {
    switch (index) {
      case -1:
      case -2:
        menuControl.rename = false
        menuControl.remove = false
        break
      default:
        menuControl.rename = true
        menuControl.remove = true
        break
    }

    menuLocation.x = event.pageX
    menuLocation.y = event.pageY

    if (isShowMenu.value) return
    emit('show-menu')
    nextTick(() => {
      isShowMenu.value = true
    })
  }

  const hideMenu = () => {
    isShowMenu.value = false
  }

  // 右键菜单只挂在左栏渲染的**本地自建列表**上（`LocalRail.vue` 的 v-for，index ≥ 0）：
  // 以前还有 -1（我的收藏）/ -2（试听列表）两个前导项，随 ADR-0006（界面）与票 08（数据层）
  // 一起退场，故只剩下面这一条分支。
  const getListInfo = (index) => {
    const list = userLists[index]
    if (!list) return null
    return list
  }

  const menuClick = (action, index) => {
    hideMenu()
    if (!action) return
    const listInfo = getListInfo(index)
    switch (action.action) {
      case 'rename':
        handleRename(index)
        break
      case 'duplicate':
        handleDuplicateList(listInfo)
        break
      case 'sort':
        handleSortList(listInfo)
        break
      case 'local_file':
        addLocalFile(listInfo)
        break
      case 'import':
        handleImportList(listInfo, index)
        break
      case 'export_wizard':
        handleShowExportWizard?.(listInfo)
        break
      case 'remove':
        handleRemove(listInfo)
        break
    }
  }

  return {
    menus,
    menuLocation,
    isShowMenu,
    showMenu,
    hideMenu,
    menuClick,
  }
}
