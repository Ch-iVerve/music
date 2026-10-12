import { LIST_IDS } from '@common/constants'
import { arrPush, arrPushByPosition, arrUnshift } from '@common/utils/common'
import {
  deleteUserLists,
  insertUserLists,
  insertMusicInfoList,
  insertMusicInfoListAndRefreshOrder,
  moveMusicInfo,
  moveMusicInfoAndRefreshOrder,
  overwriteListData,
  overwriteMusicInfo,
  queryAllUserList,
  queryMusicInfoByListId,
  queryMusicInfoByListIdAndMusicInfoId,
  queryMusicInfoByMusicInfoId,
  removeMusicInfoByListId,
  removeMusicInfos,
  updateMusicInfoOrder,
  updateMusicInfos,
  updateUserLists as updateUserListsFromDB,
  getMusicInfoOrder,
} from './dbHelper'

let userLists: LX.DBService.UserListInfo[]
let musicLists = new Map<string, LX.Music.MusicInfo[]>()
let rawPoss = new Map<string, number>()

const toDBMusicInfo = (musicInfos: LX.Music.MusicInfo[], listId: string, offset: number = 0): LX.DBService.MusicInfo[] => {
  return musicInfos.map((info, index) => {
    return {
      ...info,
      listId,
      meta: JSON.stringify(info.meta),
      order: offset + index,
    }
  })
}

/**
 * 获取所有用户列表
 * @returns
 */
export const getAllUserList = (): LX.List.UserListInfo[] => {
  userLists ??= queryAllUserList()

  rawPoss.clear()
  return userLists.map(list => {
    const { position, ...newList } = list
    rawPoss.set(list.id, position)
    return newList
  })
}

/**
 * 批量创建列表
 * @param position 列表位置
 * @param lists 列表信息
 */
export const createUserLists = (position: number, lists: LX.List.UserListInfo[]) => {
  userLists ??= queryAllUserList()
  if (position < 0 || position >= userLists.length) {
    // 如果是最末尾，那么取最后一个列表的原始位置 + 1 作为新列表的原始位置，否则新列表的原始位置为 position
    // 因为原始 pos 可能比 userLists.length 大，所以不能直接用 userLists.length 作为新列表的原始位置
    const order = userLists.length ? (rawPoss.get(userLists.at(-1)!.id) ?? userLists.length) + 1 : 0
    const newLists: LX.DBService.UserListInfo[] = lists.map((list, index) => {
      const pos = order + index
      rawPoss.set(list.id, pos)
      return {
        ...list,
        position: pos,
      }
    })
    insertUserLists(newLists)
    userLists = [...userLists, ...newLists]
  } else {
    const newUserLists = [...userLists]
    // @ts-expect-error
    newUserLists.splice(position, 0, ...lists)
    newUserLists.forEach((list, index) => {
      list.position = index
    })
    insertUserLists(newUserLists, true)
    userLists = newUserLists
    rawPoss.clear()
    for (const list of userLists) rawPoss.set(list.id, list.position)
  }
}

/**
 * 覆盖列表
 * @param lists 列表信息
 */
// const setUserLists = (lists: LX.List.UserListInfo[]) => {
//   const newUserLists: LX.DBService.UserListInfo[] = lists.map((list, index) => {
//     return {
//       ...list,
//       position: index,
//     }
//   })
//   insertUserLists(newUserLists, true)
//   userLists = newUserLists
// }

/**
 * 批量删除列表
 * @param ids 列表ids
 */
export const removeUserLists = (ids: string[]) => {
  deleteUserLists(ids)
  userLists &&= queryAllUserList()
  for (const id of ids) rawPoss.delete(id)
}

/**
 * 批量更新列表信息
 * @param lists 列表信息
 */
