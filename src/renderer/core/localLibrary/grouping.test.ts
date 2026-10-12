import { describe, expect, it } from 'vitest'
import { filterLibraryTracks, groupLibraryTracks, type LibraryTrack } from './grouping'

/**
 * 分组/过滤纯函数的行为测试（票 05）。行序、未知组归位、折叠语义、搜索叠加——全是外部可见契约。
 */

const track = (id: string, overrides: Partial<LibraryTrack> = {}): LibraryTrack => ({
  id,
  name: `song_${id}`,
  singer: '歌手甲',
  album: '专辑一',
  interval: '03:00',
  ext: 'mp3',
  size: 1,
  year: '2020',
  genre: 'pop',
  trackNum: '1',
  discNum: '1',
  hasPic: false,
  hasLyric: false,
  importedAt: 0,
  origin: 'import',
  ...overrides,
})

describe('filterLibraryTracks', () => {
  const tracks = [
    track('a', { name: '晴天', singer: '周杰伦', album: '叶惠美' }),
    track('b', { name: '七里香', singer: '周杰伦', album: '七里香' }),
    track('c', { name: '突然好想你', singer: '五月天', album: '后青春期的诗' }),
  ]

  it('歌名/歌手/专辑子串命中（大小写不敏感）', () => {
    expect(filterLibraryTracks(tracks, '周杰伦').map(t => t.id)).toEqual(['a', 'b'])
    expect(filterLibraryTracks(tracks, '突然').map(t => t.id)).toEqual(['c'])
    expect(filterLibraryTracks(tracks, '叶惠美').map(t => t.id)).toEqual(['a'])
  })

  it('空查询与无命中：原样返回 / 空数组', () => {
    expect(filterLibraryTracks(tracks, '  ')).toHaveLength(3)
    expect(filterLibraryTracks(tracks, '不存在的歌')).toEqual([])
  })
})

describe('groupLibraryTracks', () => {
  const tracks = [
    track('a', { singer: '乙', album: 'B', year: '2021', ext: 'flac', genre: 'rock' }),
    track('b', { singer: '甲', album: 'A', year: '2019', ext: 'mp3', genre: 'pop' }),
    track('c', { singer: '乙', album: 'A', year: '2021', ext: 'mp3', genre: 'pop' }),
    track('d', { singer: null as unknown as string, album: null as unknown as string, year: null as unknown as string, genre: null as unknown as string, ext: 'wav' }),
  ]

  it('不分组：纯平铺（应用过滤），playIndex 连续', () => {
    const rows = groupLibraryTracks(tracks, null, '', new Set(), '未知')
    expect(rows.every(row => row.type == 'track')).toBe(true)
    expect(rows.map(row => row.playIndex)).toEqual([0, 1, 2, 3])
  })

  it('按歌手分组：组头带数量、按名称排序、未知组恒最后', () => {
    const rows = groupLibraryTracks(tracks, 'singer', '', new Set(), '未知')
    const headers = rows.filter(row => row.type == 'header')
    expect(headers.map(row => row.label)).toEqual(['甲', '乙', '未知'])
    expect(headers.map(row => row.count)).toEqual([1, 2, 1])
    // 折叠的组不展开曲目行
    const collapsed = groupLibraryTracks(tracks, 'singer', '', new Set(['甲']), '未知')
    expect(collapsed.filter(row => row.type == 'track').map(row => row.track!.id)).toEqual(['a', 'c', 'd'])
  })

  it('按专辑/年份/格式分组：数字感知升序（2019 在 2021 前）', () => {
    const byYear = groupLibraryTracks(tracks, 'year', '', new Set(), '未知')
    expect(byYear.filter(row => row.type == 'header').map(row => row.label)).toEqual(['2019', '2021', '未知'])
    const byExt = groupLibraryTracks(tracks, 'ext', '', new Set(), '未知')
    expect(byExt.filter(row => row.type == 'header').map(row => row.label)).toEqual(['flac', 'mp3', 'wav'])
  })

  it('搜索与分组叠加：过滤后的结果再分组，playIndex 对应过滤后序列', () => {
    const rows = groupLibraryTracks(tracks, 'album', 'A', new Set(), '未知')
    const trackRows = rows.filter(row => row.type == 'track')
    // 专辑含 A 的 b/c，外加歌名 song_a 里带 a 的 a（三个字段都参与匹配）
    expect(trackRows.map(row => row.track!.id)).toEqual(['b', 'c', 'a'])
    expect(trackRows.map(row => row.playIndex)).toEqual([1, 2, 0])
  })

  it('空值字段归「未知」组（自定义标签）', () => {
    const rows = groupLibraryTracks(tracks, 'singer', '', new Set(), '无歌手')
    const unknownHeader = rows.find(row => row.type == 'header' && row.key == '__unknown__')
    expect(unknownHeader!.label).toBe('无歌手')
  })

  it('按「来源」分组：显示名走传入的映射（不把内部值 import/download 给用户）', () => {
    const originTracks = [
      track('x', { origin: 'import' }),
      track('y', { origin: 'download' }),
      track('z', { origin: 'download' }),
    ]
    const rows = groupLibraryTracks(originTracks, 'origin', '', new Set(), '未知', { import: '导入', download: '下载' })
    const headers = rows.filter(row => row.type == 'header')
    const labelToCount = Object.fromEntries(headers.map(row => [row.label, row.count]))
    expect(labelToCount).toEqual({ 下载: 2, 导入: 1 })
    // 缺省映射时显示原值（纯函数不依赖 i18n）
    const raw = groupLibraryTracks(originTracks, 'origin', '', new Set(), '未知')
    expect(raw.filter(row => row.type == 'header').map(row => row.label).sort((a, b) => (a ?? '').localeCompare(b ?? ''))).toEqual(['download', 'import'])
  })
})
