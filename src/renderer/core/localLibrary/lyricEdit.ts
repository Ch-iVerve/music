/**
 * 歌词编辑的数据模型与序列化（票 09，spec D12）——**纯函数**，单测直接跑。
 *
 * 两种模式共用一套行模型：
 * - 逐行（lrc）：`[mm:ss.xx]歌词`；
 * - 逐字（LX awlrc 逐字格式）：`[mm:ss.xx]<起,时长>字<起,时长>字…`——播放器侧的
 *   `parseLyric`（worker/music.ts）对 awlrc 的判定是「每行都带 `<数字,数字>`」，序列化保证满足。
 * 时间一律毫秒（int）；文本行模型里的空文本行保留（占位空行）。
 */

export interface LyricWord {
  start: number
  dur: number
  text: string
}

export interface LyricLine {
  /** 行起始时间（毫秒；未打轴 = -1） */
  time: number
  text: string
  /** 逐字模式的字元（仅该模式下序列化使用） */
  words?: LyricWord[]
}

export type LyricMode = 'line' | 'word'

const TIME_RX = /\[(\d{1,3}):(\d{1,2})(?:\.(\d{1,3}))?\]/g

const toMs = (min: string, sec: string, frac?: string): number => {
  const fraction = frac == null ? 0 : Number(frac.padEnd(3, '0').slice(0, 3))
  return Number(min) * 60_000 + Number(sec) * 1000 + fraction
}

const formatTime = (ms: number): string => {
  const min = Math.floor(ms / 60_000)
  const sec = Math.floor((ms % 60_000) / 1000)
  const frac = Math.floor(ms % 1000)
  return `[${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(frac).padStart(3, '0')}]`
}

/** 解析 lrc/awlrc 文本为行模型（每行取**最小**时间标签排序；无时间标签的行 time=-1 按原序殿后；
 *  awlrc 词元 `<起,时>` 一并剥离——词级时间在重新打轴时重建） */
export const parseLyricText = (text: string): LyricLine[] => {
  const lines: LyricLine[] = []
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const times: number[] = []
    TIME_RX.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = TIME_RX.exec(raw)) != null) times.push(toMs(match[1], match[2], match[3]))
    const content = raw.replace(TIME_RX, '').replace(/<\d+,\d+>/g, '').trim()
    if (!times.length) {
      lines.push({ time: -1, text: raw.trim() })
      continue
    }
    for (const time of times) lines.push({ time, text: content })
  }
  return lines
    .map((line, index) => ({ line, index }))
    .sort((a, b) => {
      if (a.line.time === -1) return 1
      if (b.line.time === -1) return -1
      return a.line.time - b.line.time || a.index - b.index
    })
    .map(entry => entry.line)
}

/** 行模型 → lrc/awlrc 文本。逐字模式里没有字元的行：整行按单字元落盘（dur=1000 兜底） */
export const serializeLyricLines = (lines: LyricLine[], mode: LyricMode): string => {
  const out: string[] = []
  for (const line of lines) {
    if (line.time < 0 && !line.text) continue
    const head = line.time < 0 ? '' : formatTime(line.time)
    if (mode == 'word' && line.words?.length) {
      const words = line.words.map(w => `<${Math.max(0, Math.round(w.start))},${Math.max(0, Math.round(w.dur))}>${w.text}`).join('')
      out.push(`${head}${words}`)
      continue
    }
    if (mode == 'word' && line.time >= 0) {
      out.push(`${head}<${line.time},1000>${line.text}`)
      continue
    }
    if (!line.text) continue
    out.push(`${head}${line.text}`)
  }
  return `${out.join('\n')}\n`
}

/** 从纯文本歌词（无时间轴）初始化编辑模型：按行拆分、time=-1 待打轴 */
export const linesFromPlain = (text: string): LyricLine[] =>
  text.split(/\r\n|\r|\n/).map(line => ({ time: -1, text: line.trim() }))

/** 从整行文本拆字元（逐字模式的初始化；英文按词、中文按字，空白并入前一词） */
export const splitWords = (text: string, lineStart: number): LyricWord[] => {
  const tokens = text.match(/[\u4e00-\u9fff\u3040-\u30ff]|\S+|\s+/g) ?? []
  const words: LyricWord[] = []
  let pendingSpace = ''
  for (const token of tokens) {
    if (/^\s+$/.test(token)) {
      // 空白并入前一个字元（不打点对象），避免「打点打到空格」
      if (words.length) words[words.length - 1].text += token
      else pendingSpace += token
      continue
    }
    words.push({ start: lineStart < 0 ? -1 : lineStart, dur: 0, text: pendingSpace + token })
    pendingSpace = ''
  }
  return words
}

/** 打轴后按顺序补时长：每字 dur = 下一起点 - 本起点（最后一个兜底 1000ms） */
export const fillWordDurations = (words: LyricWord[]): void => {
  for (let i = 0; i < words.length; i++) {
    const current = words[i]
    const next = words[i + 1]
    current.dur = next ? Math.max(0, next.start - current.start) : 1000
  }
}
