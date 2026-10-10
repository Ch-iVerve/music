import path from 'node:path'
import { ref } from '@common/utils/vueTools'
import { addListMusics, createUserList, getListMusics } from '@renderer/store/list/action'
import { getEnvParams, localLibraryAdd, localLibraryGetAll, localLibraryRemove, localLibraryUpdate } from '@renderer/utils/ipc'
import { proxyCallback } from '@renderer/worker/utils'
import type { LibraryReconcileReport, LocalIngestProgress } from '@renderer/worker/main/library'
import type { LocalTagInfo } from '@renderer/worker/main/taglib'

/**
 * 托管导入的**主线程编排**（票 02）：worker 管线只碰文件，这里串起查库、落库、写歌单与 UI 状态。
 *
 * 流程：取媒体目录 → 查库（已有哈希 = 去重判据）+ 查目标歌单现有条目 → worker 逐文件
 * 「哈希→去重→解析→复制」→ 新曲目落库 → **所有命中库的文件（新入库 + 已在库）都以库条目
 * 引用写进目标歌单**（已在目标歌单里的除外）——「库是素材库、歌单是编排」（spec US13/US17），
 * 所以文件已在库时加入另一个歌单是**回填引用行**，不是跳过。
 * 取消语义：已完成的文件仍然有效（照常入库入列），未开始的放弃。
 *
 * 进度弹窗（LocalImportProgressModal）直接读本模块的状态；同一时刻只允许一个导入在跑。
 */

export interface LocalImportSummary {
  /** 本次进入目标歌单的条目数（新入库 + 从库回填的引用） */
  added: number
  /** 已在目标歌单里、什么都没发生的文件数 */
  skipped: number
  failed: string[]
  cancelled: boolean
}

const visible = ref(false)
const progress = ref<LocalIngestProgress | null>(null)
const finished = ref<LocalImportSummary | null>(null)
const cancelFlag = ref(false)

export const useLocalImportState = () => ({ visible, progress, finished })

export const cancelLocalImport = () => {
  cancelFlag.value = true
}

export const closeLocalImport = () => {
  visible.value = false
}

/** 造条目只需要这六个字段（TrackInput 无 importedAt 也可用，spec D4 的 meta 契约全在这几项里） */
type EntrySource = Pick<LX.LocalLibrary.Track, 'id' | 'name' | 'singer' | 'album' | 'interval' | 'ext'>

/** 库曲目 → 歌单本地条目（spec D4：id=哈希、meta.filePath=托管路径、meta.trackId=哈希） */
export const buildLocalEntry = (track: EntrySource, mediaDir: string): LX.Music.MusicInfoLocal => ({
  id: track.id,
  name: track.name,
  singer: track.singer,
  source: 'local',
  interval: track.interval,
  meta: {
    albumName: track.album ?? '',
    filePath: path.join(mediaDir, `${track.id}.${track.ext}`),
    songId: track.id,
    picUrl: '',
    ext: track.ext,
    trackId: track.id,
  },
})

