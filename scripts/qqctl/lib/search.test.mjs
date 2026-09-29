import { describe, expect, it } from 'vitest'
import { norm, pickBest, stripEm, toSongRow } from './search.mjs'

// pickBest 吃 search() 的整形行；测试里从原始网关行形状过一遍 toSongRow 造数
const rawRow = (id, name, singers, type = 0, album) => ({
  id,
  type,
  name,
  singer: singers.map(n => ({ name: n })),
  album: album ? { name: album } : undefined,
})
const row = (...args) => toSongRow(rawRow(...args))

describe('toSongRow / stripEm / norm', () => {
  it('songType 取 QQ 原始 type，缺省 0；album 缺失给空串', () => {
    expect(toSongRow(rawRow(1, 'A', ['S'], 13, 'AL'))).toMatchObject({ songId: 1, songType: 13, song: 'A', singer: 'S', album: 'AL' })
    expect(toSongRow(rawRow(2, 'B', ['S']))).toMatchObject({ songType: 0, album: '' })
  })

  it('高亮标签清干净；norm 压空白、统一小写', () => {
    expect(stripEm('雨夜<em>曼彻斯特</em>')).toBe('雨夜曼彻斯特')
    expect(norm(' New  BOY ')).toBe('newboy')
  })
})

describe('pickBest 打分（2026-09-28 实战口径）', () => {
  it('歌名全等 + 歌手全等 = 22，高置信', () => {
    const { confident, best } = pickBest([row(9, '山雀', ['万能青年旅店'])], '万能青年旅店', '山雀')
    expect(confident).toBe(true)
    expect(best.score).toBe(22)
    expect(best.songId).toBe(9)
  })

  it('歌手带「乐队」后缀只含不等 = 21，不高置信——必须交人工定案', () => {
    const { confident, best } = pickBest([row(5, '仙儿', ['二手玫瑰乐队'])], '二手玫瑰', '仙儿')
    expect(best.score).toBe(21)
    expect(confident).toBe(false)
  })

  it('英文歌名大小写/空白差异不误伤（New Boy vs new  boy）', () => {
    const { confident } = pickBest([row(7, 'New Boy', ['盘尼西林乐队'])], '盘尼西林', 'New Boy')
    expect(confident).toBe(false) // 歌名方向全等（20 分），但歌手是「乐队」后缀只含不等（+1）= 21
    const { confident: confident2, best } = pickBest([row(7, 'New Boy', ['盘尼西林'])], '盘尼西林', 'new  boy')
    expect(best.score).toBe(22)
    expect(confident2).toBe(true)
  })

  it('歌名不同名但含关键词、歌手对得上：低分不高置信（避免加错版本）', () => {
    const { confident, best } = pickBest(
      [row(3, '南方高速 Southern Highway', ['盘尼西林乐队'])],
      '盘尼西林', '南方高速',
    )
    expect(best.score).toBe(11)
    expect(confident).toBe(false)
  })

  it('现场/综艺专辑降权：正式专辑版排到 live 版前面（2026-09-29 用户要求「能用专辑要用专辑」）', () => {
    const { best, candidates, confident } = pickBest([
      row(1, 'New Boy', ['盘尼西林乐队'], 0, '乐队的夏天 第5期'),
      row(2, 'New Boy', ['盘尼西林乐队'], 0, '群星闪耀时'),
    ], '盘尼西林', 'New Boy')
    expect(candidates[0].songId).toBe(2) // live 版 -5，正式版排前
    expect(best.score).toBe(21)
    expect(confident).toBe(false) // 乐队后缀照旧交人工——降权只管排序，不松置信阈值
    const { confident: confident2, best: best2 } = pickBest([
      row(1, '山雀', ['万能青年旅店'], 0, '乐队的夏天'),
      row(2, '山雀', ['万能青年旅店'], 0, '冀西南林路行'),
    ], '万能青年旅店', '山雀')
    expect(confident2).toBe(true)
    expect(best2.songId).toBe(2)
  })

  it('候选按分数降序、最多 5 条；空列表给不出 best 且不高置信', () => {
    const { confident, best, candidates } = pickBest(
      [row(1, 'B', ['X']), row(2, 'A', ['万能青年旅店'], 0, undefined)],
      '万能青年旅店', 'A',
    )
    expect(candidates[0].songId).toBe(2)
    expect(candidates).toHaveLength(2)
    expect(confident).toBe(true)
    expect(best.score).toBe(22)

    const empty = pickBest([], '任何人', '任何歌')
    expect(empty.confident).toBe(false)
    expect(empty.best).toBeNull()
    expect(empty.candidates).toHaveLength(0)
  })
})
