import { singerNames } from './search.mjs'

/**
 * 歌单备份文件的读写（`playlist backup` / `playlist restore --from`）。
 * JSON 存 CgiGetDiss 原始行（保真，恢复只用 id/type）；MD 是给人看的可读表。
 */

/** 文件名消毒：Windows/Mac/Linux 通吃的非法字符换下划线；空名兜底。 */
export const safeFileName = name => String(name ?? '').replace(/[/\\:*?"<>|\n\r\t]/g, '_').trim() || 'playlist'

/** 本地时间戳（toISOString 是 UTC，落文件名/正文要用本地日期，差一天会误导）。 */
export const localStamp = at => {
  const d = at == null ? new Date() : new Date(at)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** 秒 → m:ss。 */
export const formatDuration = seconds => {
  const total = Math.max(0, Math.round(Number(seconds) || 0))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/** 备份文件里的 songs → 写接口规格；坏行点名报错，不静默丢。 */
export const specsFromBackup = parsed => {
  const songs = parsed?.songs
  if (!Array.isArray(songs) || !songs.length) throw new Error('备份文件缺少非空 songs 数组——不是 qqctl playlist backup 的产物？')
  return songs.map(row => {
    const songId = Number(row.id)
    if (!Number.isFinite(songId)) throw new Error(`备份行缺 id：${JSON.stringify(row).slice(0, 80)}`)
    return { songId, songType: Number(row.type ?? 0) }
  })
}

const esc = value => String(value ?? '').replace(/\|/g, '\\|').replace(/\n+/g, ' ')

/** 可读备份表。恢复命令直接写在文首，拿到文件就会用。 */
export const backupMarkdown = ({ playlist, exportedAt, songs }) => {
  const lines = [
    `# 歌单备份：${playlist.name}`,
    '',
    `- 导出时间：${localStamp(exportedAt)}`,
    `- 歌单：${playlist.name}（dirId=${playlist.dirId}，tid=${playlist.tid}）`,
    `- 歌曲数：${songs.length}`,
    '- 恢复：`node scripts/qqctl/bin.mjs playlist restore "<歌单名>" --from <同名 .json> --yes`（删光歌单后按本表顺序重加）',
    '',
    '| # | 歌曲 | 歌手 | 专辑 | 时长 | songId:type |',
    '|---|------|------|------|------|-------------|',
  ]
  songs.forEach((row, index) => {
    lines.push(`| ${index + 1} | ${esc(row.name)} | ${esc(singerNames(row.singer))} | ${esc(row.album?.name)} | ${formatDuration(row.interval)} | ${row.id}:${row.type ?? 0} |`)
  })
  return `${lines.join('\n')}\n`
}