export const importLocalFilesToList = async(listId: string, filePaths: string[]): Promise<void> => {
  if (!filePaths.length || visible.value) return
  const mediaDir = (await getEnvParams()).mediaDir
  cancelFlag.value = false
  progress.value = { total: filePaths.length, done: 0, current: '' }
  finished.value = null
  visible.value = true
  try {
    const [libraryTracks, listMusics] = await Promise.all([localLibraryGetAll(), getListMusics(listId)])
    const trackById = new Map<string, EntrySource>(libraryTracks.map(track => [track.id, track]))
    const inListIds = new Set(listMusics.map(music => music.id))

    const result = await window.lx.worker.main.ingestLocalFiles(
      filePaths,
      mediaDir,
      libraryTracks.map(track => track.id),
      // ⚠️ 回调必须是**顶层位置参数**：Comlink 只转换顶层的代理标记值，嵌进对象里过不了结构化克隆
      proxyCallback((p: LocalIngestProgress) => {
        progress.value = p
      }),
      proxyCallback(() => cancelFlag.value),
    )

    // 新曲目落库；命中库的每一个文件（新入库 + 已在库）都引用进目标歌单（已在歌单的除外）
    if (result.tracks.length) await localLibraryAdd(result.tracks)
    for (const track of result.tracks) trackById.set(track.id, track)

    const entries: LX.Music.MusicInfoLocal[] = []
    let skipped = 0
    const touchedHashes = [...result.tracks.map(track => track.id), ...result.duplicateHashes]
    for (const hash of touchedHashes) {
      if (inListIds.has(hash)) {
        skipped++
        continue
      }
      const track = trackById.get(hash)
      if (!track) continue // 理论不可达：新曲目与重复哈希都必然有库行（自检兜底）
      inListIds.add(hash)
      entries.push(buildLocalEntry(track, mediaDir))
    }
    if (entries.length) await addListMusics(listId, entries)

    finished.value = {
      added: entries.length,
      skipped,
      failed: result.failures,
      cancelled: result.cancelled,
    }
  } catch (err) {
    console.log('[localLibrary.import] 导入失败:', err)
    finished.value = { added: 0, skipped: 0, failed: [String(err)], cancelled: false }
  }
}

/** 展示一个即时汇总（不跑管线的场景：空目录等） */
const showSummary = (summary: LocalImportSummary) => {
  cancelFlag.value = false
  progress.value = null
  finished.value = summary
  visible.value = true
}

/**
 * 整夹导入（票 03）：递归扫描目录 → 以目录名建歌单 → 走同一托管编排（importLocalFilesToList）。
 * 空目录不建歌单，直接给全零汇总（用户在弹窗里看到「新增 0」而不是毫无反馈）。
 */
export const importFolderToNewList = async(folderPath: string): Promise<void> => {
  if (visible.value || !folderPath) return
  const files = await window.lx.worker.main.scanAudioFolder(folderPath)
  if (!files.length) {
    showSummary({ added: 0, skipped: 0, failed: [], cancelled: false })
    return
  }
  const listId = `userlist_${Date.now()}`
  await createUserList({ name: path.basename(folderPath) || folderPath, id: listId })
  await importLocalFilesToList(listId, files)
}

/** 重扫描对账（票 07/14）：媒体目录 vs 曲目库的差异报告 */
export const reconcileLibrary = async(): Promise<LibraryReconcileReport> => {
  const mediaDir = (await getEnvParams()).mediaDir
  const tracks = await localLibraryGetAll()
  return window.lx.worker.main.reconcileLibrary({
    mediaDir,
    tracks: tracks.map(track => ({ id: track.id, ext: track.ext, size: track.size, name: track.name })),
  })
}

/** 收编孤儿文件：走同一托管管线（已在媒体目录内的不再自拷），仅入库、不进歌单 */
export const adoptOrphanFiles = async(paths: string[]): Promise<number> => {
  if (!paths.length) return 0
  const mediaDir = (await getEnvParams()).mediaDir
  const result = await window.lx.worker.main.ingestLocalFiles(
    paths,
    mediaDir,
    [],
    proxyCallback(() => {}),
    proxyCallback(() => false),
  )
  if (result.tracks.length) await localLibraryAdd(result.tracks)
  return result.tracks.length
}

/** 移除失效/不符记录（mediaPath → 哈希；级联清引用行与排序行走库模块既有能力；媒体文件不动） */
export const removeLibraryTracksByPath = async(paths: string[]): Promise<void> => {
  if (!paths.length) return
  await localLibraryRemove(paths.map(p => path.basename(p, path.extname(p))))
}

/** 删除孤儿文件（破坏性：UI 层有二次确认） */
export const deleteOrphanFiles = async(paths: string[]): Promise<number> => {
  return window.lx.worker.main.deleteOrphanFiles(paths)
}

export interface TrackEditPayload {
  name: string
  singer: string
  album: string | null
  year: string | null
  genre: string | null
  trackNum: string | null
  discNum: string | null
}

export interface TrackEditInfo {
  track: LX.LocalLibrary.Track
  tags: LocalTagInfo
  mediaPath: string
  taglibWasmPath: string
}

