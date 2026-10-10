import fs from 'node:fs'
import { TagLib, type TagLib as TagLibInstance, type Picture } from 'taglib-wasm'

/**
 * 歌曲信息的 tag 读写（票 08，spec D11）——跑在渲染 worker，**纯 buffer 流**：
 * 读托管副本字节 → `TagLib.initialize({ wasmBinary })` → open(buffer) 改 → save() →
 * `getFileBuffer()` 写回磁盘。
 *
 * - wasm 路径由主进程解析（`envParams.taglibWasmPath`）：taglib-wasm 自带 loader 用
 *   `import.meta.url` 相对寻址，webpack 打包后必失效，这里**显式喂字节**绕开它；
 *   因此只能用 Emscripten 后端（taglib-web.wasm）+ buffer 输入，**不传路径**。
 * - 碟号在 Full API 没有 tag setter，走属性通道（`DISCNUMBER`，各格式的映射表内置）。
 * - 实例按 worker 缓存一次；`wasmPath` 只在首次初始化生效。
 */

let cached: Promise<TagLibInstance> | null = null

const getTaglib = async(wasmPath: string): Promise<TagLibInstance> => {
  cached ??= (async() => {
    const wasmBinary = new Uint8Array(fs.readFileSync(wasmPath))
    return TagLib.initialize({ wasmBinary })
  })()
  return cached
}

export interface LocalTagInfo {
  name: string
  singer: string
  album: string | null
  year: string | null
  genre: string | null
  trackNum: string | null
  discNum: string | null
  hasPic: boolean
  hasLyric: boolean
  cover: { format: string, data: Uint8Array } | null
}

const toStr = (value: number | string | undefined | null): string | null =>
  value == null || value === '' ? null : String(value)

/** 读一首歌的全部 tag（编辑弹窗的初始值 + 内嵌封面字节） */
export const readTrackTags = async(filePath: string, wasmPath: string): Promise<LocalTagInfo> => {
  const taglib = await getTaglib(wasmPath)
  const bytes = new Uint8Array(fs.readFileSync(filePath))
  const file = await taglib.open(bytes)
  try {
    const tag = file.tag()
    const pictures = file.getPictures()
    const cover = pictures[0] ?? null
    const disc = file.getProperty('DISCNUMBER')?.[0] ?? null
    return {
      name: tag.title ?? '',
      singer: tag.artist ?? '',
      album: tag.album?.trim() ?? null,
      year: toStr(tag.year),
      genre: tag.genre ?? null,
      trackNum: toStr(tag.track),
      discNum: disc === '' ? null : disc,
      hasPic: pictures.length > 0,
      hasLyric: file.getLyrics().length > 0,
      cover: cover ? { format: cover.mimeType, data: cover.data } : null,
    }
  } finally {
    file.dispose()
  }
}

export interface LocalTagEdits {
  name?: string
  singer?: string
  album?: string | null
  year?: string | null
  genre?: string | null
  trackNum?: string | null
  discNum?: string | null
}

const toInt = (value: string | null | undefined): number | undefined => {
  if (value == null || value.trim() === '') return undefined
  const num = Number.parseInt(value, 10)
  return Number.isNaN(num) ? undefined : num
}

/**
 * 写 tag（文本字段 + 可选封面替换）并落盘，返回更新后的派生字段（体积/有无标记）。
 * `undefined` 的字段**不动**（批量编辑的「留空不改」契约，票 10 与单首共用）；
 * 写完**回读一次**校验落盘，派生字段以回读为准（值保真由 taglib 承诺，这里只核对有无标记与体积）。
 */
export const writeTrackTags = async(options: {
  filePath: string
  wasmPath: string
  edits: LocalTagEdits
  /** 更换封面：本地图片文件的绝对路径；null=不动封面 */
  coverSourcePath: string | null
}): Promise<{ size: number, hasPic: boolean, hasLyric: boolean }> => {
  const { filePath, wasmPath, edits, coverSourcePath } = options
  const taglib = await getTaglib(wasmPath)
  const original = new Uint8Array(fs.readFileSync(filePath))
  const file = await taglib.open(original)
  try {
    const tag = file.tag()
    if (edits.name !== undefined) tag.setTitle(edits.name)
    if (edits.singer !== undefined) tag.setArtist(edits.singer)
    if (edits.album !== undefined) tag.setAlbum(edits.album ?? '')
    if (edits.year !== undefined) {
      const year = toInt(edits.year)
      if (year != null) tag.setYear(year)
    }
    if (edits.genre !== undefined) tag.setGenre(edits.genre ?? '')
    if (edits.trackNum !== undefined) {
      const track = toInt(edits.trackNum)
      if (track != null) tag.setTrack(track)
    }
    if (edits.discNum !== undefined) {
      const disc = toInt(edits.discNum)
      // 空串=移除该属性（taglib 的显式契约）；数字写入 DISCNUMBER
      file.setProperty('DISCNUMBER', disc == null ? '' : String(disc))
    }
    if (coverSourcePath) {
      // type: FrontCover（flac/m4a 同样接受）
      const picture: Picture = {
        mimeType: coverSourcePath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg',
        data: new Uint8Array(fs.readFileSync(coverSourcePath)),
        type: 'FrontCover',
      }
      file.setPictures([picture])
    }
    file.save()
    const out = file.getFileBuffer()
    fs.writeFileSync(filePath, out)
    const verify = await taglib.open(new Uint8Array(fs.readFileSync(filePath)))
    try {
      return {
        size: out.length,
        hasPic: verify.getPictures().length > 0,
        hasLyric: verify.getLyrics().length > 0,
      }
    } finally {
      verify.dispose()
    }
  } finally {
    file.dispose()
  }
}
