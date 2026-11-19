import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * 凭证定位与脱敏。
 *
 * CLI 不经应用进程，直接读落盘的凭证文件——与主进程同源（src/main/modules/qqAuth/store.ts：
 * `<userData>/LxDatas/qq_auth.json`，单键 `credential`，明文 JSON）。正式版与开发版的数据目录
 * 自 2026-09-23 起分开（src/main/utils/userDataPath.ts 的模块顶层副作用），按 profile 切换。
 *
 * 安全纪律（scripts/verify/README.md 坑 4）：值一旦进上下文/日志就外发——本模块与所有
 * 调用方只许输出字段名与脱敏值（maskMusicid），绝不打印 musickey/refreshKey/accessToken 等。
 */

const PROFILE_DIRS = {
  prod: 'chiverve-music',
  dev: 'chiverve-music-dev',
}

export const credentialPath = profile =>
  path.join(os.homedir(), '.config', PROFILE_DIRS[profile] ?? PROFILE_DIRS.prod, 'LxDatas', 'qq_auth.json')

export const loadCredential = profile => {
  const file = credentialPath(profile)
  let parsed
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (err) {
    throw new Error(`读取凭证失败（${err.code ?? err.message}）：${file}`)
  }
  const credential = parsed?.credential
  if (!credential) throw new Error(`该 profile 未登录（无 credential 键）：${file}`)
  return credential
}

/** 账号脱敏显示：只保留末 4 位（对齐 src/main/modules/qqAuth/store.ts 的 maskMusicid）。 */
export const maskMusicid = musicid => {
  const text = String(musicid ?? '')
  return text.length <= 4 ? text : `***${text.slice(-4)}`
}

/**
 * 本地过期判定：`musickeyCreateTime + keyExpiresIn`，
 * 缺字段时回退落盘的 `expiredAt`；两者都缺则 unknown。过期只能由应用刷新（refresh 走应用侧调度），
 * CLI 判出过期应提示先启动一次应用。
 */
export const expiryState = credential => {
  const created = Number(credential.musickeyCreateTime ?? 0)
  const ttl = Number(credential.keyExpiresIn ?? 0)
  if (created && ttl) {
    return { expired: (created + ttl) * 1000 < Date.now(), expireAt: new Date((created + ttl) * 1000).toISOString() }
  }
  if (credential.expiredAt) {
    const at = Number(credential.expiredAt) * 1000
    return { expired: at < Date.now(), expireAt: new Date(at).toISOString() }
  }
  return { expired: null, expireAt: null }
}

/** credential 命令的汇报行：只有字段名、脱敏值与时间——不含任何凭证值。 */
export const describeCredential = credential => {
  const state = expiryState(credential)
  return {
    profileMusicid: maskMusicid(credential.musicid),
    strMusicid: credential.strMusicid,
    loginType: credential.loginType === 1 ? 'wechat' : 'qq',
    hasEncryptUin: Boolean(credential.encryptUin),
    expired: state.expired,
    expireAt: state.expireAt,
    fields: Object.keys(credential).sort(),
  }
}