/** 编辑弹窗的初始信息：库行 + 文件内 tag（可写字段以文件内 tag 为准） */
export const loadTrackEditInfo = async(track: LX.LocalLibrary.Track): Promise<TrackEditInfo> => {
  const { mediaDir, taglibWasmPath } = await getEnvParams()
  const mediaPath = path.join(mediaDir, `${track.id}.${track.ext}`)
  const tags = await window.lx.worker.main.readTrackTags(mediaPath, taglibWasmPath)
  return { track, tags, mediaPath, taglibWasmPath }
}

/**
 * 保存单首编辑（spec D11 管线）：写托管副本 tag（含封面替换）→ 库行 + 引用歌单行同事务更新。
 * 编辑歌名/歌手后所有引用歌单的显示自动同步——引用行联动在 localLibraryUpdate 里。
 */
export const saveTrackEdits = async(
  track: LX.LocalLibrary.Track,
  edits: TrackEditPayload,
  coverSourcePath: string | null,
): Promise<void> => {
  const { mediaDir, taglibWasmPath } = await getEnvParams()
  const mediaPath = path.join(mediaDir, `${track.id}.${track.ext}`)
  const derived = await window.lx.worker.main.writeTrackTags({
    filePath: mediaPath,
    wasmPath: taglibWasmPath,
    edits,
    coverSourcePath,
  })
  await localLibraryUpdate({
    ...track,
    ...edits,
    size: derived.size,
    hasPic: derived.hasPic,
    hasLyric: derived.hasLyric,
  })
}

/**
 * 自动清理垃圾条目（票 14 真机反馈：macOS `._*` 元数据文件曾被旧版导入成噪声曲目）。
 *
 * 判定无歧义（曲名 `._` 前缀），所以**静默自动清**：删托管垃圾副本 + 删记录（级联清歌单引用），
 * 不出确认、不出报告——打开库的加载路径里先跑这一步，用户永远看不到垃圾条目。
 * 返回清理数量（0 = 没有垃圾，调用方无感）。
 */
export const autoCleanJunk = async(): Promise<number> => {
  const tracks = await localLibraryGetAll()
  const junk = tracks.filter(track => track.name.startsWith('._'))
  if (!junk.length) return 0
  const { mediaDir } = await getEnvParams()
  await window.lx.worker.main.deleteOrphanFiles(
    junk.map(track => path.join(mediaDir, `${track.id}.${track.ext}`)),
  )
  await localLibraryRemove(junk.map(track => track.id))
  return junk.length
}

/** 歌词编辑的初始信息（文件内歌词文本 + 托管路径） */
export const loadTrackLyricsInfo = async(track: LX.LocalLibrary.Track): Promise<{
  lyricsText: string | null
  mediaPath: string
}> => {
  const { mediaDir, taglibWasmPath } = await getEnvParams()
  const mediaPath = path.join(mediaDir, `${track.id}.${track.ext}`)
  const tags = await window.lx.worker.main.readTrackTags(mediaPath, taglibWasmPath)
  return { lyricsText: tags.lyricsText, mediaPath }
}

/** 保存歌词：写内嵌歌词 tag（USLT/LYRICS）→ 库行 hasLyric/size 同步（spec D12：歌词只内嵌） */
export const saveTrackLyrics = async(track: LX.LocalLibrary.Track, lyricsText: string): Promise<void> => {
  const { mediaDir, taglibWasmPath } = await getEnvParams()
  const mediaPath = path.join(mediaDir, `${track.id}.${track.ext}`)
  const derived = await window.lx.worker.main.writeTrackLyrics({
    filePath: mediaPath,
    wasmPath: taglibWasmPath,
    lyricsText,
  })
  await localLibraryUpdate({ ...track, hasLyric: derived.hasLyric, size: derived.size })
}

/** 拖入 .lrc 的文本读入（编码探测在 worker） */
export const readDroppedLrcText = async(lrcPath: string): Promise<string> => {
  return window.lx.worker.main.readDroppedLrcText(lrcPath)
}
