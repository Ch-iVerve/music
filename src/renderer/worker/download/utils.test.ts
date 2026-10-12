import { describe, expect, it } from 'vitest'
import { createDownloadInfo, getMusicType } from './utils'

/**
 * `getMusicType` 的语义钉子 —— 尤其是「请求档不在支持列表时取 `list[list.length - 1]`
 * 作回退」这条（AGENTS.md §2.6 硬约束 3、`api-source-info.ts` 里对数组顺序的注释）。
 *
 * 期望值来源：`QUALITYS = ['flac24bit','flac','wav','ape','320k','192k','128k']`
 * （`src/common/constants.ts:87`，由高到低）以及 `getMusicType` 的两段逻辑：
 *   1. 请求档不在 `qualityList[source]` 里 → 取该数组**最后一项**
 *   2. 从该档开始沿 `QUALITYS` 向下找第一个 `meta._qualitys` 里真有的档位
 * 断言按这两条独立推出，不照抄实现的中间变量。
 */

const qualityList: LX.QualityList = { tx: ['128k', '320k', 'flac', 'flac24bit'] }

const buildMusicInfo = (availability: Partial<Record<LX.Quality, true>>): LX.Music.MusicInfoOnline => {
  const _qualitys: LX.Music._MusicQualityType = {}
  for (const type of Object.keys(availability) as LX.Quality[]) _qualitys[type] = { size: '1.00M' }
  return {
    id: 'tx_0039MnYb0qxYhV',
    name: '富士山下',
    singer: '陈奕迅',
    source: 'tx',
    interval: '04:19',
    meta: {
      songId: '0039MnYb0qxYhV',
      albumName: 'What s Going On...?',
      picUrl: '',
      strMediaMid: '0039MnYb0qxYhV',
      albumMid: '002fRO0N4FftzY',
      qualitys: [],
      _qualitys,
    },
  }
}

describe('getMusicType', () => {
  it('支持列表是升序时，不在列表里的档位回退到「最高档」而不是最低档', () => {
    // 192k 不在 ['128k','320k','flac','flac24bit'] 里 → 取最后一项 flac24bit
    // （注意：若哪天有人把数组改成降序，这里会静默变成回退到 128k —— 这就是本条断言的用途）
    const musicInfo = buildMusicInfo({ '128k': true, '320k': true, flac: true, flac24bit: true })
    expect(getMusicType(musicInfo, '192k', qualityList)).toBe('flac24bit')
  })

  it('支持列表是降序时，同样的请求会回退到最低档（数组顺序有语义，别乱改）', () => {
    const descending: LX.QualityList = { tx: ['flac24bit', 'flac', '320k', '128k'] }
    const musicInfo = buildMusicInfo({ '128k': true, '320k': true, flac: true, flac24bit: true })
    expect(getMusicType(musicInfo, '192k', descending)).toBe('128k')
  })

  it('请求档在列表里且该档可用时原样返回', () => {
    const musicInfo = buildMusicInfo({ '128k': true, '320k': true, flac: true, flac24bit: true })
    expect(getMusicType(musicInfo, '320k', qualityList)).toBe('320k')
    expect(getMusicType(musicInfo, 'flac24bit', qualityList)).toBe('flac24bit')
  })

  it('请求档可用但歌曲没有该档资源时，沿 QUALITYS 向下降到第一个可用的档位', () => {
    // 只有 128k 可用时，请求 flac24bit 要一路降到 128k（M3 实测的「按档降级」）
    const onlyLow = buildMusicInfo({ '128k': true })
    expect(getMusicType(onlyLow, 'flac24bit', qualityList)).toBe('128k')

    const midAndLow = buildMusicInfo({ '128k': true, '320k': true })
    expect(getMusicType(midAndLow, 'flac', qualityList)).toBe('320k')
  })

  it('qualityList 里没有这个源时直接给 128k（未注册源的静默降码路径）', () => {
    const musicInfo = buildMusicInfo({ '128k': true, '320k': true, flac: true, flac24bit: true })
    expect(getMusicType(musicInfo, 'flac', {})).toBe('128k')
  })

  it('降无可降时兜底 128k', () => {
    const nothing = buildMusicInfo({})
    expect(getMusicType(nothing, '320k', qualityList)).toBe('128k')
  })
})

