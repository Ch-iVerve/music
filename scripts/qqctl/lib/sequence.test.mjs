import { describe, expect, it } from 'vitest'
import {
  buildAddBatches,
  diffSongSets,
  firstSequenceMismatch,
  reverseForAdd,
  simulatePlaylistAdd,
  songKey,
} from './sequence.mjs'

const specs = ids => ids.map(songId => ({ songId, songType: 0 }))
const keys = list => list.map(songKey)

describe('sequence：读序 = 加序倒序（2026-09-28 临时歌单实测语义）', () => {
  const TARGET = specs([101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118, 119, 120, 121, 122, 123, 124, 125])

  it('整批加入 [A,B,C] 读出 [C,B,A]；后加的批整体在前', () => {
    const read = simulatePlaylistAdd([], [specs([1, 2, 3])])
    expect(keys(read)).toEqual(['3:0', '2:0', '1:0'])
    const more = simulatePlaylistAdd(read, [specs([9])])
    expect(keys(more)).toEqual(['9:0', '3:0', '2:0', '1:0'])
  })

  it('按 reverse(F) 切批依序加入，最终读序 === F（跨批拼装）', () => {
    const batches = buildAddBatches(TARGET, 10)
    expect(batches).toHaveLength(3)
    expect(batches[0][0]).toEqual({ songId: 125, songType: 0 })
    const final = simulatePlaylistAdd([], batches)
    expect(keys(final)).toEqual(keys(TARGET))
  })

  it('batchSize 收敛到 ≥1；空目标给空批；reverseForAdd 不改入参', () => {
    expect(buildAddBatches([], 10)).toEqual([])
    expect(buildAddBatches(specs([1, 2]), 0)).toEqual([[{ songId: 2, songType: 0 }], [{ songId: 1, songType: 0 }]])
    const source = specs([1, 2])
    const reversed = reverseForAdd(source)
    expect(keys(reversed)).toEqual(['2:0', '1:0'])
    expect(keys(source)).toEqual(['1:0', '2:0'])
  })
})

describe('diffSongSets / firstSequenceMismatch', () => {
  it('集合差异分两侧汇报，键含 songType', () => {
    const { onlyCurrent, onlyBackup } = diffSongSets(
      [{ songId: 1, songType: 0 }, { songId: 2, songType: 13 }],
      [{ songId: 2, songType: 13 }, { songId: 3, songType: 0 }],
    )
    expect(onlyCurrent).toEqual(['1:0'])
    expect(onlyBackup).toEqual(['3:0'])
  })

  it('首不一致下标：完全一致 -1；内容差与长度差都报', () => {
    expect(firstSequenceMismatch(['1:0'], ['1:0'])).toBe(-1)
    expect(firstSequenceMismatch(['1:0', '2:0'], ['1:0', '3:0'])).toBe(1)
    expect(firstSequenceMismatch(['1:0'], ['1:0', '2:0'])).toBe(1)
    expect(firstSequenceMismatch([], [])).toBe(-1)
  })
})
