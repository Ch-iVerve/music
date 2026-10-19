/**
 * 歌词文字色的取值规则：**只由主题派生**，没有任何用户/设置来源（ADR-0007 决策 D7）。
 * 设置页那三个取色器与「用户值覆盖」判定已删除——这是**有意的能力回收**，不是 bug：
 * 原来覆盖条件是「存储值 ≠ 内置默认值」，导致手动选回默认色会静默回到主题色（屏幕色与色块不一致）。
 * 要再开自定义色，请做成**主题字段**（让主题编辑器能改），不要再加一组用户设置。
 *
 * 主题派生值写成 `var(--color-*)` 间接引用（几个主题变量由 `window.setTheme` 写在 `:root` 上），
 * 于是换主题/切亮暗时 CSS 自己就跟着变了，不需要 JS 逐个重算颜色。
 * ⚠️ 已播/未播两色与主窗口歌词（`LyricPlayer.vue`）**刻意相反**（2026-10-18 用户要求互换，
 * 不要当笔误改回去）：
 * - 未播放行 → `--color-primary-dark-200`：主题强调色
 * - 当前播放行 / 已唱行 → `--color-1000`：主题字体色（深色主题偏白、浅色主题偏黑），与面板底色同源。
 *   （互换前曾用 `--color-primary-dark-200` 标已播；别用 `--color-theme` 标任何一端：
 *   深色主题下它是 primary-light-900，本机实测 black 主题只有 rgb(59,59,59)，
 *   压在深色面板上等于看不见。）
 * - 描边 → `--color-000`（字体色尺度的另一端）压到低透明度：文字亮则描边暗，反之亦然，
 *   所以切亮/暗主题时描边自动反向，不会出现「白字白描边」把对比度做坏
 */
export const THEME_LYRIC_COLORS = {
  '--color-lyric-unplay': 'var(--color-primary-dark-200)',
  '--color-lyric-played': 'var(--color-1000)',
  '--color-lyric-shadow': 'color-mix(in srgb, var(--color-000) 18%, transparent)',
}

/** 字体模式（逐字歌词）的描边比行模式更弱：与 `RGB_Alpha_Shade(0.49, …)` 同比例 */
const THEME_LYRIC_SHADOW_FONT_MODE = 'color-mix(in srgb, var(--color-000) 9%, transparent)'

export type LyricColorStyle = Record<'--color-lyric-unplay' | '--color-lyric-played' | '--color-lyric-shadow' | '--color-lyric-shadow-font-mode', string>

export const resolveLyricColors = (): LyricColorStyle => ({
  ...THEME_LYRIC_COLORS,
  '--color-lyric-shadow-font-mode': THEME_LYRIC_SHADOW_FONT_MODE,
})
