import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { formatPlayTime } from '@common/utils/common'

/**
 * 托管导入的执行（票 02）。
 *
 * ⚠️ 签名必须是**扁平位置参数**：Comlink 只把「顶层参数」上的代理标记值转成 MessagePort，
 * 嵌在对象里的回调函数过不了结构化克隆（真机 DataCloneError：`could not be cloned`，票 10 前
 * 的 options 对象写法就这么炸的——与 `download.startTask` 的生产先例同一约定）。
 * 每个文件走一遍：内容哈希 → 命中已有哈希则跳过（spec：同内容天然去重）→ 解析 tag →
 * **复制**进媒体目录（spec D3：原始文件不存在删除/移动分支，托管永远是复制）→ 产出曲目行。
 * 数据库的读写不在这里（渲染 worker 摸不到主进程 dbService）：已有哈希集合由主线程查库后
 * 传入，产出由主线程经 IPC 落库。进度与取消经 Comlink 回调上报。
 */

export interface LocalIngestProgress {
  total: number
  done: number
  /** 当前处理的文件名（仅展示用） */
  current: string
}

export interface LocalIngestResult {
  /** 解析成功且已复制进媒体目录的新曲目（去重后增量；取消时=取消前已完成的部分，仍有效） */
  tracks: LX.LocalLibrary.TrackInput[]
  /** 命中已有哈希被跳过的文件（哈希列表：主线程按它回填目标歌单的引用行） */
  duplicateHashes: string[]
  /** 解析/复制失败的文件名列表（逐个跳过，不阻塞整批） */
  failures: string[]
  /** 是否被用户取消 */
  cancelled: boolean
}

const hashFile = async(filePath: string) =>
  new Promise<string>((resolve, reject) => {
    const hash = createHash('sha1')
    const stream = createReadStream(filePath)
    stream.on('data', chunk => { hash.update(chunk) })
    stream.on('error', reject)
    stream.on('end', () => { resolve(hash.digest('hex')) })
  })

/** 导入白名单（票 03：与文件选择对话框同一组扩展名，扫描与选择两条入口口径一致） */
const AUDIO_EXTENSIONS = new Set(['mp3', 'flac', 'ogg', 'oga', 'wav', 'm4a'])

/** 垃圾文件判定（票 14 真机反馈）：`._` 开头是 macOS AppleDouble 元数据（几 KB 的非音频垃圾，
 *  music-metadata 有时还能从中读出点东西，导入全是无 tag 噪声条目）；其余点开头的一并视为隐藏文件 */
const isJunkFileName = (name: string): boolean => name.startsWith('.')

/** 递归扫描目录下的音频文件（文件夹导入的发现阶段；顺序=目录遍历序，导入时再逐个处理） */
export const scanAudioFolder = async(dirPath: string): Promise<string[]> => {
  const out: string[] = []
  const walk = async(dir: string) => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) await walk(full)
      else if (entry.isFile() && AUDIO_EXTENSIONS.has(path.extname(entry.name).slice(1).toLowerCase())) out.push(full)
    }
  }
  await walk(dirPath)
  return out
}

/** 批量核对文件存在性（票 06 的失效核对）：返回**已丢失**的路径子集 */
export const checkMissingPaths = async(paths: string[]): Promise<string[]> => {
  const missing: string[] = []
  for (const filePath of paths) {
    try {
      await fs.access(filePath)
    } catch {
      missing.push(filePath)
    }
  }
  return missing
}

export interface LibraryReconcileReport {
  /** 孤儿文件：媒体目录里有、库里没有（可清理或收编入库） */
  orphans: string[]
  /** 失效记录：库里有、目录里没有（可移除记录或保留标记） */
  missing: string[]
  /** 大小与记录不符（便宜的错位检测；提示重导，处置同失效） */
  mismatched: string[]
  /** 垃圾条目（票 14）：macOS `._*` 元数据文件被旧版导入成的噪声曲目——记录与托管副本一并清除 */
  junk: string[]
}

/** 重扫描对账（票 07/14）：媒体目录 vs 曲目库的差异。大小比对是哈希重算的**廉价替身**——
 *  内容变了尺寸几乎必变；真哈希校验留给票 08 的 taglib 落地后再评估要不要做全量 */
export const reconcileLibrary = async(options: {
  mediaDir: string
  tracks: Array<{ id: string, ext: string, size: number, name: string }>
}): Promise<LibraryReconcileReport> => {
  const { mediaDir, tracks } = options
  // ⚠️ 必须 `withFileTypes` 且只收**普通文件、且非隐藏名**：媒体目录里有应用自己的下载暂存目录
  // `<mediaDir>/.tmp`（票 03），不带类型过滤会把它列成「孤儿」——收编会对目录做哈希（必失败）、
  // 删除是 `fs.rm` 不带 recursive（EISDIR，被 catch 吞成「删不掉」），2026-10-13 真机咬到。
  // 托管副本的命名恒为 `<内容哈希>.<扩展名>`（不带点开头），所以隐藏名一律不是库素材。
  let diskEntries: Array<{ name: string, isFile: () => boolean }> = []
  try {
    diskEntries = await fs.readdir(mediaDir, { withFileTypes: true })
  } catch {}
  const diskNames = diskEntries
    .filter(entry => entry.isFile() && !entry.name.startsWith('.'))
    .map(entry => entry.name)
  const diskSet = new Set(diskNames)
  const trackByFileName = new Map(tracks.map(track => [`${track.id}.${track.ext}`, track]))

  const orphans: string[] = []
  for (const name of diskNames) {
    if (!trackByFileName.has(name)) orphans.push(path.join(mediaDir, name))
  }

  const missing: string[] = []
  const mismatched: string[] = []
  const junk: string[] = []
  for (const track of tracks) {
    const fileName = `${track.id}.${track.ext}`
    // 垃圾条目（macOS `._*` 旧导入噪声）优先归类：无论托管副本在与不在，都是「记录+文件一起清」
    if (track.name.startsWith('._')) {
      junk.push(path.join(mediaDir, fileName))
      continue
    }
    if (!diskSet.has(fileName)) {
      missing.push(path.join(mediaDir, fileName))
      continue
    }
    try {
      const stats = await fs.stat(path.join(mediaDir, fileName))
      if (stats.size != track.size) mismatched.push(path.join(mediaDir, fileName))
    } catch {}
  }
  return { orphans, missing, mismatched, junk }
}

