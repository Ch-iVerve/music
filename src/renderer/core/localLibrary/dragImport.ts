import fs from 'node:fs'
import path from 'node:path'
import { ref } from '@common/utils/vueTools'
import { useRouter } from '@common/utils/vueRouter'
import { createUserList } from '@renderer/store/list/action'
import { userLists } from '@renderer/store/list/state'
import { importFolderToNewList, importLocalFilesToList } from './index'

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

const handleDrop = async(event: DragEvent) => {
  // Electron 给 DOM File 扩展了 `path`（绝对路径，目录同样适用）；TS 的 DOM lib 不认识，局部声明
  const files = Array.from(event.dataTransfer?.files ?? []) as unknown as Array<{ path: string, name: string }>
  if (!files.length) return
  const folders: string[] = []
  const audioFiles: string[] = []
  for (const file of files) {
    if (isDirectory(file.path)) folders.push(file.path)
    else if (AUDIO_EXTENSIONS.has(path.extname(file.name).slice(1).toLowerCase())) audioFiles.push(file.path)
  }
  // 顺序导入：编排层同一时刻只允许一个导入在跑（visible 守卫），并行会让后来者被静默丢掉
  for (const folder of folders) await importFolderToNewList(folder)
  if (audioFiles.length) {
    const listId = await resolveTargetListId()
    await importLocalFilesToList(listId, audioFiles)
  }
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