export const updateUserLists = (lists: LX.List.UserListInfo[]) => {
  const positionMap = new Map<string, number>()
  for (const list of userLists) {
    positionMap.set(list.id, list.position)
  }
  const dbList: LX.DBService.UserListInfo[] = lists.map(list => {
    const position = positionMap.get(list.id)
    if (position == null) return null
    return {
      ...list,
      position,
    }
  }).filter(Boolean) as LX.DBService.UserListInfo[]
  updateUserListsFromDB(dbList)
  userLists &&= queryAllUserList()
}

/**
 * 批量更新列表位置
 * @param position 列表位置
 * @param ids 列表ids
 */
export const updateUserListsPosition = (position: number, ids: string[]) => {
  userLists ??= queryAllUserList()

  const newUserLists = [...userLists]

  const updateLists: LX.DBService.UserListInfo[] = []

  for (let i = newUserLists.length - 1; i >= 0; i--) {
    if (ids.includes(newUserLists[i].id)) {
      const list = newUserLists.splice(i, 1)[0]
      list.locationUpdateTime = Date.now()
      updateLists.push(list)
    }
  }
  position = Math.min(newUserLists.length, position)

  newUserLists.splice(position, 0, ...updateLists)
  newUserLists.forEach((list, index) => {
    list.position = index
  })
  insertUserLists(newUserLists, true)
  userLists = newUserLists
  rawPoss.clear()
  for (const list of userLists) rawPoss.set(list.id, list.position)
}

/**
 * 根据列表ID获取列表内歌曲
 * @param listId 列表ID
 * @returns 列表内歌曲
 */
export const getListMusics = (listId: string): LX.Music.MusicInfo[] => {
  let targetList: LX.Music.MusicInfo[] | undefined = musicLists.get(listId)
  if (targetList == null) {
    targetList = queryMusicInfoByListId(listId).map(info => {
      return {
        id: info.id,
        name: info.name,
        singer: info.singer,
        source: info.source,
        interval: info.interval,
        meta: JSON.parse(info.meta),
      }
    })
    musicLists.set(listId, targetList)
  }

  return targetList
}

/**
 * 覆盖列表内的歌曲
 * @param listId 列表id
 * @param musicInfos 歌曲列表
 */
export const musicOverwrite = (listId: string, musicInfos: LX.Music.MusicInfo[]) => {
  let targetList = getListMusics(listId)
  overwriteMusicInfo(listId, toDBMusicInfo(musicInfos, listId))
  if (targetList) {
    targetList.splice(0, targetList.length)
    arrPush(targetList, musicInfos)
  }
}

/**
 * 批量添加歌曲
 * @param listId 列表id
 * @param musicInfos 添加的歌曲信息
 * @param addMusicLocationType 添加在到列表的位置
 */
export const musicsAdd = (listId: string, musicInfos: LX.Music.MusicInfo[], addMusicLocationType: LX.AddMusicLocationType) => {
  let targetList = getListMusics(listId)

  const set = new Set<string>()
  for (const item of targetList) set.add(item.id)
  musicInfos = musicInfos.filter(item => {
    if (set.has(item.id)) return false
    set.add(item.id)
    return true
  })

  switch (addMusicLocationType) {
    case 'top':
      insertMusicInfoListAndRefreshOrder(toDBMusicInfo(musicInfos, listId), listId, toDBMusicInfo(targetList, listId, musicInfos.length))
      arrUnshift(targetList, musicInfos)
      break
    case 'bottom':
    default: {
      // 如果是添加到最后，那么取最后一个歌曲的原始位置 + 1 作为新歌曲的原始位置，否则新歌曲的原始位置为 position
      // 因为原始 pos 可能比 targetList.length 大，所以不能直接用 targetList.length 作为新歌曲的原始位置
      const order = targetList.length ? (getMusicInfoOrder(listId, targetList.at(-1)!.id)?.order ?? targetList.length) + 1 : 0
      insertMusicInfoList(toDBMusicInfo(musicInfos, listId, order))
      arrPush(targetList, musicInfos)
      break
    }
  }
}

/**
 * 批量删除歌曲
 * @param listId 列表Id
 * @param ids 要删除歌曲的id
 */
