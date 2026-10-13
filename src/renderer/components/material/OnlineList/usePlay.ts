// import { useCommit } from '@common/utils/vueTools'
import { addTempPlayList } from '@renderer/store/player/action'
import { appSetting } from '@renderer/store/setting'
import { type Ref } from '@common/utils/vueTools'
import { playMusicList } from '@renderer/core/player'
import { LIST_IDS } from '@common/constants'
import { ONLINE_LIST_FALLBACK_QUEUE_ID } from '@renderer/utils/queueIds'
import { hintUnavailableMusic, isUnavailableMusic } from '@renderer/core/music/unavailable'

/**
 * 播放队列的标识：宿主页传进来的 `listId`，没传时用兜底常量。
 *
 * 各宿主都传了自己的标识（有真实 id 的用真实 id：专辑 `album__<mid>`、歌单 `tx__<tid>`、
 * 榜单 `board__<id>`、云端歌单 `cloud_<dirId>`、搜索 `search__<关键词>`、歌手 `singer__songs__<mid>`…；
 * 没有真实 id 的自造稳定标识：新歌 `discover__new_songs__<type>`、我的收藏 `fav__songs`、
 * 雷达 `radar__recommend`…，见各宿主的 `:list-id`）——宿主自己的播放入口与
 * `material-online-list` 必须用**同一个值**，否则「正在播放那一行」与播放来自两个身份。
 * 这些字面量的家已收到 `@renderer/utils/queueIds`（票 06 M3），本文件只留兜底。
 *
 * ⚠️ 兜底值相等不代表内容相等：共用兜底的列表各自内容不同，认「正在播放那一行」时不能只看身份，
 * 见 `@renderer/utils/playingRowLocate` 的 `findPlayingRowIndex`。
 */
export const getQueueId = (listId?: string) => (listId?.length ? listId : ONLINE_LIST_FALLBACK_QUEUE_ID)

export default ({ selectedList, props, removeAllSelect, emit }: {
  selectedList: Ref<LX.Music.MusicInfoOnline[]>
  props: {
    list: LX.Music.MusicInfoOnline[]
    /** 播放队列的身份（宿主页的列表 id）；宿主没传时用 `getQueueId` 的兜底值 */
    listId?: string
  }
  removeAllSelect: () => void
  emit: (event: 'show-menu' | 'play-list' | 'togglePage', ...args: any[]) => void
}) => {
  let clickTime = 0
  let clickIndex = -1

  /**
   * 播放队列的标识：`tempListMeta.id`，只用于「当前播的是哪个列表」。
   * 队列内容由 `playMusicList` 每次都灌一遍，标识不参与「同列表复用」的判断。
   */
  const queueId = () => getQueueId(props.listId)

  /**
   * 点一首歌 = 从这首开始，按**它所在的列表**连播（ui-polish 工单 06 的方案 B）。
   * 之前是「把这一首加进试听列表再播那一首」，于是「下一首」会跑到试听列表攒下的杂歌上。
   *
   * 工单 01：失效曲（无版权 / 已下架）**点不动**——拦在这里（行双击、行内播放键、右键菜单的
   * 「播放」三处都走这个函数），给一句短提示而不是静默。多选播放不拦：那时播的是选中的整个
   * 队列，失效的那几首由连播自己跳过（`core/player/action.ts`）。
   */
  const handlePlayMusic = async(index: number, single: boolean) => {
    if (selectedList.value.length && !single) {
      // 多选播放：选中的这几首就是队列（每次都是新队列，标识带上时间戳以免复用旧历史）
      await playMusicList(`${queueId()}__selected_${Date.now()}`, [...selectedList.value], 0)
      removeAllSelect()
      return
    }
    if (isUnavailableMusic(props.list[index])) {
      hintUnavailableMusic()
      return
    }
    await playMusicList(queueId(), props.list, index)
  }

  const handlePlayMusicLater = (index: number, single: boolean) => {
    if (selectedList.value.length && !single) {
      addTempPlayList(selectedList.value.map(s => ({ listId: LIST_IDS.PLAY_LATER, musicInfo: s })))
      removeAllSelect()
    } else {
      addTempPlayList([{ listId: LIST_IDS.PLAY_LATER, musicInfo: props.list[index] }])
    }
  }

  const doubleClickPlay = (index: number) => {
    if (
      window.performance.now() - clickTime > 400 ||
      clickIndex !== index
    ) {
      clickTime = window.performance.now()
      clickIndex = index
      return
    }
    if (appSetting['list.isClickPlayList']) {
      emit('play-list', index)
    } else {
      void handlePlayMusic(index, true)
    }
    clickTime = 0
    clickIndex = -1
  }

  return {
    handlePlayMusic,
    handlePlayMusicLater,
    doubleClickPlay,
  }
}
