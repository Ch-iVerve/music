export interface MusicMeta {
  title: string
  artist: string | null
  album: string | null
  APIC: string | null
  lyrics: string | null
}
/** 写内嵌标签；mp3/flac 返回「写完落盘」的 Promise，未知格式返回 undefined */
export function setMeta(filePath: string, meta: MusicMeta, proxy?: { host: string, port: number }): Promise<void> | void
