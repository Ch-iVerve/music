const NodeID3 = require('node-id3')
const path = require('path')
const fs = require('fs')
const download = require('./downloader')
const extReg = /^(\.(?:jpe?g|png)).*$/

/**
 * 写 MP3 标签并**返回 Promise**（node-id3 0.2.9 的 `write(tags, file)` 就是 Promise）。
 * 不把返回值传出去的后果与 flacMeta 同款：调用方的 `await` 变成空等，下载收尾的收编
 * 会在标签还没写完时对同一个文件开跑（2026-10-13 真机教训）。
 */
const handleWriteMeta = (meta, filePath) => {
  if (meta.lyrics) {
    meta.unsynchronisedLyrics = {
      language: 'zho',
      text: meta.lyrics,
    }
    delete meta.lyrics
  }
  return NodeID3.write(meta, filePath)
}

module.exports = (filePath, meta, proxy) => {
  if (!meta.APIC) return handleWriteMeta(meta, filePath)
  if (!/^http/.test(meta.APIC)) {
    delete meta.APIC
    return handleWriteMeta(meta, filePath)
  }
  let ext = path.extname(meta.APIC)
  let picPath = filePath.replace(/\.mp3$/, '') + (ext ? ext.replace(extReg, '$1') : '.jpg')

  let picUrl = meta.APIC
  if (picUrl.includes('music.126.net')) picUrl += `${picUrl.includes('?') ? '&' : '?'}param=500y500`
  // 封面两条路都要把写标签的 promise 传出去；封面文件在标签写完后才删（以前是写完立刻删，
  // 读取封面的写入器可能还在读它）
  return download(picUrl, picPath, proxy).then(success => {
    if (success) {
      meta.APIC = picPath
      return handleWriteMeta(meta, filePath).finally(() => {
        fs.unlink(picPath, err => {
          if (err) console.log(err.message)
        })
      })
    }
    delete meta.APIC
    return handleWriteMeta(meta, filePath)
  })
}
