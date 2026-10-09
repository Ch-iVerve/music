import { existsSync, mkdirSync } from 'fs'
import path from 'path'
import { getUserDataPath } from './userDataPath'

/**
 * 本地媒体库的托管目录（本地媒体库票 01，spec D2）。
 *
 * 固定 `<userData>/media/`——用户拍板「本软件的东西都放本软件的位置」，不暴露设置项。
 * 路径只在这里拼装一次；渲染侧经 `get_env_params` 通道读取（`global.envParams.mediaDir`），
 * 不自行拼接 userData。
 *
 * 「算路径」与「建目录」是两个动作：
 * - `resolveMediaDir` 纯拼路径、**不碰文件系统**——启动时喂 `envParams` 用，没用过媒体库的
 *   用户目录里不无故多出空文件夹；
 * - `ensureMediaDir` 才落盘建目录，由真正要写文件的调用方（票 02 起的导入/播放链路）在使用前
 *   调用；mkdir 的异常留给调用方处置（弹窗/报错），不能在启动路径上炸掉主进程。
 */
let resolvedMediaDir = ''
export const resolveMediaDir = (): string => {
  if (!resolvedMediaDir) resolvedMediaDir = path.join(getUserDataPath(), 'media')
  return resolvedMediaDir
}

export const ensureMediaDir = (): string => {
  const dir = resolveMediaDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}
