import { reactive } from '@common/utils/vueTools'

export interface Line {
  text: string
  time: number
  extendedLyrics: string[]
  dom_line: HTMLDivElement
}

export const lyric = reactive<{
  lines: Line[]
  text: string
  line: number
  offset: number // 歌词延迟
  tempOffset: number // 歌词临时延迟
  isLoading: boolean // 对齐窗口：切歌已清零 lines 但新歌歌词未落定，「有没有歌词」还不能下结论
}>({
  lines: [],
  text: '',
  line: 0,
  offset: 0, // 歌词延迟
  tempOffset: 0, // 歌词临时延迟
  isLoading: false,
})

export const setLines = (lines: Line[]) => {
  if (!lines.length && !lyric.lines.length) return
  lyric.lines = lines
}
export const setText = (text: string, line: number) => {
  lyric.text = text
  lyric.line = line
}
export const setOffset = (offset: number) => {
  lyric.offset = offset
}
export const setTempOffset = (offset: number) => {
  lyric.tempOffset = offset
}
export const setLoading = (isLoading: boolean) => {
  lyric.isLoading = isLoading
}
