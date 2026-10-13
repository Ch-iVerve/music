import fs from 'node:fs'
import path from 'node:path'
import { ref } from '@common/utils/vueTools'
import { useRouter } from '@common/utils/vueRouter'
import { getPathForFile } from '@common/utils/electron'
import { createUserList } from '@renderer/store/list/action'
import { localLibraryGetAll, localLibraryUpdate, getEnvParams } from '@renderer/utils/ipc'
import { userLists } from '@renderer/store/list/state'
import { importFolderToNewList, importLocalFilesToList, readDroppedLrcText } from './index'

/**
 * 窗口级拖拽导入（票 04）。
 *
 * - **文件夹**（含混合拖入里的目录）→ 每个目录走整夹导入（建同名歌单，票 03 编排）；
 * - **散音频文件** → 目标歌单：当前正在看本地歌单 tab 且选中了某张自建歌单就进它；
 *   否则进自动建/复用的「导入的歌曲」（按 i18n 名匹配复用，改名后可能新建一张，可接受）。
 * - 非音频且非目录的文件静默忽略（`.lrc` 关联属票 09）。
 *
 * 窗口监听只装一次（模块级守卫）；dragenter/dragleave 用**计数**而不是布尔——子元素间移动会
 * 连发 leave/enter，布尔会出现「还在拖拽却关了遮罩」的闪烁。drop 与 overlay 均不拦截事件冒泡
 * 之外的行为（overlay pointer-events:none，drop 落到下层元素、由 window 统一接）。
 */

const AUDIO_EXTENSIONS = new Set(['mp3', 'flac', 'ogg', 'oga', 'wav', 'm4a'])

const dragDepth = ref(0)
export const useDragOverlayState = () => ({ dragDepth })

const isDirectory = (filePath: string): boolean => {
  try {
    return fs.statSync(filePath).isDirectory()
  } catch {
    return false
  }
}

/** 散文件的目标歌单：当前本地 tab 选中的自建歌单优先，否则自动建/复用「导入的歌曲」 */
const resolveTargetListId = async(): Promise<string> => {
  const router = useRouter()
  const route = router.currentRoute.value
  if (route.path == '/playlists' && route.query.tab == 'local') {
    const selected = route.query.id as string | undefined
    if (selected && userLists.some(list => list.id == selected)) return selected
  }
  const name = window.i18n.t('playlists__imported_songs')
  const existing = userLists.find(list => list.name == name)
  if (existing) return existing.id
  const id = `userlist_${Date.now()}`
  await createUserList({ name, id })
  return id
}

/** 拖入项（已从 DOM File 取出路径与名字；`isDir` 由调用方 stat 好） */
export interface DroppedItem {
  name: string
  /** 绝对路径；取不到时为空串（处理见 `classifyDroppedItems`） */
  path: string
  isDir: boolean
}

/**
 * 把拖入项分三堆（目录 / 音频 / 歌词）——**纯函数**，单测直接喂。
 *
 * 没有绝对路径的项**丢掉并计数**（`skipped`）：拿空串去 stat / 导入只会更晚炸或静默做错事。
 * 计数交给调用方留一行日志——「拖进去没反应」这种反馈必须能查（2026-10-13 真机：`file.path`
 * 在新版 Electron 已移除、恒 undefined，整批拖入被静默吞掉）。
 */
export const classifyDroppedItems = (items: DroppedItem[]) => {
  const folders: string[] = []
  const audioFiles: string[] = []
  const lrcFiles: string[] = []
  let skipped = 0
  for (const item of items) {
    if (!item.path) {
      skipped++
      continue
    }
    if (item.isDir) {
      folders.push(item.path)
      continue
    }
    const ext = path.extname(item.name).slice(1).toLowerCase()
    if (AUDIO_EXTENSIONS.has(ext)) audioFiles.push(item.path)
    else if (ext == 'lrc') lrcFiles.push(item.path)
  }
  return { folders, audioFiles, lrcFiles, skipped }
}

const handleDrop = async(event: DragEvent) => {
  const files = Array.from(event.dataTransfer?.files ?? [])
  if (!files.length) return
  const items: DroppedItem[] = files.map(file => {
    // 🔴 路径必须走 `webUtils.getPathForFile`（`@common/utils/electron`）：Electron 给 DOM File
    // 打的 `file.path` 扩展属性已被移除（本仓 Electron 42 上读它恒 undefined），用它会让拖拽导入静默失效
    const filePath = getPathForFile(file)
    return { name: file.name, path: filePath, isDir: !!filePath && isDirectory(filePath) }
  })
  const { folders, audioFiles, lrcFiles, skipped } = classifyDroppedItems(items)
  if (skipped) console.log(`[dragImport] 拖入 ${items.length} 项，其中 ${skipped} 项取不到绝对路径已跳过`)
  if (!folders.length && !audioFiles.length && !lrcFiles.length) {
    if (!skipped) console.log('[dragImport] 拖入项里没有可导入的内容（非音频 / 目录 / .lrc）')
    return
  }
  // 顺序导入：编排层同一时刻只允许一个导入在跑（visible 守卫），并行会让后来者被静默丢掉
  for (const folder of folders) await importFolderToNewList(folder)
  if (audioFiles.length) {
    const listId = await resolveTargetListId()
    await importLocalFilesToList(listId, audioFiles)
  }
  if (lrcFiles.length) await linkLrcFiles(lrcFiles)
}

/**
 * 拖入 .lrc → 按「文件名（去扩展）== 库曲目名」匹配并**内嵌**为歌词（票 09：零旁车）。
 * 匹配不到的歌名静默略过（拖一堆杂文件时不弹窗打扰）。
 */
const linkLrcFiles = async(lrcPaths: string[]) => {
  const { mediaDir, taglibWasmPath } = await getEnvParams()
  const tracks = await localLibraryGetAll()
  let linked = 0
  for (const lrcPath of lrcPaths) {
    const base = path.basename(lrcPath, path.extname(lrcPath)).trim().toLowerCase()
    if (!base) continue
    const matched = tracks.filter(track => track.name.trim().toLowerCase() == base)
    const text = await readDroppedLrcText(lrcPath)
    for (const track of matched) {
      try {
        const derived = await window.lx.worker.main.writeTrackLyrics({
          filePath: path.join(mediaDir, `${track.id}.${track.ext}`),
          wasmPath: taglibWasmPath,
          lyricsText: text,
        })
        await localLibraryUpdate({ ...track, hasLyric: derived.hasLyric, size: derived.size })
        linked++
      } catch (err) {
        console.log('[dragImport] 歌词内嵌失败:', track.name, err)
      }
    }
  }
  if (linked) console.log(`[dragImport] 已内嵌 ${linked} 首歌词`)
}

let installed = false
export const installDragImport = () => {
  if (installed) return
  installed = true
  window.addEventListener('dragenter', (event) => {
    if (!event.dataTransfer?.types.includes('Files')) return
    event.preventDefault()
    dragDepth.value++
  })
  window.addEventListener('dragover', (event) => {
    event.preventDefault()
  })
  window.addEventListener('dragleave', (event) => {
    event.preventDefault()
    dragDepth.value = Math.max(0, dragDepth.value - 1)
  })
  window.addEventListener('drop', (event) => {
    event.preventDefault()
    dragDepth.value = 0
    void handleDrop(event)
  })
}
