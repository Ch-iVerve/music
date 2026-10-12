import { useRouter } from '@common/utils/vueRouter'
import { parseUrlParams } from '@common/utils/common'
import { userLists } from '@renderer/store/list/state'
import { getListMusics } from '@renderer/store/list/action'
import usePlaySonglist from './compositions/usePlaySonglist'
import { playList } from '@renderer/core/player'

const getListPlayIndex = (list: LX.Music.MusicInfo[], indexStr?: string): number => {
  let index: number
  if (indexStr == null) {
    index = 1
  } else {
    index = parseInt(indexStr)
    if (Number.isNaN(index)) {
      index = 1
    } else {
      if (index < 1) index = 1
      else if (index > list.length) index = list.length
    }
  }
  return index - 1
}

const useInitEnvParamSearch = () => {
  const router = useRouter()

  return (search?: string) => {
    if (search == null) return
    setTimeout(() => {
      void router.replace({
        path: '/search',
        query: {
          text: search,
        },
      })
    }, 1000)
  }
}
const useInitEnvParamPlay = () => {
  // const setPlayList = useCommit('player', 'setList')

  const playSongListDetail = usePlaySonglist()

  return async(playStr?: string) => {
    if (playStr == null || typeof playStr != 'string') return
    // -play="source=kw&link=链接、ID"
    // -play="source=myList&name=名字"
    // -play="source=myList&name=名字&index=位置"
    const params = parseUrlParams(playStr)
    if (params.type != 'songList') return
    switch (params.source) {
      case 'myList':
        if (params.name != null) {
          let targetList
          // 候选里没有试听列表（ADR-0006 / 票 08 退场）与本地收藏（集合概念统一退休）：旧命令行参数
          // 按它们的名字点播会找不到目标（`targetList` 为空 → return，不去播一个不存在的列表）
          const lists = userLists
          for (const list of lists) {
            if (list.name === params.name) {
              targetList = list
              break
            }
          }
          if (!targetList) return

          playList(targetList.id, getListPlayIndex(await getListMusics(targetList.id), params.index))
        }
        break
      case 'tx':
        void playSongListDetail(params.source, params.link, parseInt(params.index))
        break
    }
  }
}

export default () => {
  // 处理启动参数 search
  const initEnvParamSearch = useInitEnvParamSearch()

  // 处理启动参数 play
  const initEnvParamPlay = useInitEnvParamPlay()

  return (envParams: LX.EnvParams) => {
    initEnvParamSearch(envParams.cmdParams.search)
    void initEnvParamPlay(envParams.cmdParams.play)
  }
}
