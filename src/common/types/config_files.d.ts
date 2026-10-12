declare namespace LX {
  namespace ConfigFile {
    interface MyListInfoPart {
      type: 'playListPart_v2'
      data: LX.List.MyDefaultListInfoFull | LX.List.UserListInfoFull
    }

  }
}
