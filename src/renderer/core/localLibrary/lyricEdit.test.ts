import { describe, expect, it } from 'vitest'
import {
  fillWordDurations,
  linesFromPlain,
  parseLyricText,
  serializeLyricLines,
  splitWords,
} from './lyricEdit'

describe('parseLyricText', () => {
  it('标准 lrc：时间标签剥离、按时间排序', () => {
    const lines = parseLyricText('[00:02.50]第二行\n[00:01.00]第一行')
    expect(lines.map(l => l.time)).toEqual([1000, 2500])
    expect(lines.map(l => l.text)).toEqual(['第一行', '第二行'])
  })

  it('一行多时间标签拆成多行；无标签行殿后（time=-1）', () => {
    const lines = parseLyricText('[00:01.00][00:05.00]副歌\n间奏\n[00:03.00]间奏词')
    expect(lines.map(l => l.time)).toEqual([1000, 3000, 5000, -1])
    expect(lines.at(-1)!.text).toBe('间奏')
  })

  it('awlrc 逐字文本可解析（<起,时> 词元剥离，只留行时间与纯文本）', () => {
    const lines = parseLyricText('[00:01.00]<1000,300>你<1300,300>好')
    expect(lines.length).toBe(1)
    expect(lines[0].time).toBe(1000)
    expect(lines[0].text).toBe('你好')
  })
})

describe('serializeLyricLines', () => {
  it('逐行模式：time=-1 的空行丢弃、有字无轴行不带时间头输出', () => {
    const text = serializeLyricLines([
      { time: 1000, text: '第一行' },
      { time: -1, text: '' },
      { time: -1, text: '（间奏）' },
      { time: 2000, text: '第二行' },
    ], 'line')
    expect(text).toBe('[00:01.000]第一行\n（间奏）\n[00:02.000]第二行\n')
  })

  it('逐字模式：带词元行序列化为 <起,时>字；无词元行整行单字元兜底', () => {
    const text = serializeLyricLines([
      { time: 1000, text: '你好', words: [{ start: 1000, dur: 300, text: '你' }, { start: 1300, dur: 400, text: '好' }] },
      { time: 3000, text: '没打字的行' },
    ], 'word')
    expect(text).toBe('[00:01.000]<1000,300>你<1300,400>好\n[00:03.000]<3000,1000>没打字的行\n')
  })

  it('round-trip：line 模式序列化再解析，时间与文本一致', () => {
    const lines = [{ time: 1500, text: '回环' }]
    const reparsed = parseLyricText(serializeLyricLines(lines, 'line'))
    expect(reparsed[0].time).toBe(1500)
    expect(reparsed[0].text).toBe('回环')
  })
})

describe('splitWords / fillWordDurations', () => {
  it('中文按字、英文按词、空白并入前一字元', () => {
    const words = splitWords('你好 hello world', 1000)
    expect(words.map(w => w.text)).toEqual(['你', '好 ', 'hello ', 'world'])
    expect(words.every(w => w.start === 1000)).toBe(true)
  })

  it('未打轴（start=-1）的行不拆词打点（返回空数组由调用方处理）', () => {
    expect(splitWords('你好', -1).every(w => w.start === -1)).toBe(true)
  })

  it('fillWordDurations：dur = 下一起点 - 本起点，最后一个兜底 1000', () => {
    const words = splitWords('你好吗', 0).map((w, i) => ({ ...w, start: i * 500 }))
    fillWordDurations(words)
    expect(words.map(w => w.dur)).toEqual([500, 500, 1000])
  })
})

describe('linesFromPlain', () => {
  it('纯文本初始化：全部 time=-1', () => {
    const lines = linesFromPlain('第一行\n第二行')
    expect(lines).toEqual([{ time: -1, text: '第一行' }, { time: -1, text: '第二行' }])
  })
})
