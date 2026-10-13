import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { ingestLocalFiles, reconcileLibrary } from './library'

/**
 * 托管导入管线的行为测试（票 02 的主 seam，spec Testing Decisions）。
 *
 * 只测外部行为：给这些文件，产出什么曲目行、媒体目录里多了什么、进度/取消/失败汇总是什么——
 * 不 mock fs、不 mock 解析器：夹具是**合成 WAV**（真实字节，music-metadata 真能解析）。
 * 数据库不在这层（worker 摸不到主进程 dbService）：已有哈希由测试传入，产出的曲目行
 * 主线程才会落库——所以这里直接断言返回值与目录内容。
 */

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'chiverve-library-ingest-'))
let dirSeq = 0
const newDir = (prefix: string) => {
  const dir = path.join(tmpRoot, `${prefix}-${++dirSeq}`)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/** 合成一份可解析的 WAV（PCM 8k 单声道 16bit；payload 决定内容 → 决定哈希） */
const makeWav = (dir: string, name: string, payload: Buffer) => {
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + payload.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(1, 22) // mono
  header.writeUInt32LE(8000, 24)
  header.writeUInt32LE(16000, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(payload.length, 40)
  const file = path.join(dir, name)
  fs.writeFileSync(file, Buffer.concat([header, payload]))
  return file
}

const wavPayload = (seed: number) => Buffer.alloc(2048, seed)

const run = async(filePaths: string[], mediaDir: string, options: {
  existingHashes?: string[]
  shouldCancel?: () => boolean
  onProgress?: (p: { total: number, done: number, current: string }) => void
} = {}) => ingestLocalFiles(
  filePaths,
  mediaDir,
  options.existingHashes ?? [],
  options.onProgress ?? (() => {}),
  options.shouldCancel ?? (() => false),
)

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

describe('托管导入管线（ingestLocalFiles）', () => {
  it('导入即托管：产出曲目行 + 媒体目录出现哈希命名副本；原始文件原样保留', async() => {
    const srcDir = newDir('src')
    const mediaDir = newDir('media')
    const fileA = makeWav(srcDir, '歌一.wav', wavPayload(1))
    const fileB = makeWav(srcDir, '歌二.wav', wavPayload(2))
    const bytesA = fs.readFileSync(fileA)
    const mtimeA = fs.statSync(fileA).mtimeMs

    const result = await run([fileA, fileB], mediaDir)

    expect(result.cancelled).toBe(false)
    expect(result.failures).toEqual([])
    expect(result.duplicateHashes.length).toBe(0)
    expect(result.tracks.length).toBe(2)
    // 无 title tag：名称回落文件名（去扩展名）
    expect(result.tracks.map(track => track.name).sort()).toEqual(['歌一', '歌二'])
    // 哈希身份：不同内容不同哈希；托管副本存在且与源逐字节一致（原始文件不动）
    const [a, b] = result.tracks
    expect(a.id).not.toBe(b.id)
    expect(a.ext).toBe('wav')
    expect(a.size).toBe(bytesA.length)
    expect(fs.readFileSync(path.join(mediaDir, `${a.id}.wav`))).toEqual(bytesA)
    // 原始文件原样保留：字节 + 修改时间都不许动（spec D3：托管永远是复制）
    expect(fs.readFileSync(fileA)).toEqual(bytesA)
    expect(fs.statSync(fileA).mtimeMs).toBe(mtimeA)
    expect(fs.existsSync(path.join(mediaDir, `${b.id}.wav`))).toBe(true)
    // 进度走到头
    expect(result.tracks.length).toBe(2)
  })

  it('同批同内容只收一份（哈希去重），不同名文件算重复', async() => {
    const srcDir = newDir('src')
    const mediaDir = newDir('media')
    const fileA = makeWav(srcDir, 'a.wav', wavPayload(7))
    makeWav(srcDir, 'b.wav', wavPayload(7)) // 同内容不同名

    const result = await run([fileA, path.join(srcDir, 'b.wav')], mediaDir)

    expect(result.tracks.length).toBe(1)
    expect(result.duplicateHashes.length).toBe(1)
    expect(fs.readdirSync(mediaDir).length).toBe(1)
  })

  it('已有哈希（来自库）被跳过：不复制、不重复产出行', async() => {
    const srcDir = newDir('src')
    const mediaDir = newDir('media')
    const fileA = makeWav(srcDir, 'a.wav', wavPayload(3))

    const first = await run([fileA], mediaDir)
    const second = await run([fileA], mediaDir, { existingHashes: first.tracks.map(track => track.id) })

    expect(second.tracks).toEqual([])
    expect(second.duplicateHashes.length).toBe(1)
  })

  it('失败逐个跳过进汇总，不阻塞整批', async() => {
    const srcDir = newDir('src')
    const mediaDir = newDir('media')
    const good = makeWav(srcDir, 'good.wav', wavPayload(4))
    // 确定性的失败样本：文件根本不存在（hashFile ENOENT）
    const bad = path.join(srcDir, 'missing.mp3')

    const result = await run([bad, good], mediaDir)

    expect(result.failures).toEqual(['missing.mp3'])
    expect(result.tracks.map(track => track.name)).toEqual(['good'])
  })

  it('取消：已完成的部分有效（返回在 tracks 里），未开始的放弃', async() => {
    const srcDir = newDir('src')
    const mediaDir = newDir('media')
    const files = [1, 2, 3].map(seed => makeWav(srcDir, `s${seed}.wav`, wavPayload(seed)))

    let cancel = false
    const result = await run(files, mediaDir, {
      shouldCancel: () => cancel,
      onProgress: (p) => {
        if (p.done >= 1) cancel = true
      },
    })

    expect(result.cancelled).toBe(true)
    expect(result.tracks.length).toBe(1)
    expect(fs.readdirSync(mediaDir).length).toBe(1)
  })
})

/**
 * 重扫描对账（票 07）的扫描边界——2026-10-13 真机反馈：下载暂存目录 `<mediaDir>/.tmp`
 * 被列成「孤儿文件」，而两个处置动作对它都无效（收编对目录哈希必失败、`fs.rm` 不带 recursive
 * 抛 EISDIR 被吞成"删不掉"）。判据：目录与隐藏名一律不算库素材，普通文件照旧照单。
 */
describe('重扫描对账（reconcileLibrary）的扫描边界', () => {
  it('目录（含 .tmp 暂存目录）与隐藏文件不进孤儿；普通文件照旧列出', async() => {
    const mediaDir = newDir('media-scan')
    fs.writeFileSync(path.join(mediaDir, 'aaa.mp3'), 'orphan')
    fs.writeFileSync(path.join(mediaDir, '.DS_Store'), 'hidden')
    fs.mkdirSync(path.join(mediaDir, '.tmp'))
    fs.writeFileSync(path.join(mediaDir, '.tmp', 'in-flight.lxmtemp'), 'partial')
    fs.mkdirSync(path.join(mediaDir, 'subdir'))

    const report = await reconcileLibrary({ mediaDir, tracks: [] })

    expect(report.orphans).toEqual([path.join(mediaDir, 'aaa.mp3')])
  })

  it('库里有记录的文件仍按 在/丢失/大小不符 三分类，暂存目录不干扰判定', async() => {
    const mediaDir = newDir('media-scan2')
    fs.writeFileSync(path.join(mediaDir, 'hash1.mp3'), 'ok')
    fs.writeFileSync(path.join(mediaDir, 'hash2.mp3'), 'old')
    fs.mkdirSync(path.join(mediaDir, '.tmp'))
    fs.writeFileSync(path.join(mediaDir, '.tmp', 'x.lxmtemp'), 'partial')

    const report = await reconcileLibrary({
      mediaDir,
      tracks: [
        { id: 'hash1', ext: 'mp3', size: fs.statSync(path.join(mediaDir, 'hash1.mp3')).size, name: '在' },
        { id: 'hash2', ext: 'mp3', size: 999, name: '尺寸变了' },
        { id: 'hash3', ext: 'flac', size: 1, name: '文件没了' },
      ],
    })

    expect(report.orphans).toEqual([])
    expect(report.missing).toEqual([path.join(mediaDir, 'hash3.flac')])
    expect(report.mismatched).toEqual([path.join(mediaDir, 'hash2.mp3')])
  })
})
