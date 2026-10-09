import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { ensureMediaDir, resolveMediaDir } from './mediaDir'

/**
 * 媒体目录工具的行为测试（票 01）。
 *
 * 关键契约是「算路径」与「建目录」分离（两轴审查修正后的形态）：
 * `resolveMediaDir` **不碰文件系统**（启动喂 envParams 用，没过媒体库的用户目录里不冒出空文件夹）；
 * `ensureMediaDir` 才落盘建目录且幂等。userDataPath 被 mock 掉（它顶层 import electron 的 `app`），
 * 目录行为用真实 fs 在临时目录里验证。
 */

const { getUserDataPathMock } = vi.hoisted(() => ({ getUserDataPathMock: vi.fn<() => string>() }))
vi.mock('./userDataPath', () => ({ getUserDataPath: getUserDataPathMock }))

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'chiverve-media-dir-'))
const fakeUserData = path.join(tmpRoot, 'ud')

getUserDataPathMock.mockImplementation(() => fakeUserData)

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

describe('resolveMediaDir / ensureMediaDir', () => {
  it('resolve 只算路径：返回 <userData>/media，且不创建任何目录', () => {
    const dir = resolveMediaDir()
    expect(dir).toBe(path.join(fakeUserData, 'media'))
    expect(fs.existsSync(dir)).toBe(false)
  })

  it('ensure 建目录（含多级父目录）且幂等；resolve 复用同一路径', () => {
    const dir = ensureMediaDir()
    expect(dir).toBe(resolveMediaDir())
    expect(fs.statSync(dir).isDirectory()).toBe(true)
    expect(ensureMediaDir()).toBe(dir) // 第二次调用不抛错（目录已在）
    fs.rmSync(dir, { recursive: true })
    expect(fs.existsSync(dir)).toBe(false) // 可重建（目录被外部删掉后自愈）
    expect(fs.existsSync(ensureMediaDir())).toBe(true)
  })
})
