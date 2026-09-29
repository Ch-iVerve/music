import { describe, expect, it } from 'vitest'
import { backupMarkdown, formatDuration, safeFileName, specsFromBackup } from './backup.mjs'

describe('backup 文件层', () => {
  it('safeFileName 消毒非法字符、空名兜底', () => {
    expect(safeFileName('a/b\\c:d*e?f"g<h>i|j')).toBe('a_b_c_d_e_f_g_h_i_j')
    expect(safeFileName('  ')).toBe('playlist')
  })

  it('formatDuration 秒转 m:ss', () => {
    expect(formatDuration(0)).toBe('0:00')
    expect(formatDuration(200)).toBe('3:20')
    expect(formatDuration(undefined)).toBe('0:00')
  })

  it('specsFromBackup：raw 行 → {songId,songType}；坏文件与坏行报错', () => {
    expect(specsFromBackup({ songs: [{ id: 769125, type: 13 }, { id: '553631452' }] }))
      .toEqual([{ songId: 769125, songType: 13 }, { songId: 553631452, songType: 0 }])
    expect(() => specsFromBackup({})).toThrow('songs')
    expect(() => specsFromBackup({ songs: [{ name: '没有 id' }] })).toThrow('id')
  })

  it('backupMarkdown：表头含恢复命令，行含转义后的歌手/专辑', () => {
    const md = backupMarkdown({
      playlist: { name: '测|试', dirId: 85, tid: 9271640753 },
      exportedAt: '2026-09-28T06:00:00.000Z',
      songs: [{ id: 1, type: 0, name: '歌', singer: [{ name: '某|人' }], album: { name: '专\n辑' }, interval: 200 }],
    })
    expect(md).toContain('# 歌单备份：测|试')
    expect(md).toContain('playlist restore')
    expect(md).toContain('| 1 | 歌 | 某\\|人 | 专 辑 | 3:20 | 1:0 |')
  })
})
