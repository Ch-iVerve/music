import { useRouter } from '@common/utils/vueRouter'
import { addDislikeWithCloud, hasDislike } from '@renderer/core/dislikeList'
import { playNext } from '@renderer/core/player'
import { playMusicInfo } from '@renderer/store/player/state'
import { dialog } from '@renderer/plugins/Dialog'
import { useI18n } from '@renderer/plugins/i18n'
import useMusicJump from '@renderer/utils/compositions/useMusicJump'


export default ({ props }) => {
  const router = useRouter()
  const t = useI18n()

  // 跳转 / 分享 / 歌手选择菜单与本地列表歌曲表共用一份（见 useMusicJump 的注释）
  const {
    canJumpToAlbum,
    canJumpToSinger,
    canShareMusic,
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

  const handleSearch = index => {
    const info = props.list[index]
    router.push({
      path: '/search',
      query: {
        text: `${info.name} ${info.singer}`,
      },
    })
  }

  /**
   * 「歌曲详情」：进本仓的歌曲详情页（`/songDetail?source=…&mid=…`，工单 09）。
   *
   * 原来这一项是 `getMusicDetailPageUrl` + `openUrl`——**打开 QQ 的网页**，等于把用户送出应用。
   * 工单 03 起本地列表与下载列表也走 `useMusicJump` 的同一个 `toSongDetail`，
   * 这里只负责「当前是哪一首」（`props.list`）；mid / 本地源判定都在那边。
   */
  const handleOpenMusicDetail = index => {
    toSongDetail(props.list[index])
  }

  const handleDislikeMusic = async(index) => {
    const minfo = props.list[index]
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


  // 右键菜单里的「跳转至专辑 / 歌手」：专辑有 mid 直接跳；歌手要现取 mid（取不到会在
  // jumpToSinger 里弹提示），多位歌手时在菜单处列出让用户挑（位置沿用行菜单的位置）
  const handleJumpAlbum = index => {
    jumpToAlbum(props.list[index])
  }
  const handleJumpSinger = async(index, location) => {
    await jumpToSinger(props.list[index], { pageX: location?.x, pageY: location?.y })
  }
  const handleCopyLink = index => {
    copyMusicLink(props.list[index])
  }
  const handleOpenInQqMusic = index => {
    openMusicInQqMusic(props.list[index])
  }

  return {
    handleSearch,
    handleOpenMusicDetail,
    handleDislikeMusic,
    canJumpToAlbum,
    canJumpToSinger,
    canShareMusic,
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
