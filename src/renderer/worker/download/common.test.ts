import { describe, expect, it, vi } from 'vitest'
import { writeMeta } from './common'

/**
 * 渲染 worker 的 `writeMeta` 是 Comlink RPC 的一端：**返回值透不透出 Promise，决定调用方的
 * await 是不是真等**。2026-10-13 真机事故的根因就在这层——不透出时 `saveMeta` 的 await 立刻过，
 * 下载收尾的收编随即对同一个文件开跑，而标签改写正在 unlink + rename 它：收编失败（歌进不了库）、
 * 临时件留成 `.lxmtemp` 孤儿。这里钉住「原样透出」这一条（RPC 层 await 的语义在 Comlink 那侧）。
 */

const mocks = vi.hoisted(() => ({ setMeta: vi.fn() }))

vi.mock('@common/utils/musicMeta', () => ({ setMeta: mocks.setMeta }))

const META = {
  filePath: '/media/.tmp/a.flac',
  isEmbedLyricLx: false,
  isEmbedLyricT: false,
  isEmbedLyricR: false,
  title: '歌名',
  artist: '歌手',
  album: '专辑',
  APIC: null,
}

describe('worker/download/common 的 writeMeta', () => {
  it('把 setMeta 的 Promise 原样透出（未落地前调用方的 await 必须挂住）', async() => {
    let resolveMeta!: () => void
    const pending = new Promise<void>((resolve) => { resolveMeta = resolve })
    mocks.setMeta.mockReturnValue(pending)

    // 直接调 writeMeta（不包一层 helper：包了会被 promise-function-async 判成"返回 promise 的函数必须 async"）
    const result = writeMeta(META, { lyric: '' } as any)
    expect(result).toBe(pending)

    resolveMeta()
    await expect(result).resolves.toBeUndefined()
  })

  it('未知格式（setMeta 返回 undefined）也不炸', () => {
    mocks.setMeta.mockReturnValue(undefined)
    expect(() => { void writeMeta(META, { lyric: '' } as any) }).not.toThrow()
  })
})