/**
 * 「遇到不支持档位时的行为」开关（`download.degradeWhenUnsupported`，票 07）：
 * 默认 true = 上面那一组钉住的现有行为；false 时返回 null（「当前档位不可用」），
 * 由调用方明确失败，不许静默改档。两条路径的判定必须一一对应 —— 所以下面逐条对着
 * 上面「允许降档」的用例写。
 */
describe('getMusicType：关掉降档（degradeWhenUnsupported = false）', () => {
  it('默认参数等价于允许降档（老调用点不传第 4 个参数，行为一个字节都不变）', () => {
    const onlyLow = buildMusicInfo({ '128k': true })
    expect(getMusicType(onlyLow, 'flac24bit', qualityList)).toBe('128k')
    expect(getMusicType(onlyLow, 'flac24bit', qualityList, true)).toBe('128k')
  })

  it('请求档位可用时原样返回（开关只影响「不可用」的情形）', () => {
    const musicInfo = buildMusicInfo({ '128k': true, '320k': true, flac: true, flac24bit: true })
    expect(getMusicType(musicInfo, '320k', qualityList, false)).toBe('320k')
    expect(getMusicType(musicInfo, 'flac24bit', qualityList, false)).toBe('flac24bit')
  })

  it('歌曲没有该档资源时不改档，返回 null（不再沿 QUALITYS 向下找）', () => {
    const onlyLow = buildMusicInfo({ '128k': true })
    expect(getMusicType(onlyLow, 'flac24bit', qualityList, false)).toBeNull()

    const midAndLow = buildMusicInfo({ '128k': true, '320k': true })
    expect(getMusicType(midAndLow, 'flac', qualityList, false)).toBeNull()
  })

  it('请求档位不在音源支持列表里时返回 null，不拿列表末位兜底', () => {
    const musicInfo = buildMusicInfo({ '128k': true, '320k': true, flac: true, flac24bit: true })
    expect(getMusicType(musicInfo, '192k', qualityList, false)).toBeNull()
  })

  it('qualityList 里没有这个源时返回 null（未注册源也不静默给 128k）', () => {
    const musicInfo = buildMusicInfo({ '128k': true, '320k': true, flac: true, flac24bit: true })
    expect(getMusicType(musicInfo, 'flac', {}, false)).toBeNull()
  })

  it('档位可用但歌曲一个资源都没有时返回 null（对应「降无可降兜底 128k」那条）', () => {
    const nothing = buildMusicInfo({})
    expect(getMusicType(nothing, '320k', qualityList, false)).toBeNull()
  })
})

describe('createDownloadInfo（任务信息）', () => {
  it('metadata.quality / id 用的是**实际**档位（降档发生时不是请求档位）；暂存文件名 = 歌曲 id + 实际档位', () => {
    const onlyLow = buildMusicInfo({ '128k': true })
    const info = createDownloadInfo(onlyLow, 'flac24bit', qualityList)
    expect(info?.metadata.quality).toBe('128k')
    expect(info?.metadata.ext).toBe('mp3')
    expect(info?.id).toBe(`${onlyLow.id}_128k_mp3`)
    expect(info?.metadata.fileName).toBe(`${onlyLow.id}_128k.mp3`)
  })

  it('关掉降档时返回 null（不建任务，调用方据此提示用户）', () => {
    const onlyLow = buildMusicInfo({ '128k': true })
    expect(createDownloadInfo(onlyLow, 'flac24bit', qualityList, false)).toBeNull()
  })
})
