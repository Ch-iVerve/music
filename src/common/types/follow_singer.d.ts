/**
 * 「关注 / 取消关注歌手」的写侧结果。
 *
 * 为什么要有**机器可读的原因**（而不是只给一句文案）：界面要按原因给**不同的引导**——
 * 未登录 → 登录引导；没有网页会话 / 会话过期 → 「需要重新扫码以启用关注」并就地发起扫码；
 * 频控/网络 → 只是可重试的失败。把它们混成一句「操作失败」等于让用户猜。
 * 决策：写操作持久化网页会话 p_skey（明文凭证，0600，单用户机器）。
 *
 * 读侧（「关注了没」）不用这个类型：它是三态 `boolean | null`（`null` = 取不到，界面不显示）。
 */
declare namespace LX {
  namespace FollowSinger {
    type WriteFailReason =
      /** 没有凭证 → 界面给「先登录 QQ 音乐」引导 */
      | 'not-logged-in'
      /** 有凭证但没有网页会话（`p_skey`）→ 界面给「需要重新扫码以启用关注」（ADR-0010） */
      | 'no-web-session'
      /** 网页会话被服务端拒（`1006 g_token is wrong`）→ 同样引导重新扫码 */
      | 'web-session-expired'
      | 'rate-limited'
      | 'network'
      /** 其它（含端点返回的未知 code）——把服务端原文带在 `message` 里，不猜 */
      | 'unknown'

    type WriteResult =
      | { ok: true }
      | { ok: false, reason: WriteFailReason, message: string }
  }
}
