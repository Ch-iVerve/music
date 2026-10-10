import { computed, ref, shallowReactive, reactive, nextTick } from '@common/utils/vueTools'
import musicSdk from '@renderer/utils/musicSdk'
import { useI18n } from '@renderer/plugins/i18n'
import { hasDislike } from '@renderer/core/dislikeList'
import { canJumpToAlbum, canJumpToSinger, canShareMusic } from '@common/utils/musicLink'
import useFavSong from '@renderer/utils/compositions/useFavSong'

export default ({
  assertApiSupport,
  emit,
  selectedList = [],
  handleShowBatchEditModal = () => {},

  handleShowDownloadModal,
  handlePlayMusic,
  handlePlayMusicLater,
  handleSearch,
  handleShowMusicAddModal,
  handleShowMusicMoveModal,
  handleShowSortModal,
  handleOpenMusicDetail,
  handleCopyName,
  handleDislikeMusic,
  handleRemoveMusic,

  handleJumpAlbum,
  handleJumpSinger,
  handleCopyLink,
  handleOpenInQqMusic,
}) => {
  const itemMenuControl = reactive({
    play: true,
    playLater: true,
    copyName: true,
    addTo: true,
    fav: true,
    moveTo: true,
    sort: true,
    download: true,
    search: true,
    dislike: true,
    remove: true,
    sourceDetail: true,
    jumpAlbum: true,
    jumpSinger: true,
    share: true,
  })
  const t = useI18n()
  // 「我喜欢」是**一键开关**（工单 06）：名字随当前状态变，点一下就地切换，不再开弹窗。
  // 与在线歌曲表那份是同一份实现（`useFavSong`），只有菜单项在列表里的位置不同
  const { canFav, favTitle, toggleFav, loadFavState } = useFavSong()
  // 只记「当前右键的这一首」（本文件拿不到 list，菜单项与动作都读它）
  const currentMusic = ref(null)
  const menuLocation = shallowReactive({ x: 0, y: 0 })
  const isShowItemMenu = ref(false)

  const menus = computed(() => {
    return [
      {
        name: t('list__play'),
        action: 'play',
        disabled: !itemMenuControl.play,
      },
      {
        name: t('list__download'),
        action: 'download',
        disabled: !itemMenuControl.download,
      },
      {
        name: t('list__play_later'),
        action: 'playLater',
        disabled: !itemMenuControl.playLater,
      },
      // 「我喜欢」与「加入歌单」是两件事（工单 06）：前者一键切换（名字随状态变），
      // 后者开弹窗。本地文件等不能收藏的歌**不显示**收藏项，而不是显示成灰的
      {
        name: favTitle(currentMusic.value),
        action: 'fav',
        hide: !itemMenuControl.fav,
      },
      {
        name: t('list__add_to'),
        action: 'addTo',
        disabled: !itemMenuControl.addTo,
      },
      // 批量编辑（票 10）：多选 ≥2 时出现；只对本地托管条目生效（在线歌/旧条目在弹窗里报告跳过）
      {
        name: t('playlists__batch_edit'),
        action: 'batch_edit',
        hide: !selectedList || selectedList.length < 2,
      },
      {
        name: t('list__move_to'),
        action: 'moveTo',
        disabled: !itemMenuControl.moveTo,
      },
      {
        name: t('list__sort'),
        action: 'sort',
        disabled: !itemMenuControl.sort,
      },
      {
        name: t('list__copy_name'),
        action: 'copyName',
        disabled: !itemMenuControl.copyName,
      },
      {
        name: t('list__source_detail'),
        action: 'sourceDetail',
        // 本地文件不出现（工单 03）：判据是「源有 getMusicDetailPageUrl」——本地源没有，
        // 而本仓详情页同样进不去（没有在线 mid）。原先这里是显示成灰的，点了没反应
        hide: !itemMenuControl.sourceDetail,
      },
      // 跳转 / 分享：本地文件**不显示**（没有在线 mid，显示出来就是点了没反应的项）
      {
        name: t('list__jump_album'),
        action: 'jumpAlbum',
        hide: !itemMenuControl.jumpAlbum,
      },
      {
        name: t('list__jump_singer'),
        action: 'jumpSinger',
        hide: !itemMenuControl.jumpSinger,
      },
      {
        name: t('list__copy_link'),
        action: 'copyLink',
        hide: !itemMenuControl.share,
      },
      {
        name: t('list__open_in_qq'),
        action: 'openInQq',
        hide: !itemMenuControl.share,
      },
      {
        name: t('list__search'),
        action: 'search',
        disabled: !itemMenuControl.search,
      },
      {
        name: t('list__dislike'),
        action: 'dislike',
        disabled: !itemMenuControl.dislike,
      },
      {
        name: t('list__remove'),
        action: 'remove',
        disabled: !itemMenuControl.remove,
      },
    ]
  })

  const showMenu = (event, musicInfo) => {
    itemMenuControl.sourceDetail = !!musicSdk[musicInfo.source]?.getMusicDetailPageUrl
    // itemMenuControl.play =
    //   itemMenuControl.playLater =
    itemMenuControl.download = assertApiSupport(musicInfo.source) && musicInfo.source != 'local'
    itemMenuControl.jumpAlbum = canJumpToAlbum(musicInfo)
    itemMenuControl.jumpSinger = canJumpToSinger(musicInfo)
    itemMenuControl.share = canShareMusic(musicInfo)

    itemMenuControl.dislike = !hasDislike(musicInfo)

    // 收藏态先拉回来（缓存住，一次会话只真拉一次）：拉不到就按「没收藏」显示文案，
    // 点击那一下会再等一次（`toggleFav` 内部），所以不会点错方向
    currentMusic.value = musicInfo
    itemMenuControl.fav = canFav(musicInfo)
    loadFavState()

    menuLocation.x = event.pageX
    menuLocation.y = event.pageY

    if (isShowItemMenu.value) return

    emit('show-menu')
    nextTick(() => {
      isShowItemMenu.value = true
    })
  }

  const hideMenu = () => {
    isShowItemMenu.value = false
  }

  const menuClick = (action, index, location) => {
    // console.log(action)
    hideMenu()
    if (!action) return
    switch (action.action) {
      case 'play':
        handlePlayMusic(index)
        break
      case 'playLater':
        handlePlayMusicLater(index)
        break
      case 'copyName':
        handleCopyName(index)
        break
      case 'addTo':
        handleShowMusicAddModal(index)
        break
      case 'batch_edit':
        handleShowBatchEditModal()
        break
      case 'fav':
        // 一键切换「我喜欢」：失败会在 toggleFav 里弹出来（未登录 → 请先登录 QQ 音乐）
        toggleFav(currentMusic.value)
        break
      case 'moveTo':
        handleShowMusicMoveModal(index)
        break
      case 'sort':
        handleShowSortModal(index)
        break
      case 'download':
        handleShowDownloadModal(index)
        break
      case 'search':
        handleSearch(index)
        break
      case 'dislike':
        handleDislikeMusic(index)
        break
      case 'remove':
        handleRemoveMusic(index)
        break
      case 'sourceDetail':
        handleOpenMusicDetail(index)
        break
      case 'jumpAlbum':
        handleJumpAlbum(index)
        break
      case 'jumpSinger':
        // 多位歌手时选择菜单要出现在行菜单的位置上
        handleJumpSinger(index, location)
        break
      case 'copyLink':
        handleCopyLink(index)
        break
      case 'openInQq':
        handleOpenInQqMusic(index)
        break
    }
  }

  return {
    menus,
    menuLocation,
    isShowItemMenu,
    showMenu,
    menuClick,
  }
}
