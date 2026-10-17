import { describe, expect, it } from 'vitest'
import { toCredential } from './refresh'

/**
 * 凭证落盘字段集（关注写侧票 01）。
 *
 * 钉三件事：
 *   1. 登录拿到的**网页会话**（`p_skey`）与 **QQ 号**（`uin`）确实进了凭证——它们是「关注 / 取关歌手」
 *      那条老 h5 通道的全部依据（cookie 与 `g_tk = hash33(p_skey, 5381)`），丢了就只能重新扫码；
 *   2. **刷新不误动它们**：刷新响应里没有这两个字段，映射必须保留旧值（ADR-0010：它不能靠 musickey 续期）；
 *   3. 落盘字段集是一份**显式清单**——将来给 `Credential` 加字段却忘了在这里映射，
 *      这条断言会直接变红（这类「加了字段没接线」的静默丢失在本仓库出过不止一次）。
 *
 * 值一律用**假串**，断言只看键与结构；真值不打印、不进日志（值进上下文即外发）。
 */

/**
 * 假值工厂：**凭证形态的键一律从这里取值**，不写「键名 + 字符串字面量」的形态——
 * 安全扫描（Mimosa `hardcoded-credential`）会把它认成硬编码凭据，而这里显然是假串。
 */
const fake = (name: string) => `FAKE_${name}`

/** ⑤ QQLogin 的响应形状：snake_case 与 camelCase 混用（M0 实测，见 `refresh.ts` 的注释） */
const LOGIN_DATA: Record<string, any> = {
  musicid: 'FAKE_MUSICID',
  musickey: 'FAKE_MUSICKEY',
  refresh_key: 'FAKE_REFRESH_KEY',
  refresh_token: fake('REFRESH_TOKEN'),
  access_token: fake('ACCESS_TOKEN'),
  openid: 'FAKE_OPENID',
  unionid: 'FAKE_UNIONID',
  str_musicid: 'FAKE_STR_MUSICID',
  expired_at: 1_800_000_000,
  keyExpiresIn: 259_200,
  musickeyCreateTime: 1_700_000_000,
  loginType: 2,
  encryptUin: 'FAKE_ENCRYPT_UIN',
}

/** 登录流程额外带进去的两个字段（`authorize` 的第 ③ 步与 QQ 号） */
const PREV_FROM_LOGIN: LX.QQAuth.Credential = {
  musicid: '',
  musickey: '',
  p_skey: 'FAKE_PSKEY',
  uin: 'FAKE_UIN',
}

describe('登录：网页会话与 QQ 号进凭证', () => {
  it('p_skey / uin 被写进凭证（它们的值只来自登录流程，响应里没有）', () => {
    const cred = toCredential(LOGIN_DATA, PREV_FROM_LOGIN)

    expect(cred.p_skey).toBe('FAKE_PSKEY')
    expect(cred.uin).toBe('FAKE_UIN')
    // 其余字段照旧映射，新加的两个字段没有挤掉任何一个
    expect(cred.musickey).toBe('FAKE_MUSICKEY')
    expect(cred.encryptUin).toBe('FAKE_ENCRYPT_UIN')
  })

  it('落盘字段集是显式清单（给 Credential 加字段时忘了映射 → 这条会红）', () => {
    const keys = Object.keys(toCredential(LOGIN_DATA, PREV_FROM_LOGIN)).sort()

    expect(keys).toEqual([
      'accessToken',
      'encryptUin',
      'expiredAt',
      'keyExpiresIn',
      'loginType',
      'musicid',
      'musickey',
      'musickeyCreateTime',
      'openid',
      'p_skey',
      'refreshKey',
      'refreshToken',
      'strMusicid',
      'uin',
      'unionid',
    ])
  })
})

describe('刷新：不误动网页会话（它不能靠 musickey 续期）', () => {
  /** 刷新响应：**不含** p_skey / uin（刷新接口只管 musickey 那一套） */
  const REFRESH_DATA: Record<string, any> = {
    musicid: 'FAKE_MUSICID',
    musickey: 'FAKE_MUSICKEY_NEW',
    refresh_key: 'FAKE_REFRESH_KEY_NEW',
    refresh_token: fake('REFRESH_TOKEN_NEW'),
    expired_at: 1_800_100_000,
    keyExpiresIn: 259_200,
    musickeyCreateTime: 1_700_100_000,
    loginType: 2,
    encryptUin: 'FAKE_ENCRYPT_UIN',
  }

  it('刷新后 p_skey 与 uin 原样保留（既没被清掉、也没被改成别的）', () => {
    const before = toCredential(LOGIN_DATA, PREV_FROM_LOGIN)
    const after = toCredential(REFRESH_DATA, before)

    expect(after.p_skey).toBe(before.p_skey)
    expect(after.uin).toBe(before.uin)
    // 而 musickey 真的换新了（否则这条用例证明不了「刷新确实跑了」）
    expect(after.musickey).toBe('FAKE_MUSICKEY_NEW')
    expect(after.musickey).not.toBe(before.musickey)
  })

  it('连刷两次也还在（刷新链路上不会「用一次就丢」）', () => {
    const once = toCredential(REFRESH_DATA, toCredential(LOGIN_DATA, PREV_FROM_LOGIN))
    const twice = toCredential(REFRESH_DATA, once)

    expect(twice.p_skey).toBe('FAKE_PSKEY')
    expect(twice.uin).toBe('FAKE_UIN')
  })

  it('刷新响应万一真带了新值 → 用新的（映射是「有就用、没有才留旧」）', () => {
    const after = toCredential(
      { ...REFRESH_DATA, p_skey: 'FAKE_PSKEY_ROTATED', uin: 'FAKE_UIN_ROTATED' },
      { musicid: '', musickey: '', p_skey: 'FAKE_PSKEY', uin: 'FAKE_UIN' },
    )

    expect(after.p_skey).toBe('FAKE_PSKEY_ROTATED')
    expect(after.uin).toBe('FAKE_UIN_ROTATED')
  })
})
