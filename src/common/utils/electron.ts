import { shell, clipboard, webUtils } from 'electron'


/**
 * 在资源管理器中打开目录
 * @param {string} dir
 */
export const openDirInExplorer = (dir: string) => {
  shell.showItemInFolder(dir)
}


/**
 * 取拖入的 DOM `File` 对应的**绝对路径**。
 *
 * 🔴 只能用 `webUtils.getPathForFile`：`file.path`（Electron 给 File 打的扩展属性）已被移除
 * （本仓 Electron 42 的官方类型里写着该方法「superseded the previous augmentation to the
 * `File` object with the `path` property」）。读 `file.path` 拿到的是 `undefined`，拖拽导入会
 * **静默失效**——2026-10-13 真机就是这么被咬的（拖文件进去「没反应」）。
 *
 * 取不到时返回空串（JS 里 new 出来的 File、或非 File 对象）——调用方要按「跳过」处理，
 * 别拿空串去 stat。
 */
export const getPathForFile = (file: File): string => webUtils.getPathForFile(file)


/**
 * 在浏览器打开URL
 * @param {*} url
 */
export const openUrl = async(url: string) => {
  if (!/^https?:\/\//.test(url)) return
  await shell.openExternal(url)
}


/**
 * 复制文本到剪贴板
 * @param str
 */
export const clipboardWriteText = (str: string) => {
  clipboard.writeText(str)
}

/**
 * 从剪贴板读取文本
 * @returns
 */
export const clipboardReadText = (): string => {
  return clipboard.readText()
}


export const encodePath = (path: string) => {
  // https://github.com/lyswhut/lx-music-desktop/issues/963
  // https://github.com/lyswhut/lx-music-desktop/issues/1461
  return path.replaceAll('%', '%25').replaceAll('#', '%23')
}