export const musicsRemove = (listId: string, ids: string[]) => {
  let targetList = getListMusics(listId)
  if (!targetList.length) return
  removeMusicInfos(listId, ids)
  const idsSet = new Set<string>(ids)
  musicLists.set(listId, targetList.filter(mInfo => !idsSet.has(mInfo.id)))
}

/**
 * 批量移动歌曲
 * @param fromId 源列表id
 * @param toId 目标列表id
 * @param musicInfos 添加的歌曲信息
 * @param addMusicLocationType 添加在到列表的位置
 */
export const musicsMove = (fromId: string, toId: string, musicInfos: LX.Music.MusicInfo[], addMusicLocationType: LX.AddMusicLocationType) => {
  let fromList = getListMusics(fromId)
  let toList = getListMusics(toId)

  const ids = musicInfos.map(musicInfo => musicInfo.id)

  let listSet = new Set<string>()
  for (const item of toList) listSet.add(item.id)
  musicInfos = musicInfos.filter(item => {
    if (listSet.has(item.id)) return false
    listSet.add(item.id)
    return true
  })

  switch (addMusicLocationType) {
    case 'top':
      moveMusicInfoAndRefreshOrder(fromId, ids, toId, toDBMusicInfo(musicInfos, toId), toDBMusicInfo(toList, toId, musicInfos.length))
      arrUnshift(toList, musicInfos)
      break
    case 'bottom':
    default:{
      // 如果是添加到最后，那么取最后一个歌曲的原始位置 + 1 作为新歌曲的原始位置，否则新歌曲的原始位置为 position
      // 因为原始 pos 可能比 targetList.length 大，所以不能直接用 targetList.length 作为新歌曲的原始位置
      const order = toList.length ? (getMusicInfoOrder(toId, toList.at(-1)!.id)?.order ?? toList.length) + 1 : 0
      moveMusicInfo(fromId, ids, toDBMusicInfo(musicInfos, toId, order))
      arrPush(toList, musicInfos)
      break
    }
  }

  listSet = new Set<string>(ids)
  musicLists.set(fromId, fromList.filter(mInfo => !listSet.has(mInfo.id)))
}

/**
 * 批量更新歌曲信息
 * @param musicInfos 歌曲&列表信息
 */
export const musicsUpdate = (musicInfos: LX.List.ListActionMusicUpdate) => {
  updateMusicInfos(musicInfos.map(({ id, musicInfo }) => {
    return {
      ...musicInfo,
      listId: id,
      meta: JSON.stringify(musicInfo.meta),
      order: 0,
    }
  }))
  for (const { id, musicInfo } of musicInfos) {
    const targetList = musicLists.get(id)
    if (targetList == null) continue
    const targetMusic = targetList.find(item => item.id == musicInfo.id)
    if (!targetMusic) continue
    targetMusic.name = musicInfo.name
    targetMusic.singer = musicInfo.singer
    targetMusic.source = musicInfo.source
    targetMusic.interval = musicInfo.interval
    targetMusic.meta = musicInfo.meta
  }
}

/**
 * 清空列表内的歌曲
 * @param listId 列表Id
 */
export const musicsClear = (ids: string[]) => {
  removeMusicInfoByListId(ids)
  for (const id of ids) {
    const targetList = musicLists.get(id)
    if (!targetList) continue
    targetList.splice(0, targetList.length)
  }
}

/**
 * 批量更新歌曲位置
 * @param listId 列表id
 * @param position 新位置
 * @param ids 要更新位置的歌曲id
 */
