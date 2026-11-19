declare namespace LX {
  namespace QQAuth {
    /**
     * QQ 音乐登录凭证。
     * 字段对齐 QQMusicApi 的 Credential（qqmusic_api/models/request.py:63-118）。
     */
    interface Credential {
      musicid: number | string
      /** 即 authst，取流鉴权用它（见 docs/specs/0001 §4.2） */
      musickey: string
      refreshKey?: string
      refreshToken?: string
      accessToken?: string
      openid?: string
      unionid?: string
      strMusicid?: string
      /** 过期时间戳（秒） */
      expiredAt?: number
      musickeyCreateTime?: number
      /** 有效时长（秒），实测 259200 = 3 天 */
      keyExpiresIn?: number
      encryptUin?: string
      /** 1=微信，2=QQ */
      loginType?: number
      /**
       * 网页侧会话 cookie（`p_skey`）：登录第 ③ 步 `check_sig` 拿到、随凭证一起落盘。
       *
       * **为什么存它**：关注 / 取消关注歌手只有老式 h5
       * （`c.y.qq.com/rsc/fcgi-bin/fcg_order_singer_add.fcg` / `_del.fcg`）这一条写通道，
       * 那条通道用 `g_tk = hash33(p_skey, 5381)` 做 CSRF。不存的话，每次重启后第一次关注都要重新扫码。
       * 决策：持久化网页会话 p_skey（明文凭证，0600，单用户机器）。
       *
       * ⚠️ **生命周期与 `musickey` 不同**：**不能**用 musickey 的刷新链去续（刷新接口认 `refresh_key`），
       * 过期后只能请用户重新扫码；`refresh` 必须原样保留它，别把它当成可刷新的字段。
       */
      p_skey?: string
      /**
       * 登录用的 QQ 号。与 `musicid` **不是**同一个东西——老式 h5 的 cookie 要的是这个（`uin`），
       * 而 `p_skey` 也是按它签发的，两者必须配套使用（`g_tk` 才算得对）。
       */
      uin?: string
    }

    /** 渲染侧可见的登录状态。刻意不含任何密钥值。 */
    interface Status {
      isLogin: boolean
      /** 已脱敏：仅保留末 4 位，避免日志/界面泄露完整账号 */
      musicidMasked: string | null
      /** 过期时间戳（秒） */
      expiresAt: number | null
      /** 距过期的剩余秒数，负数表示已过期 */
      expiresInSeconds: number | null
      lastRefreshError: string | null
    }

    type SetCredentialParams = Credential

    /**
     * 扫码登录状态事件。数值对照 QQMusicApi models/login.py:23-27。
     * SCAN=未扫描等待中，CONF=已扫描待手机确认，DONE=登录完成。
     */
    type LoginEvent = 'DONE' | 'SCAN' | 'CONF' | 'TIMEOUT' | 'REFUSE'

    /** 二维码以 data URL 返回，渲染侧可直接塞进 <img src>，无需落盘。 */
    interface QrCode {
      dataUrl: string
      /** 生成时间戳（毫秒），供界面显示倒计时（QQ 二维码约 2 分钟失效） */
      createdAt: number
    }

    interface LoginCheckResult {
      event: LoginEvent
      /** 仅在 event === 'DONE' 时返回 */
      status?: Status
      message?: string
    }

    interface RefreshResult {
      ok: boolean
      status: Status
      message?: string
    }
  }
}