/** 删除孤儿文件（**只删调用方明确列出的路径**；有确认弹窗拦在 UI 层） */
export const deleteOrphanFiles = async(paths: string[]): Promise<number> => {
  let deleted = 0
  for (const filePath of paths) {
    try {
      await fs.rm(filePath, { force: true })
      deleted++
    } catch (err) {
      console.log('[library.rescan] 删除孤儿文件失败:', filePath, err)
    }
  }
  return deleted
}

/** 导出的复制阶段（票 11）：按调用方给好的 src→dest 清单逐个复制；单文件失败跳过进汇总 */
export const exportCopyFiles = async(tasks: Array<{ src: string, dest: string }>): Promise<{ copied: number, failures: string[] }> => {
  let copied = 0
  const failures: string[] = []
  for (const task of tasks) {
    try {
      await fs.copyFile(task.src, task.dest)
      copied++
    } catch (err) {
      console.log('[library.export] 复制失败:', task.src, err)
      failures.push(path.basename(task.src))
    }
  }
  return { copied, failures }
}

/** 内嵌歌词有无（粗判：common.lyrics 或原生 tag 里带 LYRIC 字样；票 08/09 的编辑器用 taglib 精确读写） */
const hasEmbeddedLyric = (metadata: LX.MusicMetadataModule.IAudioMetadata): boolean => {
  if (metadata.common.lyrics?.length) return true
  for (const tags of Object.values(metadata.native)) {
    if (tags.some(tag => /lyric/i.test(tag.id))) return true
  }
  return false
}

export const ingestLocalFiles = async(
  filePaths: string[],
  mediaDir: string,
  /** 库里已有的曲目哈希（主线程查库后传入） */
  existingHashes: string[],
  onProgress: (progress: LocalIngestProgress) => void,
  /** Comlink 过桥后实际返回 Promise<boolean>，实现里必须 await */
  shouldCancel: () => boolean | Promise<boolean>,
): Promise<LocalIngestResult> => {
  const known = new Set(existingHashes)
  const tracks: LX.LocalLibrary.TrackInput[] = []
  const failures: string[] = []
  /** 命中已有哈希的文件（返回哈希本身：主线程要按它回填歌单引用行，spec D4/D7） */
  const duplicateHashes: string[] = []
  let cancelled = false
  let done = 0

  await fs.mkdir(mediaDir, { recursive: true })

  for (const filePath of filePaths) {
    const fileName = path.basename(filePath)
    // 垃圾/隐藏文件（macOS `._*` 等）直接静默跳过——它们不是音频，连「失败」都算不上（票 14 真机反馈）
    if (isJunkFileName(fileName)) {
      done++
      onProgress({ total: filePaths.length, done, current: fileName })
      continue
    }
    // Comlink 过桥后回调返回 Promise（恒真值）——必须 await（两轴审查修正）
    if (await shouldCancel()) {
      cancelled = true
      break
    }
    try {
      const hash = await hashFile(filePath)
      if (known.has(hash)) {
        duplicateHashes.push(hash)
      } else {
        const { parseFile } = await import('music-metadata')
        const metadata = await parseFile(filePath)
        const ext = (path.extname(filePath).slice(1) || 'mp3').toLowerCase()
        // 托管副本 = 内容哈希命名（spec D2 零旁车：歌词/封面/信息全内嵌在文件里，目录内只有音频本体）
        const targetPath = path.join(mediaDir, `${hash}.${ext}`)
        // 收编孤儿时源文件就在媒体目录里（目标=同一路径）：自己拷自己没有意义，跳过
        if (targetPath != filePath) await fs.copyFile(filePath, targetPath)
        const stats = await fs.stat(filePath)
        known.add(hash)
        tracks.push({
          id: hash,
          // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
          name: (metadata.common.title || path.basename(filePath, path.extname(filePath))).trim(),
          singer: metadata.common.artists?.length ? metadata.common.artists.map(a => a.trim()).join('、') : '',
          album: metadata.common.album?.trim() ?? null,
          interval: metadata.format.duration ? formatPlayTime(metadata.format.duration) : null,
          ext,
          size: stats.size,
          year: metadata.common.year != null ? String(metadata.common.year) : null,
          genre: metadata.common.genre?.length ? metadata.common.genre.join('、') : null,
          trackNum: metadata.common.track?.no != null ? String(metadata.common.track.no) : null,
          discNum: metadata.common.disk?.no != null ? String(metadata.common.disk.no) : null,
          hasPic: !!metadata.common.picture?.length,
          hasLyric: hasEmbeddedLyric(metadata),
        })
      }
    } catch (err) {
      console.log('[library.ingest] 解析/复制失败，跳过:', fileName, err)
      failures.push(fileName)
    }
    done++
    onProgress({ total: filePaths.length, done, current: fileName })
  }

  return { tracks, duplicateHashes, failures, cancelled }
}
