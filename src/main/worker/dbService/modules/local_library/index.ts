import { addTracks, countTracks, queryAllTracks, queryTracksByIds, removeTracks, updateTrackWithReferences } from './dbHelper'

/**
 * 本地媒体库的持久化域（票 01）。
 *
 * 只做「存与取 + 引用行联动」：文件托管、tag 解析、封面/歌词内嵌都在渲染侧 worker 的库服务里
 * （票 02 起），这里不碰文件系统。读接口同步返回（Comlink 包成 Promise 交给调用方），
 * 写接口也不标 `async`——与 `music_url`/`follow_feed` 域的既有形状一致。
 */

/** 批量写曲目（撞已有哈希的行保留首见，见 dbHelper） */
export const localLibraryAdd = (rows: LX.LocalLibrary.TrackInput[]) => {
  addTracks(rows)
}

/** 读全部曲目（默认按名称排序；视图的排序/分组在渲染侧其上再做） */
export const localLibraryAll = (): LX.LocalLibrary.Track[] => queryAllTracks()

/** 按哈希批量读（不存在的 id 静默略过） */
export const localLibraryGetByIds = (ids: string[]): LX.LocalLibrary.Track[] => queryTracksByIds(ids)

/**
 * 更新曲目并同事务同步引用歌单行（spec D4）。
 * 返回是否真的改到行（更新不存在的哈希 = `false`，调用方据此提示而不是假装成功）。
 */
export const localLibraryUpdate = (track: LX.LocalLibrary.Track): boolean => updateTrackWithReferences(track)

/** 移除曲目（级联清引用条目行与排序行；媒体目录中的文件由渲染侧库服务负责删，票 03/07） */
export const localLibraryRemove = (ids: string[]) => {
  removeTracks(ids)
}

/** 曲目总数 */
export const localLibraryCount = (): number => countTracks()
