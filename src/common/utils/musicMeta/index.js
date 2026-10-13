const path = require('path')
const mp3Meta = require('./mp3Meta')
const flacMeta = require('./flacMeta')

/**
 * 写内嵌标签。**必须把处理器的 Promise 原样返回**：调用方（渲染 worker 的 `writeMeta` →
 * 下载收尾的 `saveMeta`）靠它才知道「何时写完」，不返回就又回到 2026-10-13 那个真机上
 * 「收编与改写同一文件赛跑、下载的歌进不了库」的老 bug。未知格式没有处理器，返回
 * `undefined`（调用方 await 一个 undefined 也无害）。
 */
exports.setMeta = (filePath, meta, proxy) => {
  switch (path.extname(filePath)) {
    case '.mp3':
      return mp3Meta(filePath, meta, proxy)
    case '.flac':
      return flacMeta(filePath, meta, proxy)
  }
}
