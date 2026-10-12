/**
 * 备份导入时「把文件里的列表并到本地已有列表上」这段纯逻辑（票 08 契约 2）。
 *
 * 抽出来是为了能写回归用例（旧备份必须仍能导入），组件 `BackupBlock.vue` 只负责取数 / 落库。
 *
 * **已退休的保留列表段一律跳过**：
 * - 试听列表（`default`）：旧备份的 `playList` 里它是**第 0 项**（更老的格式甚至没有 `id`，只有位置），
 *   旧实现按位置 `shift()` 把它当成 `defaultList` 写回库里；票 08 已把这条列表从数据层删除。
 * - 本地收藏（`love`）：集合概念统一批退休（迁成自建列表「我的收藏（历史）」见 v7 迁移）。
 * - 没有 `id` 的第 0 项也一起跳过：那是老格式「第 0 项 = 试听列表」的形态，留着会被当成一条
 *   没有 id 的自建列表塞进库。
 * 剩下的段按 id 与本地自建列表匹配（新备份导出时已不含这两条保留列表）。
 */
const RETIRED_LIST_IDS: Array<string | undefined> = ['default', 'love']

/** 备份文件里的一条列表（旧格式可能没有 id / locationUpdateTime，`list` 的元素形态也随格式而异） */
export interface ImportedListInfo {
  id?: string
  name: string
  source?: LX.OnlineSource
  sourceListId?: string
  locationUpdateTime?: number | null
  list: any[]
}

/** 本地已有的一条列表（`BackupBlock.vue` 的 `getAllLists()`：全部自建列表） */
export interface LocalListInfo {
  id?: string
  name: string
  list: LX.Music.MusicInfo[]
  source?: LX.OnlineSource
  sourceListId?: string
  locationUpdateTime?: number | null
}

export interface MergedListData {
  userList: LocalListInfo[]
}

/**
 * 把导入的列表并进本地列表（就地改 `localLists`，调用方每次都会新取一份，不用复制）。
 *
 * @param localLists `getAllLists()` 的结果：全部是自建列表（保留列表已退休，没有第 0 项的特殊含义）
 * @param importedLists 备份文件里的列表数组
 * @param mapMusic 把文件里的歌曲整形成当前格式（旧格式走 `toNewMusicInfo`，新格式走 `fixNewMusicInfoQuality`）
 * @returns 可直接交给 `overwriteListFull` 的 `{ userList }`
 */
export const mergeImportedLists = (
  localLists: LocalListInfo[],
  importedLists: ImportedListInfo[],
  mapMusic: (list: any[]) => LX.Music.MusicInfo[],
): MergedListData => {
  for (const [index, list] of importedLists.entries()) {
    // 已退休的保留列表段（default/love）跳过；没有 id 的第 0 项是更老格式里「试听列表」的形态，一并跳过
    if (RETIRED_LIST_IDS.includes(list.id) || (index === 0 && list.id == null)) continue
    try {
      const targetList = localLists.find(l => l.id == list.id)
      if (targetList) {
        targetList.list = mapMusic(list.list)
      } else {
        localLists.push({
          id: list.id,
          name: list.name,
          list: mapMusic(list.list),
          source: list.source,
          sourceListId: list.sourceListId,
          locationUpdateTime: list.locationUpdateTime ?? null,
        })
      }
    } catch (err) {
      console.log(err)
    }
  }

  return { userList: localLists }
}
