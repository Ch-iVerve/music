import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readTrackTags, writeTrackTags } from './taglib'

/**
 * tag 读写胶水层的行为测试（票 08）。
 *
 * taglib-wasm 本体有上游测试；这里测的是**我们的接缝**：显式 wasmBinary 初始化（打包寻址问题的
 * 绕行方案）+ buffer 写回落盘 + 「undefined 字段不动」契约 + 回读一致。夹具=合成 WAV（真实字节，
 * TagLib 可解析可写）；mp3/flac/m4a/ogg 的格式矩阵在真机验收（票 12）用真实文件复核。
 *
 * wasm 取自仓库 node_modules（taglib-wasm 是正式依赖，CI 安装后必然存在——缺失就直接红，不跳过）。
 */

const wasmPath = path.join(process.cwd(), 'node_modules/taglib-wasm/dist/taglib-web.wasm')
const tmpRoot = path.join(os.tmpdir(), 'chiverve-taglib-')

/** 最小 1×1 红色 PNG（常量字节，作封面写入样本） */
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

/** 合成可解析的 WAV（同 library.test.ts 的夹具）；WAV 只验文本字段（TagLib 不给 WAV 写封面） */
const makeWav = (filePath: string, seed: number) => {
  const payload = Buffer.alloc(2048, seed)
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + payload.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(8000, 24)
  header.writeUInt32LE(16000, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(payload.length, 40)
  fs.writeFileSync(filePath, Buffer.concat([header, payload]))
}

/** 合成 MP3：MPEG-1 Layer III 44.1kHz/128kbps 的合法帧流（帧长 417B），供封面写入用 */
const makeMp3 = (filePath: string, frames = 40) => {
  const frame = Buffer.alloc(417)
  frame[0] = 0xFF
  frame[1] = 0xFB // MPEG1 Layer3 无 CRC
  frame[2] = 0x90 // 44.1kHz, 128kbps
  frame[3] = 0x00
  fs.writeFileSync(filePath, Buffer.concat(Array.from({ length: frames }, () => frame)))
}

beforeAll(() => {
  fs.mkdirSync(tmpRoot, { recursive: true })
  expect(fs.existsSync(wasmPath)).toBe(true) // 前提：依赖已安装、wasm 就位
})

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

describe('tag 读写胶水（显式 wasmBinary 初始化）', () => {
  it('MP3：全字段写→读 round-trip 一致；封面写入后 hasPic 翻转、体积变化反映回读', async() => {
    const file = path.join(tmpRoot, 'round.mp3')
    makeMp3(file)

    const coverPath = path.join(tmpRoot, 'cover.png')
    fs.writeFileSync(coverPath, PNG_1PX)

    const derived = await writeTrackTags({
      filePath: file,
      wasmPath,
      edits: {
        name: '测试标题',
        singer: '测试歌手',
        album: '测试专辑',
        year: '2020',
        genre: 'Test',
        trackNum: '3',
        discNum: '1',
      },
      coverSourcePath: coverPath,
    })

    expect(derived.hasPic).toBe(true)
    expect(fs.statSync(file).size).toBe(derived.size)

    const info = await readTrackTags(file, wasmPath)
    expect(info.name).toBe('测试标题')
    expect(info.singer).toBe('测试歌手')
    expect(info.album).toBe('测试专辑')
    expect(info.year).toBe('2020')
    expect(info.genre).toBe('Test')
    expect(info.hasPic).toBe(true)
    expect(info.cover).not.toBeNull()
    expect(info.cover!.format).toBe('image/png')
    expect(info.cover!.data.length).toBe(PNG_1PX.length)
  })

  it('WAV：文本字段 round-trip（TagLib 不给 WAV 写封面，封面矩阵走 MP3 与真机）', async() => {
    const file = path.join(tmpRoot, 'text.wav')
    makeWav(file, 1)

    await writeTrackTags({
      filePath: file,
      wasmPath,
      edits: { name: '仅文本', singer: 'WAV 歌手', album: 'WAV 专辑' },
      coverSourcePath: null,
    })

    const info = await readTrackTags(file, wasmPath)
    expect(info.name).toBe('仅文本')
    expect(info.singer).toBe('WAV 歌手')
    expect(info.album).toBe('WAV 专辑')
  })

  it('undefined 字段不动（批量编辑「留空不改」的契约）', async() => {
    const file = path.join(tmpRoot, 'partial.wav')
    makeWav(file, 2)
    await writeTrackTags({
      filePath: file,
      wasmPath,
      edits: { name: '第一次的名字', singer: '第一次的歌手' },
      coverSourcePath: null,
    })

    await writeTrackTags({
      filePath: file,
      wasmPath,
      edits: { name: '改后的名字' },
      coverSourcePath: null,
    })

    const info = await readTrackTags(file, wasmPath)
    expect(info.name).toBe('改后的名字')
    expect(info.singer).toBe('第一次的歌手')
  })
})
