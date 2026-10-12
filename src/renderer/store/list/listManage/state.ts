import { LIST_IDS } from '@common/constants'
import { markRaw, reactive } from '@common/utils/vueTools'

export const allMusicList: Map<string, LX.Music.MusicInfo[]> = markRaw(new Map())

// 「试听列表」（`default`）与「我的收藏」（`love`）两条固定列表都已退休（票 08 / 集合概念统一），
// 所以这里没有它们对应的 listInfo；界面上的固定列表只剩临时列表一条（队列，无页面）。
export const tempList = markRaw<LX.List.MyTempListInfo>({
  id: LIST_IDS.TEMP,
  name: '临时列表',
  meta: {},
})

export const userLists: LX.List.UserListInfo[] = reactive([])
