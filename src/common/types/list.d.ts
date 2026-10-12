declare namespace LX {
  namespace List {
    interface UserListInfo {
      id: string
      name: string
      // list: LX.Music.MusicInfo[]
      source?: LX.OnlineSource
      sourceListId?: string
      // position?: number
      locationUpdateTime: number | null
    }

    /**
     * 「试听列表」（`LIST_IDS.DEFAULT`）的历史类型：界面已退场（ADR-0006），数据行也已删除（票 08）。
     * 只留给**旧备份/旧同步载荷的兼容读取**（`config_files.d.ts` 的老文件格式）与注释里的历史对照，
     * 应用当前的数据结构里不再有这条列表。
     *
     * `name` 仍写成当初的 i18n key（四语文件里的 `list__name_default` 已随数据层一起删掉）：
     * 这是**旧文件里出现过的字符串**，保留它只为把历史形状记准，没有任何运行时消费者。
     */
    interface MyDefaultListInfo {
      id: 'default'
      name: 'list__name_default'
      // name: '试听列表'
      // list: LX.Music.MusicInfo[]
    }

    interface MyTempListInfo {
      id: 'temp'
      name: '临时列表'
      // list: LX.Music.MusicInfo[]
      // TODO: save default lists info
      meta: {
        id?: string
      }
    }

    type SearchHistoryList = string[]
    type ListPositionInfo = Record<string, number>
    type ListUpdateInfo = Record<string, {
      updateTime: number
      isAutoUpdate: boolean
    }>

    type ListActionDataOverwrite = MakeOptional<LX.List.ListDataFull, 'tempList'>
    interface ListActionAdd {
      position: number
      listInfos: UserListInfo[]
    }
    type ListActionRemove = string[]
    type ListActionUpdate = UserListInfo[]
    interface ListActionUpdatePosition {
      /**
       * 列表id
       */
      ids: string[]
      /**
       * 位置
       */
      position: number
    }

    interface ListActionMusicAdd {
      id: string
      musicInfos: LX.Music.MusicInfo[]
      addMusicLocationType: LX.AddMusicLocationType
    }

    interface ListActionMusicMove {
      fromId: string
      toId: string
      musicInfos: LX.Music.MusicInfo[]
      addMusicLocationType: LX.AddMusicLocationType
    }

    interface ListActionCheckMusicExistList {
      listId: string
      musicInfoId: string
    }

    interface ListActionMusicRemove {
      listId: string
      ids: string[]
    }

    type ListActionMusicUpdate = Array<{
      id: string
      musicInfo: LX.Music.MusicInfo
    }>

    interface ListActionMusicUpdatePosition {
      listId: string
      position: number
      ids: string[]
    }

    interface ListActionMusicOverwrite {
      listId: string
      musicInfos: LX.Music.MusicInfo[]
    }

    type ListActionMusicClear = string[]

    interface MyDefaultListInfoFull extends MyDefaultListInfo {
      list: LX.Music.MusicInfo[]
    }
    interface UserListInfoFull extends UserListInfo {
      list: LX.Music.MusicInfo[]
    }
    interface MyTempListInfoFull extends MyTempListInfo {
      list: LX.Music.MusicInfo[]
    }

    interface ListDataFull {
      userList: UserListInfoFull[]
      tempList: LX.Music.MusicInfo[]
    }
  }
}
