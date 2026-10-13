import { describe, expect, it, vi } from 'vitest'
import { classifyDroppedItems } from './dragImport'

/**
 * 拖拽导入的**分堆判据**（2026-10-13 真机回归）。
 *
 * 真机症状：拖文件进应用「没反应」。根因是路径来源——代码读的是 Electron 给 DOM File 打的
 * `file.path` 扩展属性，而本仓 Electron 42 上它已被移除（官方 `webUtils.getPathForFile` 取代），
 * 读出来恒 `undefined`：`isDirectory(undefined)` 为假、`path.extname(name)` 认成音频，
 * 于是把 `undefined` 当路径塞进导入，整批静默失败。
 *
 * 这里钉两条：① 三类各归位；② **取不到路径的项被丢掉并计数**（不再静默塞 undefined）。
 */

vi.mock('@common/utils/vueRouter', () => ({ useRouter: () => ({ currentRoute: { value: { path: '/', query: {} } } }) }))
vi.mock('@renderer/store/list/action', () => ({ createUserList: vi.fn() }))
vi.mock('@renderer/store/list/state', () => ({ userLists: [] }))
vi.mock('@renderer/utils/ipc', () => ({
  localLibraryGetAll: vi.fn(async() => []),
  localLibraryUpdate: vi.fn(),
  getEnvParams: vi.fn(async() => ({ mediaDir: '/media', taglibWasmPath: '' })),
}))
vi.mock('./index', () => ({
  importFolderToNewList: vi.fn(),
  importLocalFilesToList: vi.fn(),
  readDroppedLrcText: vi.fn(async() => ''),
}))

describe('dragImport 的 classifyDroppedItems', () => {
  it('目录 / 音频 / .lrc 三类各归位（扩展名大小写不敏感）', () => {
    const result = classifyDroppedItems([
      { name: '专辑夹', path: '/m/专辑夹', isDir: true },
      { name: 'a.FLAC', path: '/m/a.FLAC', isDir: false },
      { name: 'b.mp3', path: '/m/b.mp3', isDir: false },
      { name: 'c.lrc', path: '/m/c.lrc', isDir: false },
      { name: 'readme.txt', path: '/m/readme.txt', isDir: false },
    ])

    expect(result.folders).toEqual(['/m/专辑夹'])
    expect(result.audioFiles).toEqual(['/m/a.FLAC', '/m/b.mp3'])
    expect(result.lrcFiles).toEqual(['/m/c.lrc'])
    expect(result.skipped).toBe(0)
  })

  it('取不到绝对路径的项被丢掉并计数（不再把 undefined 塞进导入）', () => {
    const result = classifyDroppedItems([
      { name: '歌.flac', path: '', isDir: false },
      { name: '好歌.mp3', path: '/m/好歌.mp3', isDir: false },
    ])

    expect(result.audioFiles).toEqual(['/m/好歌.mp3'])
    expect(result.skipped).toBe(1)
  })

  it('非音频非目录非 lrc → 三堆都空、skipped 为 0（调用方据此打「没有可导入内容」的日志）', () => {
    const result = classifyDroppedItems([{ name: 'x.txt', path: '/m/x.txt', isDir: false }])

    expect(result.folders).toEqual([])
    expect(result.audioFiles).toEqual([])
    expect(result.lrcFiles).toEqual([])
    expect(result.skipped).toBe(0)
  })
})
