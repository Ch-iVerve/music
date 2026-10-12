import { describe, expect, it } from 'vitest'
import defaultSetting from '@common/defaultSetting'
import migrateSetting from './migrateSetting'

/**
 * 设置迁移的语义钉子（设置页重构票 07 的 2.2.0 一档；集合概念统一后语义收窄为「只清理旧 key」）。
 *
 * 历史：老配置里的 `download.fileName`（三选一枚举）曾要原样搬到 `download.fileNameTemplate`
 * （自由模板串）；模板串已随集合概念统一（下载托管化）下架——现在这一档只做「删旧 key + 推版本」，
 * 不再写任何命名相关的新键。迁移函数是纯函数，这里当「旧库」用。
 *
 * ⚠️ 判「旧 key 没了」一律用 `hasOwn`：jest/vitest 的 `toHaveProperty('download.fileName')`
 * 把点号当**嵌套路径**（2.0 前的配置里真有个 `download` 子对象），拿它判平铺 key 会永远通过。
 */
const hasFlatKey = (setting: Partial<LX.AppSetting> | Record<string, unknown>, key: string) =>
  Object.prototype.hasOwnProperty.call(setting, key)

describe('migrateSetting：下载命名 2.2.0（旧 fileName → 清理）', () => {
  it('2.1.1 的老配置：旧 key 被删掉、不写新键（模板串已随集合概念统一下架），版本推到 2.2.0', () => {
    const result = migrateSetting({
      version: '2.1.1',
      'common.apiSource': 'builtin',
      'download.fileName': '歌手 - 歌名',
      'download.maxDownloadNum': 3,
    })

    expect(hasFlatKey(result, 'download.fileName')).toBe(false)
    expect(hasFlatKey(result, 'download.fileNameTemplate')).toBe(false)
    expect(result.version).toBe('2.2.0')
    // 同一批的其它键不受影响
    expect(result['download.maxDownloadNum']).toBe(3)
    expect(result['common.apiSource']).toBe('builtin')
  })

  it('极老配置（2.0 前的嵌套 download.fileName）同样只清不搬', () => {
    const result = migrateSetting({
      version: '1.5.0',
      download: { fileName: '歌名', enable: true },
    })

    expect(hasFlatKey(result, 'download.fileName')).toBe(false)
    expect(result.version).toBe('2.2.0')
  })

  it('已经是 2.2.0 的配置：只推版本', () => {
    const result = migrateSetting({ version: '2.2.0' })
    expect(result.version).toBe('2.2.0')
  })

  it('幂等：同一条配置连跑两遍结果一致', () => {
    const once = migrateSetting({ version: '2.1.1', 'download.fileName': '歌手 - 歌名' })
    const twice = migrateSetting({ ...once })

    expect(hasFlatKey(twice, 'download.fileName')).toBe(false)
    expect(twice.version).toBe('2.2.0')
  })
})

describe('migrateSetting：迁移写出的键名防漂移', () => {
  /** `defaultSetting` 的真实键集合；`version` 是迁移自己的游标，不是设置项，单独放行。 */
  const DEFAULT_SETTING_KEYS = new Set(Object.keys(defaultSetting))
  const isKnownSettingKey = (key: string) => key == 'version' || DEFAULT_SETTING_KEYS.has(key)

  /**
   * 迁移**新写**的键 = 输出里有、输入里没有的键。
   *
   * 为什么不拿整个输出对账：迁移的输入是用户磁盘上的旧配置，本身可能带着此刻已不存在的历史键
   * （`sync.port` 就是 v1 → 2.0.0 那次迁移写下的平铺中转键，2.1.0 再把它读进 `sync.server.port`，
   * 最终由 `mergeSetting` 按未知键丢弃）。只看新写的键，判据才是迁移交给 `mergeSetting` 的东西；
   * 错拼出来的键名（`sync.erver.port`）同样是新键，必然落在集合里，逃不掉。
   */
  const writtenKeys = (input: Record<string, unknown>) =>
    Object.keys(migrateSetting({ ...input })).filter(key => !(key in input))

  it('迁移新写的每个键都必须存在于 defaultSetting（写错名字不会报错，只是静默丢值）', () => {
    // v2.0.0 的旧配置会依次走过 2.1.0 / 2.1.1 / 2.2.0 三段迁移
    const written = writtenKeys({ version: '2.0.0', 'sync.port': '12345' })
    const unknown = written.filter(key => !isKnownSettingKey(key))

    expect(unknown, `迁移写出了 defaultSetting 不存在的键：${unknown.join(', ')}`).toEqual([])
    // 防「空集合恒过」：确认这次迁移确实新写了键（2.1.0 段写 sync.server.port、2.1.1 段写 common.apiSource）
    expect(written).toContain('sync.server.port')
    expect(written).toContain('common.apiSource')
  })

  it('v2.0.0 的旧设置：`sync.port` 的值原样搬进 `sync.server.port`（上游拼错键名，这条迁移从未生效）', () => {
    const result = migrateSetting({ version: '2.0.0', 'sync.port': '12345' })

    expect(result['sync.server.port']).toBe('12345')
    expect(result.version).toBe('2.2.0')
  })
})