export const musicsPositionUpdate = (listId: string, position: number, ids: string[]) => {
  let targetList = getListMusics(listId)
  if (!targetList.length) return

  let newTargetList = [...targetList]

  const infos: LX.Music.MusicInfo[] = []
  const map = new Map<string, LX.Music.MusicInfo>()
  for (const item of newTargetList) map.set(item.id, item)
  for (const id of ids) {
    infos.push(map.get(id)!)
    map.delete(id)
  }
  newTargetList = newTargetList.filter(mInfo => map.has(mInfo.id))
  arrPushByPosition(newTargetList, infos, Math.min(position, newTargetList.length))

  updateMusicInfoOrder(listId, newTargetList.map((info, index) => {
    return {
      listId,
      musicInfoId: info.id,
      order: index,
    }
  }))
  musicLists.set(listId, newTargetList)
}

/**
 * 丢弃旧式本地条目（`source='local'` 且 `meta.trackId` 缺失 / 与 id 不符的绝对路径直读形态）。
 *
 * 这类条目已随集合概念统一退休（库里由 v7 迁移清除）：落库入口（同步载荷、旧备份导入）再兜一道，
 * 保证库里永远只出现托管条目（`trackId` = 哈希 = id）。口径是**丢弃**不是报错——旧端 / 旧备份
 * 送进来就当没看见。
 */
const dropLegacyLocalEntries = (musics: LX.Music.MusicInfo[]): LX.Music.MusicInfo[] =>
  musics.filter(music => {
    if (music.source != 'local') return true
    // `source != 'local'` 已把 `music` 收窄成 MusicInfoLocal（判别式联合），meta 上直接有 trackId
    const trackId = music.meta.trackId
    return trackId != null && String(trackId) == music.id
  })

/**
 * 覆盖所有列表数据
 * @param myListData 完整列表数据
 *
 * 注意入参形状：**旧版同步 / 旧备份的载荷里多 `defaultList` / `loveList` 键**（试听列表与本地收藏，
 * 均已退休）。这里只按名字取 `userList` / `tempList`，多出来的键自然被忽略——这正是「旧同步数据
 * 拉取仍能跑通」的落点，别改成按位置解构或对多出来的键报错。
 */
export const listDataOverwrite = (myListData: MakeOptional<LX.List.ListDataFull, 'tempList'>) => {
  const dbLists: LX.DBService.UserListInfo[] = []
  const listData: LX.List.ListDataFull = {
    ...myListData,
    // 旧式本地条目一律丢弃（见 dropLegacyLocalEntries）：下游（落库 + 内存缓存）都用过滤后的数据
    userList: myListData.userList.map(list => ({ ...list, list: dropLegacyLocalEntries(list.list) })),
    tempList: dropLegacyLocalEntries(myListData.tempList ?? getListMusics(LIST_IDS.TEMP)),
  }

  const dbMusicInfos: LX.DBService.MusicInfo[] = [
    ...toDBMusicInfo(listData.tempList, LIST_IDS.TEMP),
  ]
  listData.userList.forEach(({ list, ...listInfo }, index) => {
    dbLists.push({ ...listInfo, position: index })
    arrPush(dbMusicInfos, toDBMusicInfo(list, listInfo.id))
  })
  overwriteListData(dbLists, dbMusicInfos)

  if (userLists) userLists.splice(0, userLists.length, ...dbLists)
  else userLists = dbLists

  rawPoss.clear()
  for (const list of userLists) rawPoss.set(list.id, list.position)
  musicLists.clear()
  musicLists.set(LIST_IDS.TEMP, listData.tempList)
  for (const list of listData.userList) musicLists.set(list.id, list.list)
}

/**
 * 检查音乐是否存在列表中
 * @param listId 列表id
 * @param musicInfoId 音乐id
 * @returns
 */
export const checkListExistMusic = (listId: string, musicInfoId: string): boolean => {
  const musicInfo = queryMusicInfoByListIdAndMusicInfoId(listId, musicInfoId)
  return musicInfo != null
}

/**
 * 获取所有存在该音乐的列表id
 * @param musicInfoId 音乐id
 * @returns
 */
export const getMusicExistListIds = (musicInfoId: string): string[] => {
  const musicInfos = queryMusicInfoByMusicInfoId(musicInfoId)
  return musicInfos.map(m => m.listId)
}
