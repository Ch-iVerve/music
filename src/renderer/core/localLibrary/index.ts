import path from 'node:path'
import { ref } from '@common/utils/vueTools'
import { addListMusics, getListMusics } from '@renderer/store/list/action'
import { getEnvParams, localLibraryAdd, localLibraryGetAll } from '@renderer/utils/ipc'
import { proxyCallback } from '@renderer/worker/utils'
import type { LocalIngestProgress } from '@renderer/worker/main/library'

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
const buildLocalEntry = (track: EntrySource, mediaDir: string): LX.Music.MusicInfoLocal => ({
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

    const result = await window.lx.worker.main.ingestLocalFiles({
      filePaths,
      mediaDir,
      existingHashes: libraryTracks.map(track => track.id),
      onProgress: proxyCallback((p: LocalIngestProgress) => {
        progress.value = p
      }),
      shouldCancel: proxyCallback(() => cancelFlag.value),
    })

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
