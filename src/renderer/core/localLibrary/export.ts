import path from 'node:path'
import { checkPath, saveStrToFile } from '@common/utils/nodejs'
import { filterFileName } from '@renderer/utils'
import type { LocalIngestProgress } from '@renderer/worker/main/library'

/**
 * 导出向导的打包编排（票 11，spec D8）。
 *
 * 三选勾：列表 JSON（与现有单列表导入同格式，可读回）/ m3u8 / 复制音频文件。
 * 副本按「序号 - 歌手 - 标题.ext」可读命名（导出的副本不受哈希命名约束）；信息全内嵌 →
 * 副本天然自包含。失效条目（本地文件不存在）与在线歌跳过并进汇总。导出**只读**媒体目录，
 * 不改库与文件状态。
 */

export interface ExportOptions {
  json: boolean
  m3u8: boolean
  copyFiles: boolean
}

export interface ExportResult {
  copied: number
  /** 跳过的条目（在线歌 / 失效 / 复制失败），含原因的展示名 */
  skipped: string[]
  /** 实际写出的文件（JSON/m3u8/副本），展示用 */
  written: string[]
}

const intervalToSeconds = (interval: string | null): number => {
  if (!interval) return -1
  const parts = interval.split(':').map(Number)
  if (parts.some(n => Number.isNaN(n))) return -1
  return parts.reduce((acc, n) => acc * 60 + n, 0)
}

export const exportListAsPackage = async(
  listInfo: LX.List.MyListInfo,
  musics: LX.Music.MusicInfo[],
  targetDir: string,
  options: ExportOptions,
  onProgress?: (progress: LocalIngestProgress) => void,
): Promise<ExportResult> => {
  const { json, m3u8, copyFiles } = options
  const result: ExportResult = { copied: 0, skipped: [], written: [] }
  if (!json && !m3u8 && !copyFiles) return result

  const total = musics.length
  let done = 0
  const tick = (current: string) => {
    done++
    onProgress?.({ total, done, current })
  }

  // 逐条分类：本地托管 → {mediaPath, ext}；在线/失效 → skipped（`!=` 过滤后剩余即 MusicInfoLocal）
  const items: Array<{ music: LX.Music.MusicInfoLocal, mediaPath: string, ext: string }> = []
  for (const music of musics) {
    if (music.source != 'local') {
      result.skipped.push(`${music.name}（在线歌曲）`)
      tick(music.name)
      continue
    }
    const mediaPath = music.meta.filePath
    if (!await checkPath(mediaPath)) {
      result.skipped.push(`${music.name}（文件丢失）`)
      tick(music.name)
      continue
    }
    items.push({ music, mediaPath, ext: music.meta.ext })
  }

  // 副本名：序号 - 歌手 - 标题.ext（可读命名，spec D8；序号保证唯一）
  const copyNameOf = (music: LX.Music.MusicInfo, index: number, ext: string) =>
    filterFileName(`${String(index + 1).padStart(2, '0')} - ${music.singer || '未知歌手'} - ${music.name}.${ext || 'mp3'}`)

  if (json) {
    const jsonPath = path.join(targetDir, `lx_list_part_${filterFileName(listInfo.name)}.json`)
    // 与现有「导出列表」完全同构（playListPart_v2）：应用自身的列表导入可直接读回。
    // 注意口径：JSON 是「可再导入的元数据快照」，用全量 musics（在线/失效条目也在内）；
    // 而副本与 m3u8 只含上面分类出的 items——跳过条目只进汇总，两处数字不必一致
    await saveStrToFile(jsonPath, JSON.stringify({
      type: 'playListPart_v2',
      data: { ...listInfo, list: musics },
    }))
    result.written.push(path.basename(jsonPath))
  }

  if (copyFiles) {
    // 复制走 worker seam（window.lx.worker.main 经 exposeWorker 暴露整个 library 模块）——
    // 不用动态 import 直接拉实现：那会把 worker 代码打进主线程 bundle、复制占 UI 线程（架构评审 C3）
    const exportCopyFiles = window.lx.worker.main.exportCopyFiles
    const tasks: Array<{ src: string, dest: string }> = []
    items.forEach((item, index) => {
      tasks.push({
        src: item.mediaPath,
        dest: path.join(targetDir, copyNameOf(item.music, index, item.ext)),
      })
    })
    const copy = await exportCopyFiles(tasks)
    result.copied = copy.copied
    for (const name of copy.failures) result.skipped.push(`${name}（复制失败）`)
  }

  if (m3u8) {
    const lines: string[] = ['#EXTM3U']
    items.forEach((item, index) => {
      const seconds = intervalToSeconds(item.music.interval)
      lines.push(`#EXTINF:${seconds},${item.music.singer || '未知歌手'} - ${item.music.name}`)
      // 复制了文件 → 相对路径（整包可搬）；没复制 → 指向媒体目录绝对路径（本机可用）
      lines.push(copyFiles ? copyNameOf(item.music, index, item.ext) : item.mediaPath)
    })
    const m3uPath = path.join(targetDir, `${filterFileName(listInfo.name)}.m3u8`)
    await saveStrToFile(m3uPath, `${lines.join('\n')}\n`)
    result.written.push(path.basename(m3uPath))
  }

  return result
}
