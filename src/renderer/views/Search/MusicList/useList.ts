import { ref } from '@common/utils/vueTools'
import { getPageSize } from '@common/settings/pageSize'
import { playMusicList } from '@renderer/core/player/action'
import { addHistoryWord } from '@renderer/store/search/action'
// import { useI18n } from '@renderer/plugins/i18n'
// import { } from '@renderer/store/search/state'
import { searchText } from '@renderer/store/search/state'
import { searchQueueId } from '@renderer/utils/queueIds'
import { search as searchMusic, listInfos, normalizeSource, type ListInfo } from '@renderer/store/search/music'
import { assertApiSupport } from '@renderer/store/utils'
import { appSetting } from '@renderer/store/setting'

export type SearchSource = LX.OnlineSource | 'all'

export default () => {
  const listRef = ref<any>(null)

  // 首帧占位：第一次搜索时会被 store 里那份 ListInfo 顶掉（见下面的 search），
  // 每页条数则由 store 的取数现读设置（`list.pageSize`）
  const listInfo = ref<ListInfo>({
    page: 1,
    maxPage: 0,
    limit: getPageSize(appSetting),
    total: 0,
    list: [],
    key: null,
    noItemLabel: '',
  })

  const search = (text: string, source: SearchSource, page: number) => {
    listInfo.value = listInfos[normalizeSource(source)] as ListInfo
    if (text.length) void addHistoryWord(text)
    void searchMusic(text, page, source).then((list: LX.Music.MusicInfo[]) => {
      if (list.length) {
        setTimeout(() => {
          if (listRef.value) listRef.value.scrollToTop()
        })
      }
    }).catch((err: any) => {
      // 收口：store 的 catch 是「写完可读提示（noItemLabel = list__load_failed）再把错重抛」，调用方不接
      // 就会变成未处理 rejection——dev 下 webpack-dev-server 据此弹全屏浮层（fixed; inset:0），
      // 它会吞掉真实鼠标输入（票 03b：界面看着正常却点不动）。提示已由 store 写入，这里只吞掉异常。
      console.log('[search] music', err)
    })
  }

  /**
   * 搜索结果里点一首 = 从这首开始连播**这一串搜索结果**（工单 06 方案 B）。
   * 之前是「把这一首加进试听列表再播那一首」——下一首会跑到试听列表里攒下的杂歌上。
   */
  const handlePlayList = async(index: number) => {
    const targetSong = listInfo.value.list[index]

    if (!assertApiSupport(targetSong.source)) return

    await playMusicList(searchQueueId(searchText.value), [...listInfo.value.list], index)
  }

  return {
    listRef,
    listInfo,
    search,
    handlePlayList,
  }
}
