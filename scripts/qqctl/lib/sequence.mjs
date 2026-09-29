/**
 * 歌单序列运算——restore/resort 的正确性前提，全部来自 2026-09-28 两次临时歌单受控实验：
 *   1. CgiGetDiss 读序 = 加序倒序：每次 AddSonglist 的整批歌按「数组倒序」前置到列表头
 *      （批内 [A,B,C] → 读出 [C,B,A]；后加的批整体排在先加的批前面）；
 *   2. 因此要达到目标读序 F，必须按 reverse(F) 切批、依批加入。
 * simulatePlaylistAdd 把这两条语义固化成可执行文档；一旦服务端行为变化，这条测试先红。
 */

/** 目标读序 → 应传给 AddSonglist 的序列（倒序）。不修改入参。 */
export const reverseForAdd = target => [...target].reverse()

/** 目标读序切批：批 i = reverse(F) 的连续切片，依批加入（writeBatches 即按数组顺序切）。 */
export const buildAddBatches = (target, batchSize) => {
  const number = Number(batchSize)
  const size = Number.isFinite(number) ? Math.max(1, Math.floor(number)) : 10
  const reversed = reverseForAdd(target)
  const batches = []
  for (let i = 0; i < reversed.length; i += size) batches.push(reversed.slice(i, i + size))
  return batches
}

/** 按实测服务端语义模拟「依批加入」后的读序：每批数组倒序前置到当前读序的头部。 */
export const simulatePlaylistAdd = (currentRead, batches) => {
  let read = [...currentRead]
  for (const batch of batches) read = [...[...batch].reverse(), ...read]
  return read
}

/** 歌曲身份键（songId + QQ 原始 songType；type 不同算不同条目，写接口要原样带上）。 */
export const songKey = spec => `${Number(spec.songId)}:${Number(spec.songType ?? 0)}`

/** 当前歌单与备份的差异（键集合）：恢复前核对，防止误删备份之后新加的歌。 */
export const diffSongSets = (currentSpecs, backupSpecs) => {
  const current = new Set(currentSpecs.map(songKey))
  const backup = new Set(backupSpecs.map(songKey))
  return {
    onlyCurrent: [...current].filter(key => !backup.has(key)),
    onlyBackup: [...backup].filter(key => !current.has(key)),
  }
}

/** 两序列首个不一致的下标（长度差也算不一致）；完全一致回 -1。 */
export const firstSequenceMismatch = (actual, target) => {
  const length = Math.max(actual.length, target.length)
  for (let i = 0; i < length; i++) if (actual[i] !== target[i]) return i
  return -1
}
