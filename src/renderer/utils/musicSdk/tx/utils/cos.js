import crypto from 'node:crypto'

/**
 * 腾讯云 COS（对象存储）XML API 的请求签名 —— `q-sign-algorithm=sha1` 那一套。
 *
 * 为什么要自己实现：歌单封面要**从浏览器直传 COS**（服务端只发临时密钥，不走我们的后端），
 * 而渲染侧没有 COS SDK。算法本身不长，但**每一处都不能错**（差一个换行或大小写就是 403
 * SignatureDoesNotMatch），所以这里做成纯函数单独放一个文件、单测钉死。
 *
 * 参照实现：官方 SDK `cos-python-sdk-v5` 的 `cos_auth.CosS3Auth`（本机 venv 实测通过的那份），
 * 逐行对齐它的四段式：
 *
 *     signKey      = HMAC-SHA1(secretKey, signTime)              → hex
 *     httpString   = method\npath\nurlParams\nheaderString\n     ← 签名头按 **小写名 + 一次
 *                                                                   RFC3986 编码** 后排序拼接
 *     stringToSign = sha1\nsignTime\nSHA1hex(httpString)\n
 *     signature    = HMAC-SHA1(signKey, stringToSign)            → hex
 *
 * 三个易错点（照 SDK 抄下来的，别"简化"）：
 *   1. `signKey` 是把 **hex 字符串**当 HMAC 的 key（不是原始字节）；
 *   2. `httpString` 的第 4 段结尾**必须**有换行（SDK 的 format_str 末尾是 `\n`）；
 *   3. 头的 key 与 value 都要编码，且安全集只有 `A-Za-z0-9-_.~`（`/`、`+`、`=`、`:` 都要转义）
 *      —— 临时密钥的 token 里常带这些字符，漏了就会签名不符。
 *
 * ⚠️ 静态安全扫描会把下面两处 `sha1` 报成 weak-crypto（CWE-328）——**这是协议规定的算法名**
 * （COS 的 `q-sign-algorithm=sha1`，换成别的服务端直接判签名不符），不是本项目的加密选型；已接受。
 *
 * 只签名**我们完全控制**的头（host / content-type / x-cos-security-token）：`content-length`
 * 由请求库自己算（needle 可能走 chunked），签它等于给自己埋雷；COS 只校验声明过的头。
 */

/** 严格 RFC3986：`encodeURIComponent` 额外放过 `!*'()`，这里补上（与 Python `quote(s, '-_.~')` 等价）。 */
const encodeCos = (value) => encodeURIComponent(String(value)).replace(/[!*'()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)

export const sha1Hex = (data) => crypto.createHash('sha1').update(data).digest('hex')

export const hmacSha1Hex = (key, data) => crypto.createHmac('sha1', key).update(data).digest('hex')

/**
 * 签名有效期。SDK 用 `[now-60, now+expire]`：往前留 60 秒是容忍本机时钟快（签名"还没生效"同样会被拒）。
 * 我们签一次只用于紧跟其后的一次 PUT，1 小时足够，同时不把窗口开太大。
 */
export const buildSignTime = (now = Math.floor(Date.now() / 1000), expire = 3600) => `${now - 60};${now + expire}`

/**
 * 拼 `Authorization` 头。
 *
 * @param {object} options
 * @param {string} options.secretId 临时密钥 SecretID
 * @param {string} options.secretKey 临时密钥 SecretKey
 * @param {string} options.method HTTP 方法（大小写不敏感，参与签名的是小写）
 * @param {string} options.path 对象的 URL 路径（**以 `/` 开头**，不含 host 与 query）
 * @param {Record<string, string>} options.headers 参与签名的头（含 host）
 * @param {string} options.signTime `buildSignTime()` 的产物
 * @returns {string} 可直接放进 `Authorization` 请求头的串
 */
export const buildCosAuthorization = ({ secretId, secretKey, method, path, headers, signTime }) => {
  const pairs = Object.keys(headers)
    .map(key => [encodeCos(key.toLowerCase()), encodeCos(headers[key])])
    .sort((a, b) => (a[0] === b[0] ? 0 : (a[0] < b[0] ? -1 : 1)))
  const headerString = pairs.map(([key, value]) => `${key}=${value}`).join('&')
  const headerList = pairs.map(([key]) => key).join(';')

  const httpString = `${String(method).toLowerCase()}\n${path}\n\n${headerString}\n`
  const stringToSign = `sha1\n${signTime}\n${sha1Hex(httpString)}\n`
  const signature = hmacSha1Hex(hmacSha1Hex(secretKey, signTime), stringToSign)

  return 'q-sign-algorithm=sha1' +
    `&q-ak=${secretId}` +
    `&q-sign-time=${signTime}` +
    `&q-key-time=${signTime}` +
    `&q-header-list=${headerList}` +
    '&q-url-param-list=' +
    `&q-signature=${signature}`
}
