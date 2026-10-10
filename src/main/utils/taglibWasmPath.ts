import { existsSync } from 'fs'
import path from 'path'

/**
 * taglib-wasm 的 wasm 文件路径解析（本地媒体库票 08）。
 *
 * 渲染 worker 里 taglib-wasm 自带的 loader 用 `import.meta.url` 相对寻址——webpack 打包后必失效，
 * 所以走**显式 wasmBinary**：主进程用与 `db.ts` 的 better-sqlite3 nativeBinding 完全相同的套路
 * （`__dirname`（=dist）+ `../node_modules/...`，dev=仓库根、打包=asar 内）解析出普通字节文件路径，
 * 经 `envParams.taglibWasmPath` 下发；worker 读字节后 `TagLib.initialize({ wasmBinary })`。
 * 两个候选兼容 dev 与打包两种目录形态，都读不到就返回第一个（错误在使用点浮出，带明确日志）。
 */
export const resolveTaglibWasmPath = (): string => {
  const candidates = [
    // 1. dist/static（打包 + prod 构建都由 CopyWebpackPlugin 拷到这里）
    path.join(__dirname, 'static/taglib-web.wasm'),
    // 2. 仓库根 node_modules（dev 兜底）
    path.join(__dirname, '../node_modules/taglib-wasm/dist/taglib-web.wasm'),
    // 3. asar 内 node_modules（若未来把它加进 electron-builder files 白名单）
    path.join(__dirname, '../../node_modules/taglib-wasm/dist/taglib-web.wasm'),
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  console.error('[taglibWasm] 未找到 taglib-web.wasm，歌曲信息编辑将不可用：', candidates)
  return candidates[0]
}
