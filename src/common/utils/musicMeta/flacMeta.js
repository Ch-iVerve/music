const fs = require('fs')
const fsPromises = fs.promises
const path = require('path')
const getImgSize = require('image-size')
const download = require('./downloader')

const FlacProcessor = require('./flac-metadata/index')

const extReg = /^(\.(?:jpe?g|png)).*$/
const vendor = 'reference libFLAC 1.2.1 20070917'

/**
 * 把新 metadata 写进 FLAC，**返回一个「写完落盘后」才 resolve 的 Promise**。
 *
 * 为什么要返回 Promise（2026-10-13 真机教训）：调用方是 `await writeMeta(...)`，而这里原本是
 * fire-and-forget —— await 立刻过，下载收尾的「收编入库」随即对**同一个文件**开跑：收编在
 * 哈希/解析/复制的同时，这里正 unlink 原文件 + rename 临时文件，两边赛跑。后果是真机上
 * 下载的歌进不了库（收编读到半路消失的文件而失败），且 rename 那步在 unlink 报 ENOENT 时
 * 被 `return` 跳过、永不执行，47MB 的 `.lxmtemp` 便留在暂存目录里成了孤儿。
 *
 * 落盘顺序（同目录 rename，原子）：reader 原文件 → processor 改写 → writer 临时件；
 * 写完先删原文件、再把临时件改名回原名。**原文件已不在（ENOENT）时也要改名**，否则临时件
 * 会永远留成 `.lxmtemp`。reader / writer / processor 都挂 error：以前没挂，流错误会直接
 * 变成未处理的 'error' 事件（进程级崩溃风险）。
 */
const writeMeta = async(filePath, meta, picPath) => {
  const comments = Object.keys(meta).map(key => `${key.toUpperCase()}=${meta[key] || ''}`)
  const data = {
    vorbis: {
      vendor,
      comments,
    },
  }
  if (picPath) {
    const apicData = await fsPromises.readFile(picPath)
    let imgSize = getImgSize(apicData)
    let mime_type
    let bitsPerPixel
    if (apicData[0] == 0xff && apicData[1] == 0xd8 && apicData[2] == 0xff) {
      mime_type = 'image/jpeg'
      bitsPerPixel = 24
    } else {
      mime_type = 'image/png'
      bitsPerPixel = 32
    }
    data.picture = {
      pictureType: 3,
      mimeType: mime_type,
      description: '',
      width: imgSize.width,
      height: imgSize.height,
      bitsPerPixel,
      colors: 0,
      pictureData: apicData,
    }
  }

  const tempPath = filePath + '.lxmtemp'
  return new Promise((resolve, reject) => {
    const reader = fs.createReadStream(filePath)
    const writer = fs.createWriteStream(tempPath)
    const flacProcessor = new FlacProcessor()
    flacProcessor.writeMeta(data)

    const fail = err => { reject(err) }
    reader.on('error', fail)
    writer.on('error', fail)
    flacProcessor.on('error', fail)

    writer.on('finish', () => {
      fs.unlink(filePath, err => {
        // 原文件已被删掉不算失败（临时件已是完整的新文件，改名回位即可）
        if (err && err.code !== 'ENOENT') return reject(err)
        fs.rename(tempPath, filePath, err2 => {
          if (err2) reject(err2)
          else resolve()
        })
      })
    })

    reader.pipe(flacProcessor).pipe(writer)
  })
}

module.exports = (filePath, meta, proxy) => {
  if (!meta.APIC) return writeMeta(filePath, meta)
  let picUrl = meta.APIC
  delete meta.APIC
  if (!/^http/.test(picUrl)) {
    return writeMeta(filePath, meta)
  }
  let ext = path.extname(picUrl)
  let picPath = filePath.replace(/\.flac$/, '') + (ext ? ext.replace(extReg, '$1') : '.jpg')

  if (picUrl.includes('music.126.net')) picUrl += `${picUrl.includes('?') ? '&' : '?'}param=500y500`
  // 封面两条路都要把 promise 传出去（写标签的等待不能因为走了哪条分支而丢失）；
  // 封面文件在写完标签后再删（以前是写完立刻删，node-id3/flac 处理器可能还在读它）
  return download(picUrl, picPath, proxy).then(success => {
    if (success) {
      return writeMeta(filePath, meta, picPath).finally(() => {
        fs.unlink(picPath, err => {
          if (err) console.log(err.message)
        })
      })
    }
    return writeMeta(filePath, meta)
  })
}
