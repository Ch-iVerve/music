import { computed, nextTick, reactive, ref, shallowReactive } from '@common/utils/vueTools'
import { useRouter } from '@common/utils/vueRouter'
import { clipboardWriteText } from '@common/utils/electron'
import { assertApiSupport } from '@renderer/store/utils'
import { playMusicInfo } from '@renderer/store/player/state'
import musicSdk from '@renderer/utils/musicSdk'
import { useI18n } from '@renderer/plugins/i18n'
import { dialog } from '@renderer/plugins/Dialog'
import { formatMusicName, DEFAULT_MUSIC_NAME_TEMPLATE } from '@renderer/utils'
import { addDislikeInfo, hasDislike } from '@renderer/core/dislikeList'
import { playNext } from '@renderer/core/player'
import useFavSong from '@renderer/utils/compositions/useFavSong'
import useMusicJump from '@renderer/utils/compositions/useMusicJump'

/**
 * 播放栏封面的右键菜单（当前播放这一首）。上游的做法是右击封面跳到歌曲所在列表（v2.12.6 基线），
 * 用户反馈那一下是「莫名其妙的跳转」——改成本仓统一的歌曲右键菜单（2026-09-28）。
 *
 * 菜单项、显隐判据与动作**全部沿用歌曲表那份**（`ListMusicTable/useMenu.js` + `useMusicActions.js`），
 * 这里只把「右键的那一行」换成「正在播放的这一首」：
 * - 收藏 / 加歌单：`useFavSong`（工单 06 的三处共用约定，播放栏 ControlBtns 的按钮也是它）
 * - 详情 / 跳转 / 分享：`useMusicJump`（判定与跳转在那里，本文件不重复判据）
 * - 下载可用性：`assertApiSupport(source) && source != 'local'`（与 useMenu.js:149 同式）
 * - 复制歌名：标题模板同下载命名（同歌曲表 handleCopyName）
 * - 不喜欢：确认后进名单；右键的就是正在播放的这首 → 加完跳下一首（同 useMusicActions 的口径）
 *
 * 不进这份菜单的项（相对歌曲表）：play / playLater（正在播的就是它）、moveTo / sort / remove
 * （那是列表管理，播放栏不是列表）。「定位到所在列表」由 ControlBtns 的准星键负责（工单 08）。
 */
