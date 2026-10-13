import { setMeta } from '@common/utils/musicMeta'
import { buildLyrics } from './lrcTool'

/**
 * 写内嵌标签。**返回值必须透出 Promise**：worker 的这一层是 Comlink RPC，返回 Promise 时
 * 调用方（下载收尾的 `saveMeta`）的 await 才是真等写完——不透出的话 await 立刻过，收编会
 * 在标签还没写完时对同一个文件开跑（2026-10-13 真机：下载的歌进不了库 + `.lxmtemp` 残留）。
 */
export const writeMeta = ({ filePath, isEmbedLyricLx, isEmbedLyricT, isEmbedLyricR, ...meta }: {
  filePath: string
  isEmbedLyricLx: boolean
  isEmbedLyricT: boolean
  isEmbedLyricR: boolean
  title: string
  artist: string
  album: string
  APIC: string | null
}, lyric: LX.Music.LyricInfo, proxy?: { host: string, port: number }): Promise<void> | void => {
  return setMeta(filePath, { ...meta, lyrics: buildLyrics(lyric, isEmbedLyricLx, isEmbedLyricT, isEmbedLyricR) }, proxy)
}
