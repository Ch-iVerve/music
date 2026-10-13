import { useRouter } from '@common/utils/vueRouter'
import { clipboardWriteText } from '@common/utils/electron'
import { dialog } from '@renderer/plugins/Dialog'
import { useI18n } from '@renderer/plugins/i18n'
import { removeListMusics } from '@renderer/store/list/action'
import { formatMusicName, DEFAULT_MUSIC_NAME_TEMPLATE } from '@renderer/utils/index'
import { addDislikeWithCloud, hasDislike } from '@renderer/core/dislikeList'
import { playNext } from '@renderer/core/player'
import { playMusicInfo } from '@renderer/store/player/state'
import useMusicJump from '@renderer/utils/compositions/useMusicJump'


export default ({ props, list, selectedList, removeAllSelect }) => {
  const router = useRouter()
  const t = useI18n()

  // 跳转 / 分享 / 歌手选择菜单与在线歌曲表共用一份（见 useMusicJump 的注释）
  const {
    canJumpToAlbum,
    canJumpToSinger,
    handleSingerNameClick,
    handleAlbumNameClick,
    jumpToAlbum,
    jumpToSinger,
    toSongDetail,
    copyMusicLink,
    openMusicInQqMusic,
    isShowSingerPicker,
    singerPickerXy,
    singerPickerMenus,
    handleSingerPickerClick,
  } = useMusicJump()

  const handleJumpAlbum = index => {
    jumpToAlbum(list.value[index])
  }
  const handleJumpSinger = async(index, location) => {
    await jumpToSinger(list.value[index], { pageX: location?.x, pageY: location?.y })
  }
  const handleCopyLink = index => {
    copyMusicLink(list.value[index])
  }
  const handleOpenInQqMusic = index => {
    openMusicInQqMusic(list.value[index])
  }

  const handleSearch = index => {
    const info = list.value[index]
    router.push({
      path: '/search',
      query: {
        text: `${info.name} ${info.singer}`,
      },
    })
  }

  /**
   * 「歌曲详情」：进本仓的歌曲详情页（工单 03）。
   *
   * 原来这里与在线表格不同——它用 `getMusicDetailPageUrl` + `openUrl` **打开 QQ 网页**，
   * 把用户送出应用。现在与在线表格 / 下载列表共用 `useMusicJump` 的 `toSongDetail`，
   * 判据（本地文件没有在线 mid → 不进本页）与菜单项显隐（`useMenu.js` 的 sourceDetail）同源。
   */
  const handleOpenMusicDetail = index => {
    toSongDetail(list.value[index])
  }

  const handleCopyName = index => {
    const minfo = list.value[index]
    clipboardWriteText(formatMusicName(DEFAULT_MUSIC_NAME_TEMPLATE, minfo.name, minfo.singer))
  }

  const handleDislikeMusic = async(index) => {
    const minfo = list.value[index]
    const confirm = await dialog.confirm({
      message: minfo.singer ? t('lists__dislike_music_singer_tip', { name: minfo.name, singer: minfo.singer }) : t('lists__dislike_music_tip', { name: minfo.name }),
      cancelButtonText: t('cancel_button_text_2'),
      confirmButtonText: t('confirm_button_text'),
    })
    if (!confirm) return
    await addDislikeWithCloud(minfo)
    if (hasDislike(playMusicInfo.musicInfo)) {
      playNext(true)
    }
  }

  const handleRemoveMusic = async(index, single) => {
    if (selectedList.value.length && !single) {
      const confirm = await (selectedList.value.length > 1
        ? dialog.confirm({
          message: t('lists__remove_music_tip', { len: selectedList.value.length }),
          confirmButtonText: t('lists__remove_tip_button'),
        })
        : Promise.resolve(true)
      )
      if (!confirm) return
      removeListMusics({ listId: props.listId, ids: selectedList.value.map(m => m.id) })
      removeAllSelect()
    } else {
      removeListMusics({ listId: props.listId, ids: [list.value[index].id] })
    }
  }

  return {
    handleSearch,
    handleOpenMusicDetail,
    handleCopyName,
    handleDislikeMusic,
    handleRemoveMusic,
    canJumpToAlbum,
    canJumpToSinger,
    handleSingerNameClick,
    handleAlbumNameClick,
    handleJumpAlbum,
    handleJumpSinger,
    handleCopyLink,
    handleOpenInQqMusic,
    isShowSingerPicker,
    singerPickerXy,
    singerPickerMenus,
    handleSingerPickerClick,
  }
}
