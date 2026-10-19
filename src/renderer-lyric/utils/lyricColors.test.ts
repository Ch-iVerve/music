import { describe, expect, it } from 'vitest'
import { resolveLyricColors } from './lyricColors'

/**
 * 歌词文字色**只由主题派生**（ADR-0007）：设置里已没有任何颜色项，
 * 配置文件里可能残留的旧值也不再有消费者——所以这些断言只钉「主题引用 + 描边比例」，
 * 不涉及任何用户值。
 */

describe('resolveLyricColors（只由主题派生）', () => {
  it('未播/已播/阴影三色全部是 `var(--color-*)` 主题引用', () => {
    const colors = resolveLyricColors()
    expect(colors['--color-lyric-unplay']).toBe('var(--color-primary-dark-200)')
    expect(colors['--color-lyric-played']).toBe('var(--color-1000)')
    expect(colors['--color-lyric-shadow']).toContain('var(--color-000)')
  })

  it('输出里没有任何字面颜色值（设置来源已全链下架，旧配置的值进不来）', () => {
    const colors = resolveLyricColors()
    for (const value of Object.values(colors)) {
      expect(value).toContain('var(--color-')
    }
    expect(Object.keys(colors).sort()).toEqual([
      '--color-lyric-played',
      '--color-lyric-shadow',
      '--color-lyric-shadow-font-mode',
      '--color-lyric-unplay',
    ])
  })

  it('逐字歌词模式的阴影仍是 9%，比行模式的 18% 浅', () => {
    const colors = resolveLyricColors()
    expect(colors['--color-lyric-shadow']).toContain('18%')
    expect(colors['--color-lyric-shadow-font-mode']).toContain('9%')
  })

  it('阴影色取的是字体色尺度的另一端（`--color-000`），随亮暗主题自动反向', () => {
    const colors = resolveLyricColors()
    expect(colors['--color-lyric-shadow']).toContain('color-mix(in srgb, var(--color-000)')
    expect(colors['--color-lyric-shadow-font-mode']).toContain('color-mix(in srgb, var(--color-000)')
  })
})