export default () => {
  const router = useRouter()
  const t = useI18n()
  const { canFav, favTitle, toggleFav, loadFavState } = useFavSong()
  const {
    canJumpToAlbum,
    canJumpToSinger,
    canShareMusic,
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

  // 正在播放的这一首：`progress` 包装（下载列表在播）时取里面的歌，同 ControlBtns / usePlayStatus 的取法
  const currentMusic = computed(() => playMusicInfo.musicInfo == null
    ? null
    : ('progress' in playMusicInfo.musicInfo ? playMusicInfo.musicInfo.metadata.musicInfo : playMusicInfo.musicInfo))

  // 显隐判据随 showMenu 重算（同 useMenu.js 的 itemMenuControl），默认全开——没 show 过不会读
  const itemMenuControl = reactive({
    fav: true,
    addTo: true,
    download: true,
    copyName: true,
    sourceDetail: true,
    jumpAlbum: true,
    jumpSinger: true,
    copyLink: true,
    openInQq: true,
    search: true,
    dislike: true,
  })
  const menuLocation = shallowReactive({ x: 0, y: 0 })
  const isShowSongMenu = ref(false)

  const menus = computed(() => {
    return [
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
      {
        name: t('list__download'),
        action: 'download',
        disabled: !itemMenuControl.download,
      },
      {
        name: t('list__copy_name'),
        action: 'copyName',
      },
      {
        name: t('list__source_detail'),
        action: 'sourceDetail',
        // 本地文件不出现（工单 03 的同款判据：源没有 getMusicDetailPageUrl）
        hide: !itemMenuControl.sourceDetail,
      },
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
        hide: !itemMenuControl.copyLink,
      },
      {
        name: t('list__open_in_qq'),
        action: 'openInQq',
        hide: !itemMenuControl.openInQq,
      },
      {
        name: t('list__search'),
        action: 'search',
      },
      {
        name: t('list__dislike'),
        action: 'dislike',
        disabled: !itemMenuControl.dislike,
      },
    ]
  })

  const showMenu = (event) => {
    const minfo = currentMusic.value
    if (!minfo) return
    itemMenuControl.fav = canFav(minfo)
    itemMenuControl.download = assertApiSupport(minfo.source) && minfo.source != 'local'
    itemMenuControl.sourceDetail = !!musicSdk[minfo.source]?.getMusicDetailPageUrl
    itemMenuControl.jumpAlbum = canJumpToAlbum(minfo)
    itemMenuControl.jumpSinger = canJumpToSinger(minfo)
    itemMenuControl.copyLink = canShareMusic(minfo)
    itemMenuControl.openInQq = canShareMusic(minfo)
    itemMenuControl.dislike = !hasDislike(minfo)

    // 收藏态先拉回来（缓存住）：与歌曲表的 showMenu 同款，拉不到按「没收藏」显示
    loadFavState()

    menuLocation.x = event.pageX
    menuLocation.y = event.pageY
    isShowSongMenu.value = true
  }

  const hideMenu = () => {
    isShowSongMenu.value = false
  }

  const handleCopyName = () => {
    const minfo = currentMusic.value
    if (minfo) clipboardWriteText(formatMusicName(DEFAULT_MUSIC_NAME_TEMPLATE, minfo.name, minfo.singer))
  }

  const handleSearch = () => {
    const minfo = currentMusic.value
    if (!minfo) return
    router.push({
      path: '/search',
      query: {
        text: `${minfo.name} ${minfo.singer}`,
      },
    })
  }

  const handleDislikeMusic = async() => {
    const minfo = currentMusic.value
    if (!minfo) return
    const confirm = await dialog.confirm({
      message: minfo.singer ? t('lists__dislike_music_singer_tip', { name: minfo.name, singer: minfo.singer }) : t('lists__dislike_music_tip', { name: minfo.name }),
      cancelButtonText: t('cancel_button_text_2'),
      confirmButtonText: t('confirm_button_text'),
    })
    if (!confirm) return
    await addDislikeInfo([{ name: minfo.name, singer: minfo.singer }])
    // 右键的就是正在播放的这首：进名单后跳到下一首（同 useMusicActions 的口径）
    if (hasDislike(currentMusic.value)) playNext(true)
  }

  const isShowAddMusicTo = ref(false)
  const isShowDownload = ref(false)

  const menuClick = (action) => {
    hideMenu()
    if (!action || !currentMusic.value) return
    switch (action.action) {
      case 'fav':
        toggleFav(currentMusic.value)
        break
      case 'addTo':
        // 弹窗要在菜单收起之后再开：同 useMusicAdd 的 nextTick 套路
        nextTick(() => {
          isShowAddMusicTo.value = true
        })
        break
      case 'download':
        nextTick(() => {
          isShowDownload.value = true
        })
        break
      case 'copyName':
        handleCopyName()
        break
      case 'sourceDetail':
        toSongDetail(currentMusic.value)
        break
      case 'jumpAlbum':
        jumpToAlbum(currentMusic.value)
        break
      case 'jumpSinger':
        // 多位歌手时选择菜单要出现在歌曲菜单的位置上（同歌曲表 handleJumpSinger 的传法）
        jumpToSinger(currentMusic.value, { pageX: menuLocation.x, pageY: menuLocation.y })
        break
      case 'copyLink':
        copyMusicLink(currentMusic.value)
        break
      case 'openInQq':
        openMusicInQqMusic(currentMusic.value)
        break
      case 'search':
        handleSearch()
        break
      case 'dislike':
        handleDislikeMusic()
        break
    }
  }

  return {
    currentMusic,
    menus,
    menuLocation,
    isShowSongMenu,
    showMenu,
    hideMenu,
    menuClick,
    isShowAddMusicTo,
    isShowDownload,
    isShowSingerPicker,
    singerPickerXy,
    singerPickerMenus,
    handleSingerPickerClick,
  }
}
