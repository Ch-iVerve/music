import { ref } from '@common/utils/vueTools'
import { setAllStatus } from '@renderer/store/player/action'

/**
 * 托管文件的存在性核对与失效标记（票 06）。
 *
 * **内存态**：标记只活在渲染进程里——不落库、不进同步（spec D9），每次打开库/歌单重新核对。
 * 核对跑在渲染 worker（fs.access 批量），同一时刻一轮、后来的并入下一轮（防抖）。
 */

const missingPaths = ref(new Set<string>())

export const isMediaPathMissing = (mediaPath: string): boolean => missingPaths.value.has(mediaPath)

/** 播放失效条目时的明确提示（复用播放器状态行的既有提示通道，票 01 工单 01 同款） */
export const hintMissingFileFallback = () => {
  setAllStatus(window.i18n.t('playlists__missing_file_fallback'))
}

let checking = false
let queuedPaths: string[] | null = null

/** 批量核对文件存在性；核对结果直接反映到失效集合（丢了记上、回来了除名）。
 *  worker 桥不可用（单测环境等）时静默跳过——核对是增强信息，不能让列表挂不上 */
export const checkAvailability = async(paths: string[]): Promise<void> => {
  if (!paths.length || !window.lx.worker.main) return
  if (checking) {
    queuedPaths = paths
    return
  }
  checking = true
  try {
    let batch: string[] | null = paths
    while (batch) {
      const missing = new Set(await window.lx.worker.main.checkMissingPaths(batch))
      const next = new Set(missingPaths.value)
      for (const p of batch) {
        if (missing.has(p)) next.add(p)
        else next.delete(p)
      }
      missingPaths.value = next
      batch = queuedPaths
      queuedPaths = null
    }
  } finally {
    checking = false
  }
}

/** 歌单本地条目的失效核对（ListMusicTable 场景：条目里只有 local 的 meta.filePath 要查） */
export const checkAvailabilityForMusics = async(musics: LX.Music.MusicInfo[]): Promise<void> => {
  const paths = musics
    .filter(music => music.source == 'local')
    .map(music => music.meta.filePath)
  await checkAvailability(paths)
}
