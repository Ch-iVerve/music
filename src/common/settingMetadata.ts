/**
 * 设置项元数据表（设置页重构票 01）—— 左栏、节内锚点、设置搜索三个形态功能的**唯一数据源**。
 *
 * 约束与来源（改动前先读这段）：
 * - 本文件是**纯数据 + 纯类型**：不 import Vue / window / electron，落 vitest 的 node project
 *   （`src/common/**` 在 `vitest.config.ts:98-104` 的 include 白名单里）。
 * - 三级结构 `Section → Group → Item`：数组顺序即页面顺序（左栏一级分组 `navGroup` × 节名），
 *   `Group.id` 直接当节内锚点的 DOM id，项的标识用 `itemId()`（key 项 = `Item.key`，非 key 项 =
 *   `Item.id`，两种 item 见 `Item` 的注释）。
 * - 节 / 分组的划分与每一项的归属，逐项照
 *   `.scratch/settings-refactor/notes/04-item-classification.md`（134 个 key + 140 个非 key 控件
 *   逐项定去向）落地，**不要凭观感重新归类**；改名 / 拆合并的处置在该表的附 A / 附 B。
 * - `i18nKey` 的写法：能复用现有文案 key 的就复用（值由票 11 按附 A 改），新位置没有对应文案的
 *   用 `setting__*` 新 key（票 11 补四语）。每处「复用 / 新增」在注释里点名。
 * - 对账用例 `settingMetadata.test.ts` import 本文件，断言 `defaultSetting` 去掉 `version` 后
 *   每个 key **恰好登记一次**（在某个 item 或 `INTERNAL_ONLY_KEYS` 里）——新增设置 key 时必须
 *   同时在这里登记，删 key 时必须同时删 item（票 10 删桌面歌词颜色组就是这么走的）。
 *
 * 两组历史裁定（与 spec 的两处偏差，2026-09-23 定，仍生效）：
 * 1. 节顺序：spec §2 的编号把「快捷键」排在「数据与存储」之前，但一级分组的既定顺序是
 *    「… 我的音乐 / 数据 / 系统 / 高级」，而快捷键 / 网络 / 更新与关于同属「系统」——按 §2 编号
 *    会让「系统」被「数据」劈成两段。这里把 `data` 排在 `hot_key` 前，保证一级分组在左栏里连续。
 * 2. `player.isShowStatusBarLyric` / `isShowTaskProgess` 归「外观 → 托盘与系统栏」（附 B11 的裁定，
 *    附 B11 留的回退口由票 03 决定是否改判）。
 *
 * 票 05 的两条已知偏离**已于 2026-09-25 收口**（用户裁定「全补」）：
 * 1. 非 key 控件进表：`Item` 放开成 `KeyItem | NonKeyItem` 两种（见 `Item`），快捷键 28 项、
 *    清理 / 备份 / 登录等按钮全部登记——它们此前只能搜到组标题。
 * 2. 「来源显示」不再是「列表与收藏行为」组里的两项，拆成独立分组 `my_music_source`。
 */

/**
 * 一级分组（左栏里不可点的分组标题）的 id。
 * 中文显示名：general 通用 / play 播放 / my_music 我的音乐 / data 数据 / system 系统 / advanced 高级。
 */
export type SettingNavGroupId = 'general' | 'play' | 'my_music' | 'data' | 'system' | 'advanced'

/**
 * 一级分组清单：数组顺序即左栏顺序。
 * 分组标题的文案 key 放在这里（票 02 渲染左栏时直接用），避免票 02 另抄一份「六个分组」的清单。
 */
export const SETTING_NAV_GROUPS: ReadonlyArray<{ id: SettingNavGroupId, i18nKey: string }> = [
  { id: 'general', i18nKey: 'setting__nav_general' }, // 新增，票 11 补四语
  { id: 'play', i18nKey: 'setting__nav_play' },
  { id: 'my_music', i18nKey: 'setting__nav_my_music' },
  { id: 'data', i18nKey: 'setting__nav_data' },
  { id: 'system', i18nKey: 'setting__nav_system' },
  { id: 'advanced', i18nKey: 'setting__nav_advanced' },
]

/**
 * 控件的形态。每一项的 `control` 说的是「设置页里这一项该长什么样」，与真实控件的漂移由
 * 票 02/03/05 的改造收敛（票 01 只登记）。取值与现有基础组件一一对应：
 * - `checkbox`：单个复选框（`components/base/Checkbox.vue`，boolean）
 * - `checkboxGroup`：复选按钮组（同 `name` 的一组 `base-checkbox` `need`，单选语义：字体大小 / 窗口尺寸 /
 *   对齐 / 音质 / 切歌方式 / 托盘图标 / 歌词编码 …）
 * - `input`：文本输入（`base-input`，如端口 / 主机 / 服务地址）
 * - `numberInput`：数字输入（`base-input` `type="number"` + 落盘前夹取：分钟 / 秒 / 条数 / 上限）
 * - `selection`：下拉选择（`base-selection`，输出设备 / 桌面歌词字体）
 * - `slider`：滑杆（`base-slider-bar`：音量 / 倍速 / 音效增益）
 * - `pathPicker`：目录选择（只读输入 + 选择按钮，`download.savePath` 现状）
 * - `panel`：由既有浮层面板承载，设置页只给一个「打开面板」的入口（音效 17 个 key 里的 13 个）
 * - `custom`：复合控件（主题色卡及其右键两层弹窗、主字体+备用字体两个下拉拼串）
 * - `button`：**动作按钮**（2026-09-25 随非 key 项一起加）：点一下执行一次动作、或打开一个既有
 *   弹窗，没有可写的值——非 key 项里最常见的一种（清理 / 备份 / 登录 / 重置窗口 / 刷新连接码…）。
 *   与 `panel` 的分工：`panel` 说的是「这一项的值整体由那个面板承载」（点开才能改），`button`
 *   说的是「它本身就是个动作」（点完就完事，不改任何设置值）。
 */
export type SettingControl =
  | 'checkbox'
  | 'checkboxGroup'
  | 'input'
  | 'numberInput'
  | 'selection'
  | 'slider'
  | 'pathPicker'
  | 'panel'
  | 'custom'
  | 'button'

/**
 * 一个设置项 = 用户能操作的一个控件（radio / 复选组算一项）。**两种形态见下面两个接口**。
 *
 * 这两支是为「票 05 的 140 个非 key 控件装不进表」开的（2026-09-25 用户裁定全补）：不登记它们，
 * 设置搜索就只能命中所属的组标题，点进去还得自己找按钮。
 *
 * 为什么用**联合类型**而不是「两个字段都可选」：
 * - 联合能让「至少有一个标识」成为编译期保证——非 key 项不给 `id` 直接编译不过；
 * - 又不必给 134 个 key 项各抄一遍 `id`（key 项的 id 由 key 派生，见 `itemId()`，二者不可能漂移）。
 *   反过来给所有项都加必填 `id` 会让 key 项出现两份必须同步的标识，是纯风险。
 *
 * 非 key 项的 `id` 命名：`<分组 id 去掉节前缀的语义>_<控件>`（`hot_key_local_player_prev` /
 * `data_backup_import_list`），全局唯一由对账用例钉住；DOM 上标 `data-setting-id`（key 项标
 * `data-setting-key`），搜索命中就按这两个属性找控件（见 `useSettingToc.ts` 的 `findItemElement`）。
 */
export type Item = KeyItem | NonKeyItem

/** key 项：读写 `defaultSetting` 的控件，项的标识就是它的 key。 */
export interface KeyItem {
  /** `defaultSetting` 的 key；`keyof LX.AppSetting` 让拼错在编译期报错。 */
  key: keyof LX.AppSetting
  /** 恒为 `undefined`：key 项的 id 由 key 派生（见 `itemId()`）；写出来只为让联合类型两支同名。 */
  id?: undefined
  /** 这一项文案的 i18n key（非空；文案的实义与四语一致性由票 11 的用例兜）。 */
  i18nKey: string
  control: SettingControl
  /** 帮助（`?`）文案的 i18n key；没有帮助的项不写。 */
  helpI18nKey?: string
}

/**
 * 非 key 控件项：界面上能操作、但**不读写 `defaultSetting`** 的控件（快捷键录入框、清理 / 备份 /
 * 登录 / 重置窗口按钮…）。它们没有 key 可盯，改用本表自己的稳定 `id`。
 */
export interface NonKeyItem {
  key?: undefined
  /** 稳定、全局唯一的项 id；改它等于改搜索与 DOM 定位的契约，别随手改。 */
  id: string
  i18nKey: string
  control: SettingControl
  helpI18nKey?: string
}

/**
 * 项的稳定 id：**key 项 = 它的 key，非 key 项 = 显式 `id`**。
 * 搜索命中（`SearchHit.itemId`）、DOM 定位（`data-setting-key` / `data-setting-id`）、
 * 对账用例三处共用它，别再各写一份「key ?? id」。
 */
export const itemId = (item: Item): string => item.id ?? item.key

/** 节内的一个分组 = 一个 `h3` 锚点（`id` 就是它的 DOM id）。 */
export interface Group {
  /** 全局唯一，同时用作节内锚点 / 搜索结果的 DOM id（票 03 会把它写成 `h3#<group.id>`）。 */
  id: string
  i18nKey: string
  items: readonly Item[]
}

/** 设置页的一节（左栏二级项；`id` 也是 `?name=` 深链的值）。 */
export interface Section {
  /** spec §2 定下的 10 个之一。 */
  id: string
  i18nKey: string
  navGroup: SettingNavGroupId
  groups: readonly Group[]
}

/**
 * 允许 `items: []` 的分组：内容区里**只有只读展示 / 占位**、没有可操作控件的组，逐个列出并写明理由。
 *
 * 对账用例钉住两头：名单里的组**确实为空**（已经补了项却还留在名单里会被报出来），
 * 名单外的组**至少一项**——防再出现「搜索只能命中组标题」的空分组（票 05 收口的正是这条偏离）。
 * 与 `INTERNAL_ONLY_KEYS` 同一个套路：宁可显式列白名单，也不给「空分组」静默放行。
 */
export const GROUPS_WITHOUT_ITEMS: readonly string[] = [
  // 歌词偏移：设置页只有「当前这首歌偏移多少」的只读显示 + 一句「改值在歌词右键菜单」（附 B10），
  // 真正的控件在浮层（`PlayDetail/components/LyricMenu.vue`）里，没法给设置页内容区的元素挂 id。
  'data_lyric_offset',
  // 版本信息：版本号 / 代码版本 / 提交日期三行只读展示（含「连点 5 次开 DevTools」的隐藏手势），
  // 没有任何可点可写的控件。
  'about_version',
  // 网络 → 请求超时：自票 03 起就是**占位组**（本来留给「在线请求统一超时」做成设置项，票 06 把
  // `player.getUrlTimeout` 判给了「播放 → 播放稳定性」，见 `sections/network/index.vue` 注释）。
  // 组内一个控件都没有，留着只为保住锚点；真要启用它时把 id 从这里删掉并补上 items。
  'network_timeout',
]

/**
 * 内部机制键：**由交互直接写入**（拖动窗口几何）或**由产品决策固定**（单源 / 协议签署状态）的 key，
 * 不给设置页入口，且**逐个列出**（不写通配 / 前缀），对账检查才能逐 key 命中。
 * 口径与理由见 spec §1.1 裁定 2 与归类表附 C.1（2026-09-23 用户拍板，共 7 个）。
 *
 * 这份常量是代码里的唯一来源：对账检查必须 import 它，不许在测试里另抄一份
 * （否则两处漂移时检查会「自己给自己放行」）。
 */
export const INTERNAL_ONLY_KEYS: ReadonlyArray<keyof LX.AppSetting> = [
  // 内置取流实现 id：单源自用产品的产品决策，值恒为 `builtin`，对用户没有可选项；
  // 改错会让整条在线取流失效（qualityList 为空 → 搜得到点不动）。消费点 core/apiSource.ts:36,47。
  'common.apiSource',
  // 协议签署状态，不是偏好设置：由首启 PactModal 写入，导入设置 / 备份时会被强制重置为 false。
  // 入口是首启协议弹窗；设置页只在「关于 → 许可」显示状态文案。
  'common.isAgreePact',
  // 下面 4 个是桌面歌词窗的几何（宽 / 高 / X / Y）：由拖拽 / 缩放时主进程 setBounds 直接回写，
  // 设置页不该给数值输入框。唯一的用户入口是「重置窗口设置」按钮（写回 450×300 + x/y=null），
  // 该按钮是「桌面歌词 → 重置」组里的非 key 控件（`desktop_lyric_reset_window`），不在这张表里。
  'desktopLyric.width',
  'desktopLyric.height',
  'desktopLyric.x',
  'desktopLyric.y',
]

/**
 * 快捷键的两组：软件内（local）/ 全局（global）。`renderer/utils/ipc.ts` 的 `allHotKeys` 也正是
 * 这一对 key，`sections/hot_key/index.vue` 拿它渲染两组录入框。
 */
export type HotKeyGroupType = 'local' | 'global'

/**
 * 快捷键项的 id（非 key 项）：**元数据登记与 `sections/hot_key/HotKeyGrid.vue` 的 DOM 标记共用
 * 这一个函数**，免得两处手抄 `hot_key_<type>_<name>` 漂移（录入框的 items 来自 `allHotKeys[type]`，
 * 每个 entry 的 `name` 就是这里传进来的 name）。
 */
export const hotKeyItemId = (type: HotKeyGroupType, name: string) => `hot_key_${type}_${name}`

/**
 * 两组快捷键的动作名，**顺序 = 页面里录入框的顺序**（逐字照 `renderer/utils/ipc.ts` 的
 * `allHotKeys.local` / `allHotKeys.global`；顺序不同不会致命，但页面顺序与元数据顺序就分家了）。
 * 文案 key 由 `hotKeyItems()` 拼成 `setting__hot_key_<name>`——与 `HotKeyGrid.vue` 的渲染同一条规则，
 * 名字写错会在 `lang.test.ts`（声明的文案四语必须都有）被抓住。
 */
const HOT_KEY_LOCAL_NAMES = [
  'player_toggle_play',
  'player_prev',
  'player_next',
  'player_seekbackward',
  'player_seekforward',
  'player_music_dislike',
  'common_focus_search_input',
  'common_min',
  'common_toggle_close',
] as const

const HOT_KEY_GLOBAL_NAMES = [
  'common_toggle_min',
  'common_toggle_hide',
  'common_toggle_close',
  'player_toggle_play',
  'player_prev',
  'player_next',
  'player_seekbackward',
  'player_seekforward',
  'player_volume_up',
  'player_volume_down',
  'player_volume_mute',
  'player_music_love',
  'player_music_unlove',
  'player_music_dislike',
  'desktop_lyric_toggle_visible',
  'desktop_lyric_toggle_lock',
  'desktop_lyric_toggle_always_top',
] as const

/**
 * 动作名清单 → 录入框的非 key 项。`control: 'input'` 说的是形态：只读输入框，靠 focus/blur 与
 * 全局 keyDown 监听录入（值存在 `window.lx.appHotKeyConfig`，不落 `defaultSetting`）。
 * 两个组都有 `common_toggle_close`（同名不同项），它们的文案 key 因此是同一个 `setting__hot_key_*`
 * ——项 id 不同（`hot_key_local_*` / `hot_key_global_*`），搜索里靠分组区分。
 */
const hotKeyItems = (type: HotKeyGroupType, names: readonly string[]): Item[] =>
  names.map(name => ({ id: hotKeyItemId(type, name), i18nKey: `setting__hot_key_${name}`, control: 'input' }))

/**
 * 10 节 × 分组。数组顺序即页面顺序；每节的分组顺序即节内顺序。
 * 注释里的「§N.M」指归类表（notes/04-item-classification.md）的节/分组编号。
 */
export const SETTING_SECTIONS: readonly Section[] = [
  // ===================================================================================
  // §1 外观（appearance）—— 一级分组「通用」
  // ===================================================================================
  {
    id: 'appearance',
    // 复用「基本设置」的节名 key；值由票 11 改成「外观」（节本身的改名，不是新文案）
    i18nKey: 'setting__basic',
    navGroup: 'general',
    groups: [
      {
        // §1.1 主题
        id: 'appearance_theme',
        i18nKey: 'setting__basic_theme', // 复用「主题颜色」；组标题的措辞由票 11 收敛
        items: [
          // 色卡；右键色卡进「亮/暗主题设置」，右键主题项进 11 键编辑器（自定义主题上限 10 个）
          { key: 'theme.id', i18nKey: 'setting__basic_theme', control: 'custom', helpI18nKey: 'setting__basic_theme_auto_tip' },
          // 仅 theme.id == 'auto'（跟随系统）时生效
          { key: 'theme.lightId', i18nKey: 'theme_selector_modal__light_title', control: 'custom', helpI18nKey: 'theme_selector_modal__title_tip' },
          { key: 'theme.darkId', i18nKey: 'theme_selector_modal__dark_title', control: 'custom', helpI18nKey: 'theme_selector_modal__title_tip' },
        ],
      },
      {
        // §1.2 字体与字号（原来的「字体大小」h3 与「字体」h3 合成一组）
        id: 'appearance_font',
        i18nKey: 'setting__appearance_font_title', // 新增
        items: [
          // 全局根字号（16 = 标准），列表行高 = 字号 × 2.3；全屏时禁用
          { key: 'common.fontSize', i18nKey: 'setting__basic_font_size', control: 'checkboxGroup' },
          // 两个下拉框拼成 "主字体, 备用字体"；只作用于主窗口，桌面歌词另有一份
          { key: 'common.font', i18nKey: 'setting__basic_font', control: 'custom', helpI18nKey: 'setting__basic_font_tip' },
        ],
      },
      {
        // §1.3 语言
        id: 'appearance_lang',
        i18nKey: 'setting__basic_lang',
        items: [
          // 四语言；托盘菜单 / 桌面歌词窗 / 右键菜单同时跟着换
          { key: 'common.langId', i18nKey: 'setting__basic_lang', control: 'checkboxGroup', helpI18nKey: 'setting__help_shared_with_lyric_window' },
        ],
      },
      {
        // §1.4 窗口
        id: 'appearance_window',
        i18nKey: 'setting__appearance_window_title', // 新增（新组：窗口尺寸 + 全屏启动 + 圆角阴影）
        items: [
          // 主窗口固定宽度（7 档）；主窗口 resizable:false，所以这是唯一改窗口大小的途径
          { key: 'common.windowSizeId', i18nKey: 'setting__basic_window_size', control: 'checkboxGroup', helpI18nKey: 'setting__basic_window_size_tip' },
          // 全屏启动会连带禁用「窗口尺寸」「字体大小」两项；开着它启动时若桌面歌词开了「全屏时自动关闭歌词」则不建歌词窗
          { key: 'common.startInFullscreen', i18nKey: 'setting__basic_start_in_fullscreen', control: 'checkbox', helpI18nKey: 'setting__basic_start_in_fullscreen_tip' },
          // 改后要重启才生效；mac 默认 false（原生窗口），Linux/Win 默认 true
          { key: 'common.transparentWindow', i18nKey: 'setting__other_transparent_window', control: 'checkbox', helpI18nKey: 'setting__other_transparent_window_tip' },
        ],
      },
      {
        // §1.5 动画
        id: 'appearance_animation',
        i18nKey: 'setting__appearance_animation_title', // 新增（新组）
        items: [
          // 总闸：关掉后全局过渡 / 动画失效，且「弹出层随机动画」不再生效
          { key: 'common.isShowAnimation', i18nKey: 'setting__basic_show_animation', control: 'checkbox' },
          // 只影响 material-modal 的弹窗动画，不影响页面切换
          { key: 'common.randomAnimate', i18nKey: 'setting__basic_animation', control: 'checkbox' },
        ],
      },
      {
        // §1.6 控制按钮与播放栏
        id: 'appearance_control_bar',
        i18nKey: 'setting__appearance_control_bar_title', // 新增（新组）
        items: [
          // 是**窗口三连按钮**（隐藏/最小化/关闭）贴哪一侧，不是播放控制按钮
          { key: 'common.controlBtnPosition', i18nKey: 'setting__basic_control_btn_position', control: 'checkboxGroup' },
          // 切换播放栏三套完整布局组件（迷你/中等/全宽），不是「进度条粗细」
          { key: 'common.playBarProgressStyle', i18nKey: 'setting__basic_playbar_progress_style', control: 'checkboxGroup', helpI18nKey: 'setting__basic_playbar_progress_style_tip' },
        ],
      },
      {
        // §1.7 托盘与系统栏（spec §2 组名「托盘图标」；两项系统栏集成收进本组是附 B11 的裁定）
        id: 'appearance_tray',
        i18nKey: 'setting__appearance_tray_title', // 新增（新组）
        items: [
          // 一个开关管两件事：建/销托盘图标 + 关窗时 hide 而不是退出
          { key: 'tray.enable', i18nKey: 'setting__basic_to_tray', control: 'checkbox' },
          // 4 档：白 / 黑 / 原色 / 跟随系统
          { key: 'tray.themeId', i18nKey: 'setting__other_tray_theme', control: 'checkboxGroup' },
          // 仅 mac（v-if="isMac"）且依赖托盘开启；帮助文案里的旧路径要一并改（附 A9）
          { key: 'player.isShowStatusBarLyric', i18nKey: 'setting__play_statusbar_lyric', control: 'checkbox', helpI18nKey: 'setting__play_statusbar_lyric_tip' },
          // Windows/Linux 任务栏图标进度条（mac 是 Dock 进度条），与托盘图标本身无关
          { key: 'player.isShowTaskProgess', i18nKey: 'setting__play_task_bar', control: 'checkbox' },
        ],
      },
    ],
  },

  // ===================================================================================
  // §2 播放（play）—— 一级分组「播放」（7 组 = spec §2 的 6 组 + §3 新增的「播放控制默认值」，见附 B11）
  // ===================================================================================
  {
    id: 'play',
    i18nKey: 'setting__play', // 复用；值由票 11 改成「播放」
    navGroup: 'play',
    groups: [
      {
        // §2.1 播放行为
        id: 'play_behavior',
        i18nKey: 'setting__play_behavior_title', // 新增
        items: [
          // 只在「恢复了上次播放的歌」时才起作用
          { key: 'player.startupAutoPlay', i18nKey: 'setting__play_startup_auto_play', control: 'checkbox', helpI18nKey: 'setting__play_startup_auto_play_tip' },
          // 关掉后暂停时要再等 90 秒才释放阻止器（防频繁切歌反复申请）
          { key: 'player.powerSaveBlocker', i18nKey: 'setting__play_power_save_blocker', control: 'checkbox', helpI18nKey: 'setting__play_power_save_blocker_tip' },
          // 只对「非临时列表」生效（在线列表播完即弃，不记进度）
          { key: 'player.isSavePlayTime', i18nKey: 'setting__play_save_play_time', control: 'checkbox', helpI18nKey: 'setting__play_save_play_time_tip' },
          // 只影响「点播列表 == 当前播放列表」这条路径
          { key: 'player.isAutoCleanPlayedList', i18nKey: 'setting__play_auto_clean_played_list', control: 'checkbox', helpI18nKey: 'setting__play_auto_clean_played_list_tip' },
          // 一揽子容错总闸：关掉后出链 5s 切歌 / 卡顿 3s 跳 / error 事件切歌 / URL 刷新 100s 计时器四条同时失效
          { key: 'player.autoSkipOnError', i18nKey: 'setting__play_auto_skip_on_error', control: 'checkbox', helpI18nKey: 'setting__play_auto_skip_on_error_tip' },
        ],
      },
      {
        // §2.2 播放控制默认值（spec §3 新增组；5 项原先只有浮层入口，票 05 补入口）
        id: 'play_defaults',
        i18nKey: 'setting__play_defaults_title', // 新增
        items: [
          // 浮层：播放栏/详情页音量面板（VolumeBtn.vue）；主进程也拿它做系统集成
          { key: 'player.volume', i18nKey: 'player__volume', control: 'slider' },
          // 浮层：播放栏音量面板的「静音」复选框；静音不影响音量数值
          { key: 'player.isMute', i18nKey: 'player__volume_mute_label', control: 'checkbox' },
          // 浮层：播放栏倍速按钮；主窗口与桌面歌词窗共用（歌词窗下发白名单里有它）
          { key: 'player.playbackRate', i18nKey: 'player__playback_rate', control: 'slider', helpI18nKey: 'setting__help_shared_with_lyric_window' },
          // 浮层：倍速按钮里的「音调补偿」；只在有倍速时听得出
          { key: 'player.preservesPitch', i18nKey: 'player__playback_preserves_pitch', control: 'checkbox' },
          // 浮层：播放栏切歌模式按钮；5 档（listLoop/random/list/singleLoop/none），影响上一首/下一首行为
          { key: 'player.togglePlayMethod', i18nKey: 'setting__play_toggle_play_method', control: 'checkboxGroup', helpI18nKey: 'setting__play_toggle_play_method_tip' },
        ],
      },
      {
        // §2.3 歌词显示（主窗）
        id: 'play_lyric_main',
        i18nKey: 'setting__play_lyric_main_title', // 新增（新组）
        items: [
          // 本地歌的歌词来源优先级（票 09 新增 key）。放在本组第一项：它决定「歌词从哪来」，
          // 后面几项才是「拿到之后怎么显示」。只影响本地歌，一侧失败会回落（见 core/music/local.ts）
          { key: 'lyric.sourcePriority', i18nKey: 'setting__lyric_source_priority', control: 'checkboxGroup', helpI18nKey: 'setting__lyric_source_priority_tip' },
          // 主窗口与桌面歌词窗共用同一个值（歌词窗下发白名单）
          { key: 'player.isShowLyricTranslation', i18nKey: 'setting__play_lyric_transition', control: 'checkbox', helpI18nKey: 'setting__help_shared_with_lyric_window' },
          { key: 'player.isShowLyricRoma', i18nKey: 'setting__play_lyric_roma', control: 'checkbox', helpI18nKey: 'setting__help_shared_with_lyric_window' },
          { key: 'player.isSwapLyricTranslationAndRoma', i18nKey: 'setting__player_swap_lyric_trans_roma', control: 'checkbox', helpI18nKey: 'setting__help_shared_with_lyric_window' },
          // 共用；默认值在 mac 上是关的（默认 !isMac）。这里有「性能开销大」的既有提示，
          // 票 11 需把「与桌面歌词窗共用」一并写进这条文案（见票 01 回报的遗留项）
          { key: 'player.isPlayLxlrc', i18nKey: 'setting__play_lyric_lxlrc', control: 'checkbox', helpI18nKey: 'setting__play_lyric_lxlrc_tip' },
          // 转换不是显示开关；它同时影响**下载的歌词**（票 11 文案要注明）
          { key: 'player.isS2t', i18nKey: 'setting__play_lyric_s2t', control: 'checkbox', helpI18nKey: 'setting__play_lyric_s2t_tip' },
          // 主窗「当前行放大」；与桌面歌词的 desktopLyric.style.isZoomActiveLrc 是两个独立开关
          { key: 'playDetail.isZoomActiveLrc', i18nKey: 'setting__play_detail_font_zoom', control: 'checkbox', helpI18nKey: 'setting__play_detail_font_zoom_tip' },
          // 逐行滚动延迟 600ms；与桌面歌词的 desktopLyric.isDelayScroll 同名不同物
          { key: 'playDetail.isDelayScroll', i18nKey: 'setting__play_detail_lyric_delay_scroll', control: 'checkbox', helpI18nKey: 'setting__play_detail_lyric_delay_scroll_tip' },
          // 主窗歌词对齐；歌词右键菜单里有同一项的入口（改的是同一个值）
          { key: 'playDetail.style.align', i18nKey: 'setting__play_detail_align', control: 'checkboxGroup', helpI18nKey: 'setting__play_detail_align_tip' },
          // 允许拖拽歌词 seek
          { key: 'playDetail.isShowLyricProgressSetting', i18nKey: 'setting__play_detail_lyric_progress', control: 'checkbox' },
          // 浮层：歌词右键菜单的字号（70–200，100 = 1rem）；i18n 文案已存在但设置页从未渲染
          { key: 'playDetail.style.fontSize', i18nKey: 'setting__play_detail_font_size', control: 'numberInput' },
        ],
      },
      {
        // §2.4 音质
        id: 'play_quality',
        i18nKey: 'setting__play_quality_title', // 新增（新组）
        items: [
          // 目标档位；实际取「这首歌有的档位 ∩ 音源支持的档位」里最接近的，取不到退 128k。
          // 四个档位串是契约（URL 缓存 key），界面文案可以中文化但值不许动（票 11）
          { key: 'player.playQuality', i18nKey: 'setting__play_playQuality', control: 'checkboxGroup', helpI18nKey: 'setting__play_playQuality_tip' },
        ],
      },
      {
        // §2.5 音频输出
        id: 'play_audio_device',
        i18nKey: 'setting__play_audio_device_title', // 新增（新组）
        items: [
          // 与高级音频特性（音效/可视化/最大声道）互斥：已启用时这项不可用
          { key: 'player.mediaDeviceId', i18nKey: 'setting__play_mediaDevice', control: 'selection', helpI18nKey: 'setting__play_mediaDevice_tip' },
          // 开启时若已选非默认设备会被强制重置为 default
          { key: 'player.isMaxOutputChannelCount', i18nKey: 'setting__play_max_output_channel_count', control: 'checkbox', helpI18nKey: 'setting__play_max_output_channel_count_tip' },
          // 播放中拔/换设备时立即暂停
          { key: 'player.isMediaDeviceRemovedStopPlay', i18nKey: 'setting__play_mediaDevice_remove_stop_play', control: 'checkbox' },
        ],
      },
      {
        // §2.6 播放稳定性（票 06 新增组）：原本写死在播放核心里的 9 个阈值 + 1 个失败策略。
        // 每一项的默认值 = 改造前消费点上的硬编码常量，所以老配置升级上来行为不变。
        // （例外：`player.wyFallback` 是 2026-09-26 新增的兜底开关，默认开 = 新行为。）
        // 顺序即组件里的渲染顺序（`sections/play/PlayStability.vue`）：先策略（它决定要不要刷新/降档），
        // 再取流与刷新相关，再卡顿，最后是「操作步长」两项（严格说不属于稳定性，但 spec §5-A 判给了本组）。
        id: 'play_stability',
        i18nKey: 'setting__play_stability_title', // 新增
        items: [
          // 三档：retry（默认 = 老行为，同源刷新 URL）/ degrade（沿档位阶梯降一档重取）/ error（不重试）
          { key: 'player.onUrlFailStrategy', i18nKey: 'setting__play_on_url_fail_strategy', control: 'checkboxGroup', helpI18nKey: 'setting__play_on_url_fail_strategy_tip' },
          // 2026-09-26 新增（本组唯一的例外项：默认值不是「改造前常量」，而是新功能默认开）
          { key: 'player.wyFallback', i18nKey: 'setting__play_wy_fallback', control: 'checkbox', helpI18nKey: 'setting__play_wy_fallback_tip' },
          // 老行为是写死的 2 次（usePlayEvent.ts 的 `retryNum < 2`）；degrade 档下它同时是「最多降几档」
          { key: 'player.retryUrlMaxNum', i18nKey: 'setting__play_retry_url_max_num', control: 'numberInput', helpI18nKey: 'setting__play_retry_url_max_num_tip' },
          // 老行为 25 秒：加载超时先刷新一次 URL，第二次超时直接切歌
          { key: 'player.retryUrlDelay', i18nKey: 'setting__play_retry_url_delay', control: 'numberInput', helpI18nKey: 'setting__play_retry_url_delay_tip' },
          // 老行为 100 秒：一次取流（含降档重取）的总等待上限，超时按失败处理
          { key: 'player.getUrlTimeout', i18nKey: 'setting__play_get_url_timeout', control: 'numberInput', helpI18nKey: 'setting__play_get_url_timeout_tip' },
          // 老行为 5 秒：报错后等这么久再自动下一首（窗口不可见时立即跳，不等）
          { key: 'player.errorSkipDelay', i18nKey: 'setting__play_error_skip_delay', control: 'numberInput', helpI18nKey: 'setting__play_error_skip_delay_tip' },
          // 老行为 3 秒：缓冲卡住这么久才开始往前跳
          { key: 'player.stallSkipThreshold', i18nKey: 'setting__play_stall_skip_threshold', control: 'numberInput', helpI18nKey: 'setting__play_stall_skip_threshold_tip' },
          // 老行为 3–6 秒的随机区间；两值顺序写反时消费点按大小取（不额外报错）。
          // 两条讲的是同一段区间，故共用一个 helpI18nKey（与 theme_selector_modal__title_tip 同例）
          { key: 'player.stallSkipMin', i18nKey: 'setting__play_stall_skip_min', control: 'numberInput', helpI18nKey: 'setting__play_stall_skip_range_tip' },
          { key: 'player.stallSkipMax', i18nKey: 'setting__play_stall_skip_max', control: 'numberInput', helpI18nKey: 'setting__play_stall_skip_range_tip' },
          // 老行为 5 秒：快进/快退快捷键（与系统媒体键的兜底步长）一次走多远
          { key: 'player.skipStepSeconds', i18nKey: 'setting__play_skip_step_seconds', control: 'numberInput', helpI18nKey: 'setting__play_skip_step_seconds_tip' },
          // 老行为 4%（0.04）：音量加减快捷键一次调多少
          { key: 'player.volumeStep', i18nKey: 'setting__play_volume_step', control: 'numberInput', helpI18nKey: 'setting__play_volume_step_tip' },
        ],
      },
      {
        // §2.7 定时暂停（原「按钮在基本设置节、开关在弹窗」两处，附 B1 收到本组）
        id: 'play_timeout',
        i18nKey: 'setting__play_timeout',
        items: [
          // 定时到点：开 = 等本曲放完自然停；关 = 立即暂停
          { key: 'player.waitPlayEndStop', i18nKey: 'play_timeout_end', control: 'checkbox' },
          // 分钟数（1–1440）。原来只有弹窗自己读写、「等待播放完毕」时不参与计时（死设置），
          // 票 04 已救活：`timeoutStop.ts` 真按它计时，并在启动时恢复（`restoreTimeoutStop`）
          { key: 'player.waitPlayEndStopTime', i18nKey: 'setting__play_timeout_time', control: 'numberInput', helpI18nKey: 'setting__play_timeout_time_tip' },
          // 非 key 项：开始 / 取消定时的按钮（打开 `PlayTimeoutModal`，弹窗里改的是上面同一个时长值，
          // 按钮上显示剩余时间）。按钮文案与组标题同词（「定时暂停」），照实登记可见文案
          { id: 'play_timeout_open_modal', i18nKey: 'setting__play_timeout', control: 'panel' },
        ],
      },
    ],
  },

  // ===================================================================================
  // §3 桌面歌词（desktop_lyric）—— 一级分组「播放」
  // ===================================================================================
  {
    id: 'desktop_lyric',
    i18nKey: 'setting__desktop_lyric', // 复用；值由票 11 改成「桌面歌词」
    navGroup: 'play',
    groups: [
      {
        // §3.1 显示与置顶
        id: 'desktop_lyric_show',
        i18nKey: 'setting__desktop_lyric_show_title', // 新增
        items: [
          // 桌面歌词窗总开关：开=建窗、关=销窗
          { key: 'desktopLyric.enable', i18nKey: 'setting__desktop_lyric_enable', control: 'checkbox' },
          // 主窗进全屏就关歌词窗；与「以全屏模式启动」联动
          { key: 'desktopLyric.fullscreenHide', i18nKey: 'setting__desktop_lyric_fullscreen_hide', control: 'checkbox' },
          // 勾上才会在任务栏出现歌词窗（录屏软件抓不到时的兜底）
          { key: 'desktopLyric.isShowTaskbar', i18nKey: 'setting__desktop_lyric_show_taskbar', control: 'checkbox', helpI18nKey: 'setting__desktop_lyric_show_taskbar_tip' },
          { key: 'desktopLyric.isAlwaysOnTop', i18nKey: 'setting__desktop_lyric_always_on_top', control: 'checkbox' },
          // 依赖置顶开启（没开置顶时改这项无效果）
          { key: 'desktopLyric.isAlwaysOnTopLoop', i18nKey: 'setting__desktop_lyric_always_on_top_loop', control: 'checkbox', helpI18nKey: 'setting__desktop_lyric_always_on_top_loop_tip' },
          // 默认值平台相关（isWin）；关了可以把歌词拖到副屏——双屏用户的关键项
          { key: 'desktopLyric.isLockScreen', i18nKey: 'setting__desktop_lyric_lock_screen', control: 'checkbox', helpI18nKey: 'setting__desktop_lyric_lock_screen_tip' },
          // 决定渲染 LyricHorizontal 还是 LyricVertical 两套布局
          { key: 'desktopLyric.direction', i18nKey: 'setting__desktop_lyric_direction', control: 'checkboxGroup' },
          // 与主窗的 player.audioVisualization 是两个独立开关；与自定义输出设备互斥
          { key: 'desktopLyric.audioVisualization', i18nKey: 'setting__desktop_lyric_audio_visualization', control: 'checkbox', helpI18nKey: 'setting__desktop_lyric_audio_visualization_tip' },
        ],
      },
      {
        // §3.2 交互
        id: 'desktop_lyric_interact',
        i18nKey: 'setting__desktop_lyric_interact_title', // 新增
        items: [
          // 锁定后鼠标穿透 + 隐藏控制条；撤销只能从托盘/按钮/快捷键
          { key: 'desktopLyric.isLock', i18nKey: 'setting__desktop_lyric_lock', control: 'checkbox' },
          // Linux 上整项不渲染（v-if="!isLinux"）
          { key: 'desktopLyric.isHoverHide', i18nKey: 'setting__desktop_lyric_hover_hide', control: 'checkbox', helpI18nKey: 'setting__desktop_lyric_hover_hide_tip' },
          // 默认开启，用户常把它当成「歌词不见了」的 bug
          { key: 'desktopLyric.pauseHide', i18nKey: 'setting__desktop_lyric_pause_hide', control: 'checkbox', helpI18nKey: 'setting__desktop_lyric_pause_hide_tip' },
          // 与主窗 playDetail.isDelayScroll 是两份独立设置
          { key: 'desktopLyric.isDelayScroll', i18nKey: 'setting__desktop_lyric_delay_scroll', control: 'checkbox', helpI18nKey: 'setting__desktop_lyric_delay_scroll_tip' },
          // 仅垂直模式（direction=vertical）下参与布局
          { key: 'desktopLyric.scrollAlign', i18nKey: 'setting__desktop_lyric_scroll_align', control: 'checkboxGroup', helpI18nKey: 'setting__desktop_lyric_scroll_align_tip' },
        ],
      },
      {
        // §3.3 排版与字体
        id: 'desktop_lyric_font',
        i18nKey: 'setting__desktop_lyric_font_title', // 新增
        items: [
          // 与主窗 playDetail.style.align 独立（用户最常改错地方的一对）
          { key: 'desktopLyric.style.align', i18nKey: 'setting__desktop_lyric_align', control: 'checkboxGroup', helpI18nKey: 'setting__desktop_lyric_align_tip' },
          { key: 'desktopLyric.style.font', i18nKey: 'setting__desktop_lyric_font', control: 'selection' },
          // 浮层：只有歌词窗控制条能改（10–80）
          { key: 'desktopLyric.style.fontSize', i18nKey: 'setting__desktop_lyric_font_size', control: 'numberInput' },
          // 0–25，现在只有加减按钮、没有数值输入
          { key: 'desktopLyric.style.lineGap', i18nKey: 'setting__desktop_lyric_line_gap', control: 'numberInput', helpI18nKey: 'setting__desktop_lyric_line_gap_tip' },
          // 浮层：只有控制条能改（6–100）
          { key: 'desktopLyric.style.opacity', i18nKey: 'setting__desktop_lyric_opacity', control: 'numberInput' },
          // 开 = 超长歌词截断不折行
          { key: 'desktopLyric.style.ellipsis', i18nKey: 'setting__desktop_lyric_ellipsis', control: 'checkbox' },
          // 默认 true；与主窗 playDetail.isZoomActiveLrc（默认 false）是两个值
          { key: 'desktopLyric.style.isZoomActiveLrc', i18nKey: 'setting__desktop_lyric_font_zoom', control: 'checkbox', helpI18nKey: 'setting__desktop_lyric_font_zoom_tip' },
          // 「对哪些歌词加粗」三项；组标题的旧 i18n key 当 DOM id 的写法由票 03 换成 group.id（附 A16）
          { key: 'desktopLyric.style.isFontWeightFont', i18nKey: 'setting__desktop_lyric_font_weight_font', control: 'checkbox' },
          { key: 'desktopLyric.style.isFontWeightLine', i18nKey: 'setting__desktop_lyric_font_weight_line', control: 'checkbox' },
          { key: 'desktopLyric.style.isFontWeightExtended', i18nKey: 'setting__desktop_lyric_font_weight_extended', control: 'checkbox' },
        ],
      },
      // §3.4 颜色（**整组不存在**）：桌面色已按 ADR-0007 删除——`defaultSetting` 与四份语言里都不再有
      // `desktopLyric.style.lyric{Unplay,Played,Shadow}Color`，渲染侧只从主题派生
      // （renderer-lyric/utils/lyricColors.ts）。所以这里**不登记 Group**：登记一个空组会让左栏/锚点
      // 多出一个点不进去的死锚点。
      {
        // §3.5 重置（4 个几何 key 是内部机制键，见 INTERNAL_ONLY_KEYS，不给数值输入；组内只有这一个非 key 项）
        id: 'desktop_lyric_reset',
        i18nKey: 'setting__desktop_lyric_reset', // 复用「重置窗口」；组标题的措辞由票 11 收敛
        items: [
          // 把 4 个几何 key 一次性写回 450×300 + x/y=null（不改字号 / 透明度 / 加粗）
          { id: 'desktop_lyric_reset_window', i18nKey: 'setting__desktop_lyric_reset_window', control: 'button' },
        ],
      },
    ],
  },

  // ===================================================================================
  // §4 下载（download）—— 一级分组「我的音乐」
  // ===================================================================================
  {
    id: 'download',
    i18nKey: 'setting__download', // 复用；值由票 11 改成「下载」
    navGroup: 'my_music',
    groups: [
      {
        // §4 并发与档位。2026-10-12 集合概念统一：总开关/路径/命名、歌词与元数据、格式与编码
        // 三组随「下载托管化」下架——下载文件进库统一零旁车全内嵌，「保存位置 / 文件名模板 /
        // 旁车歌词 / 嵌入开关」不再可配（拿文件走库导出向导）
        id: 'download_concurrent_naming',
        i18nKey: 'setting__download_concurrent_naming_title', // 新增
        items: [
          // 真并发放到 worker 的闸门（1–6）；>3 会先弹确认（确认文案里的「自定义源」是残留，附 A7）
          { key: 'download.maxDownloadNum', i18nKey: 'setting__download_max_num', control: 'numberInput', helpI18nKey: 'setting__download_max_num_tooltip' },
          // 关掉后请求档位不可用的歌不建任务，由下载入队处弹提示（附 C 的 §5-C）
          { key: 'download.degradeWhenUnsupported', i18nKey: 'setting__download_degrade_when_unsupported', control: 'checkbox', helpI18nKey: 'setting__download_degrade_when_unsupported_tip' },
        ],
      },
    ],
  },

  // ===================================================================================
  // §5 我的音乐（my_music）—— 一级分组「我的音乐」
  // 本节的 QQ 账号三按钮与「我的收藏」入口是**非 key 控件**（2026-09-25 起按 `NonKeyItem` 登记，
  // 此前 items 为空、只能搜到组标题）。
  // ===================================================================================
  {
    id: 'my_music',
    i18nKey: 'setting__my_music', // 新增（合节：QQ 账号 + 列表 + 搜索 + 强迫症两项）
    navGroup: 'my_music',
    groups: [
      {
        // §5.1 QQ 账号：三个按钮都是非 key 项（登录态由主进程推送，不落 `defaultSetting`）
        id: 'my_music_qq_auth',
        i18nKey: 'setting__qq_auth',
        items: [
          // 「登录」与下面两个按钮互斥渲染（`v-if="!status.isLogin"`），页面上同时只存在一种形态
          { id: 'my_music_qq_login', i18nKey: 'qq_auth__login', control: 'button' },
          // 手动续期；成功 / 失败反映到同一行下方的 lastRefreshError 文案里
          { id: 'my_music_qq_refresh', i18nKey: 'qq_auth__refresh_credential', control: 'button' },
          // 清本地凭证；退出后在线取流与「我的收藏」同步都不能用
          { id: 'my_music_qq_logout', i18nKey: 'qq_auth__logout', control: 'button' },
          // 只读的登录态那一行（已登录 · 脱敏 id · 有效期）不登记：没有可点可写的控件
        ],
      },
      {
        // §5.2 喜欢的歌：目前只有「我的收藏」列表入口（非 key 项）
        id: 'my_music_favorite',
        i18nKey: 'setting__my_music_favorite_title', // 新增
        items: [
          // 跳到 `/favorites`（「我的收藏」列表页）；「喜欢 / 不喜欢当前歌」还没有界面入口（归类表 §4E）
          { id: 'my_music_favorite_entry', i18nKey: 'favorites', control: 'button' },
        ],
      },
      {
        // §5.3 列表与收藏行为（「来源显示」两项 2026-09-25 已拆到下面的独立分组）
        id: 'my_music_list',
        i18nKey: 'setting__list', // 复用「列表设置」；值由票 11 改成「列表与收藏行为」
        items: [
          // 列表每页条数（票 09 新增 key）：放本组第一项，它管的是「列表怎么翻页」，后面的都是「列表里显示什么」。
          // 全仓（renderer 侧）唯一取值口是 common/settings/pageSize.ts 的 getPageSize()；
          // 发现页「推荐歌单」固定 9 条（3×3 配平）是这条帮助文案里点名的例外
          { key: 'list.pageSize', i18nKey: 'setting__list_page_size', control: 'selection', helpI18nKey: 'setting__list_page_size_tip' },
          { key: 'list.actionButtonsVisible', i18nKey: 'setting__list_action_btn', control: 'checkbox' },
          // 位置存在列表元数据里，清空列表数据会一起丢
          { key: 'list.isSaveScrollLocation', i18nKey: 'setting__list_scroll', control: 'checkbox' },
          // 只对在线列表（歌单/排行榜）生效
          { key: 'list.isClickPlayList', i18nKey: 'setting__list_click_action', control: 'checkbox' },
          // 主进程同步也会读它（服务端模式下影响别人的落点）
          { key: 'list.addMusicLocationType', i18nKey: 'setting__list_add_music_location_type', control: 'checkboxGroup' },
        ],
      },
      {
        // §5.3b 来源显示（附 B7；2026-09-25 按票 05 从「列表与收藏行为」拆成**独立锚点组**）：
        // 先决定列表里挂不挂那一列，再决定列里写别名还是原名。两项都活着，消费点见各自注释——
        // 拆组的理由：两项的分工（开关 / 样式）在同一个锚点里与「列表怎么翻页、怎么点」混在一起，
        // 搜索「来源」也只能落到那个大组上。
        id: 'my_music_source',
        i18nKey: 'setting__my_music_source_title', // 新增（票 05 拆组）
        items: [
          // 附 A3 改名：单源后只有一种来源，值是「显示歌曲来源标签」；管的是列表行里那枚小标签的显隐
          // （`ListMusicTable/useListInfo.js`）
          { key: 'list.isShowSource', i18nKey: 'setting__list_source', control: 'checkbox' },
          // 无入口但活（消费点 `store/index.ts` 的 `getSourceName()`）；spec §3 裁定救活成「来源显示」的样式选项
          { key: 'common.sourceNameType', i18nKey: 'setting__list_source_name_type', control: 'checkboxGroup', helpI18nKey: 'setting__list_source_tip' },
        ],
      },
      {
        // §5.4 搜索行为（原「搜索设置」+「强迫症设置」两项）
        id: 'my_music_search',
        i18nKey: 'setting__search', // 复用「搜索设置」；值由票 11 改成「搜索行为」
        items: [
          // 关掉即不请求热搜
          { key: 'search.isShowHotSearch', i18nKey: 'setting__search_hot', control: 'checkbox' },
          // 附 A2 改名：它同时是「是否记录」的开关（关掉后 addHistoryWord 直接 return）
          { key: 'search.isShowHistorySearch', i18nKey: 'setting__search_history', control: 'checkbox' },
          // 搜索历史条数上限（票 09 新增 key）：紧挨着上面那项——先决定「记不记」，再决定「最多记几条」。
          // 0 = 不记历史；量程与裁剪规则见 common/settings/searchHistory.ts
          { key: 'search.historyMaxNum', i18nKey: 'setting__search_history_max_num', control: 'numberInput', helpI18nKey: 'setting__search_history_max_num_tip' },
          // 只在「进入搜索页」时生效，不是全局快捷键
          { key: 'search.isFocusSearchBox', i18nKey: 'setting__search_focus_search_box', control: 'checkbox' },
          // 只在「离开 Search 且不是去歌单详情」时触发
          { key: 'odc.isAutoClearSearchInput', i18nKey: 'setting__odc_clear_search_input', control: 'checkbox' },
          { key: 'odc.isAutoClearSearchList', i18nKey: 'setting__odc_clear_search_list', control: 'checkbox' },
        ],
      },
    ],
  },

  // ===================================================================================
  // §7 数据与存储（data）—— 一级分组「数据」
  // （排在「快捷键」之前：一级分组的既定顺序是 … 我的音乐 / 数据 / 系统 / …，而快捷键与
  // 网络 / 更新与关于同属「系统」；照 spec §2 的编号排在快捷键之后会让「系统」被「数据」劈开。
  // 见文件头「与 spec 的两处偏差」第 1 条。）
  // 本节的清理 / 备份 / 清空按钮都是**非 key 控件**（2026-09-25 起按 `NonKeyItem` 全部登记：
  // 4 行清理 + 编辑规则 + 清空列表 + 8 个备份按钮 + 立即回收）；`data_lyric_offset` 组只有只读
  // 显示与说明（真控件在歌词右键菜单），列在 `GROUPS_WITHOUT_ITEMS` 里。
  // ===================================================================================
  {
    id: 'data',
    i18nKey: 'setting__data_storage', // 新增（合节：其他 的 4 个清理组 + 备份与恢复）
    navGroup: 'data',
    groups: [
      {
        // §7.1 缓存与清理（附 B4：五块清理 + 三个计数行收成一张表）
        id: 'data_cache',
        i18nKey: 'setting__data_cache_title', // 新增
        items: [
          // 四行各有独立的清理动作与语义（四份不同的数据），**不要合并成「一键全清」**；
          // 计数（大小 / 条数）是只读展示，不单独登记。顺序 = 表里的行顺序（CacheClearTable.vue）
          { id: 'data_cache_clear_resource', i18nKey: 'setting__data_cache_row_resource', control: 'button' },
          { id: 'data_cache_clear_music_url', i18nKey: 'setting__data_cache_row_music_url', control: 'button' },
          { id: 'data_cache_clear_lyric_raw', i18nKey: 'setting__data_cache_row_lyric_raw', control: 'button' },
          { id: 'data_cache_clear_lyric_edited', i18nKey: 'setting__data_cache_row_lyric_edited', control: 'button' },
        ],
      },
      {
        // §7.2 歌词偏移（调当前这首歌的 offset，入口在歌词右键菜单；附 B10）
        // 组内只有只读显示与说明，列在 `GROUPS_WITHOUT_ITEMS`
        id: 'data_lyric_offset',
        // 不能复用 lyric_menu__offset：它带 {offset} 占位符，SettingNav 直接渲染会把
        // 「{offset}」裸奔出来（2026-10-25 UI 审查 P2）；导航用独立 key，内容区继续用带值的
        i18nKey: 'setting__data_lyric_offset',
        items: [],
      },
      {
        // §7.3 不喜欢规则
        id: 'data_dislike',
        i18nKey: 'setting__other_dislike_list',
        items: [
          // 非 key 项：打开 `DislikeListModal`（整块覆盖式写入规则文本，不是增量）。
          // 弹窗里的文本域 / 保存按钮不单独登记——它们不在内容区，挂 id 也定位不到（同 `panel` 的既有口径）
          { id: 'data_dislike_edit', i18nKey: 'setting__other_dislike_list_show_btn', control: 'panel' },
        ],
      },
      {
        // §7.4 列表数据（清空「我的列表」数据，不可撤销）
        id: 'data_list',
        i18nKey: 'setting__other_listdata',
        items: [
          // 非 key 项：二次确认后用空数组覆盖默认列表 / 我的收藏 / 用户列表（不可撤销）
          { id: 'data_list_clear', i18nKey: 'setting__other_listdata_clear_btn', control: 'button' },
        ],
      },
      {
        // §7.5 备份与恢复（8 个按钮 + 组标题文案残留见附 A15）
        id: 'data_backup',
        i18nKey: 'setting__backup',
        items: [
          // 8 个按钮都是非 key 项，分三块（部分数据 / 所有数据 / 其他格式），顺序 = 页面顺序（BackupBlock.vue）。
          // 「导入设置 / 导入所有数据」会把 `common.isAgreePact` 强制写成 false（下次启动重新走协议弹窗）
          { id: 'data_backup_import_list', i18nKey: 'setting__backup_part_import_list', control: 'button' },
          { id: 'data_backup_export_list', i18nKey: 'setting__backup_part_export_list', control: 'button' },
          { id: 'data_backup_import_setting', i18nKey: 'setting__backup_part_import_setting', control: 'button' },
          { id: 'data_backup_export_setting', i18nKey: 'setting__backup_part_export_setting', control: 'button' },
          { id: 'data_backup_import_all', i18nKey: 'setting__backup_all_import', control: 'button' },
          { id: 'data_backup_export_all', i18nKey: 'setting__backup_all_export', control: 'button' },
          { id: 'data_backup_export_txt', i18nKey: 'setting__backup_other_export_list_text', control: 'button' },
          { id: 'data_backup_export_csv', i18nKey: 'setting__backup_other_export_list_csv', control: 'button' },
        ],
      },
      {
        // §7.6 缓存回收策略（票 08）：只回收 `music_url` 表里过期 / 超限的 URL 缓存行，
        // 不碰列表 / 我喜欢 / 歌单 / 备份 / 已下载的音频文件。两个 key 的 0 都是「不回收」。
        id: 'data_cache_policy',
        i18nKey: 'setting__data_cache_policy_title', // 新增
        items: [
          // 天。回收时机：每次启动（main/app.ts 的 initAppSetting 内 await 一次）+ 设置页「立即回收」按钮
          { key: 'cache.musicUrlKeepDays', i18nKey: 'setting__data_cache_music_url_keep_days', control: 'numberInput', helpI18nKey: 'setting__data_cache_music_url_keep_days_tip' },
          // MB。占用用 `LENGTH(id)+LENGTH(url)` 近似（乐观估计，不含 SQLite 页 / 索引开销）
          { key: 'cache.maxSizeMB', i18nKey: 'setting__data_cache_max_size', control: 'numberInput', helpI18nKey: 'setting__data_cache_max_size_tip' },
          // 非 key 项：立即回收按钮。两项都是 0 时照样能点（返回「不回收」的提示），
          // 按钮还额外保住「正在播放那首歌」的缓存行（见 CachePolicyBlock.vue）
          { id: 'data_cache_recycle_now', i18nKey: 'setting__data_cache_recycle_btn', control: 'button' },
        ],
      },
    ],
  },

  // ===================================================================================
  // §6 快捷键（hot_key）—— 一级分组「系统」
  // 本节 **0 个 key**：配置存在 window.lx.appHotKeyConfig，读写走 hotKeySetConfig IPC。
  // 2 个启用开关 + 26 个录入框都是非 key 控件，2026-09-25 起按 `NonKeyItem` 全部登记
  // （此前 items 为空，搜索只能命中「软件内快捷键 / 全局快捷键」两个组标题），
  // 动作名清单与 id 规则见上面那组 `hotKeyItemId` / `hotKeyItems`。
  // ===================================================================================
  {
    id: 'hot_key',
    i18nKey: 'setting__hot_key', // 复用；值由票 11 改成「快捷键」
    navGroup: 'system',
    groups: [
      {
        // §6.1 软件内（local，9 项，默认折叠）
        id: 'hot_key_local',
        i18nKey: 'setting__hot_key_local_title',
        items: [
          // 总闸不在折叠范围内（收起时仍可见可切）；关掉后下面 9 个框变半透明但仍可编辑，实际不响应
          { id: hotKeyItemId('local', 'enable'), i18nKey: 'setting__is_enable', control: 'checkbox' },
          ...hotKeyItems('local', HOT_KEY_LOCAL_NAMES),
        ],
      },
      {
        // §6.2 全局（global，17 项；开启时逐个向系统注册，注册失败在输入框打删除线）
        id: 'hot_key_global',
        i18nKey: 'setting__hot_key_global_title',
        items: [
          // 全局总闸；与软件内那条同名但分开配置（改一处不影响另一处）
          { id: hotKeyItemId('global', 'enable'), i18nKey: 'setting__is_enable', control: 'checkbox' },
          ...hotKeyItems('global', HOT_KEY_GLOBAL_NAMES),
        ],
      },
    ],
  },

  // ===================================================================================
  // §8 网络（network）—— 一级分组「系统」
  // ===================================================================================
  {
    id: 'network',
    i18nKey: 'setting__network', // 复用；值由票 11 改成「网络」
    navGroup: 'system',
    groups: [
      {
        // §8.1 HTTP 代理（组标题自带「乱设置软件将无法联网」的警告；用户名/密码两条僵尸文案按附 A14 清掉）
        id: 'network_proxy',
        i18nKey: 'setting__network_proxy_title', // 复用；值自带「乱设置软件将无法联网」的警告，留标题还是移进帮助由票 11 定
        items: [
          // 给主窗 session / 开放 API 子 session / worker / userApi 子窗口统一套代理
          { key: 'network.proxy.enable', i18nKey: 'setting__is_enable', control: 'checkbox' },
          // 为空时即使 enable 开了也不生效
          { key: 'network.proxy.host', i18nKey: 'setting__network_proxy_host', control: 'input', helpI18nKey: 'setting__network_proxy_host_tip' },
          // 留空按 80 处理
          { key: 'network.proxy.port', i18nKey: 'setting__network_proxy_port', control: 'input', helpI18nKey: 'setting__network_proxy_port_tip' },
        ],
      },
      {
        // §8.2 请求超时（新组）：player.getUrlTimeout 归「播放 → 播放稳定性」（附 C.2），本组留给
        // 票 06 决定是否再拆「在线请求统一超时」（现在写死在 utils/request.js:282）
        id: 'network_timeout',
        i18nKey: 'setting__network_timeout_title', // 新增
        items: [],
      },
    ],
  },

  // ===================================================================================
  // §9 关于（about）—— 一级分组「系统」
  // 版本信息（只读展示 + 连点 5 次开 DevTools 的隐藏手势）与许可协议按钮是非 key 控件。
  // **没有「软件更新」分组**：应用内更新链路已于 2026-09-24 整体删除（ADR-0008 不发布任何打包版），
  // 原先的 `common.tryAutoUpdate` / `common.showChangeLog` 两个开关随之退场。
  // ===================================================================================
  {
    id: 'about',
    i18nKey: 'setting__update_about',
    navGroup: 'system',
    groups: [
      {
        // §9.1 版本信息（只读展示：版本 / 代码版本 / 提交日期；
        // 「当前版本」一行连点 5 次开 DevTools 的隐藏手势也在这里，勿「顺手清理」）
        // 三行都是只读文案、没有可操作控件 → 列在 `GROUPS_WITHOUT_ITEMS`
        id: 'about_version',
        i18nKey: 'setting__about_version_title', // 新增（旧的 setting__about 是「关于 Ch'iverve Music」，语义不同）
        items: [],
      },
      {
        // §9.2 许可（界面只显示签署状态 + 打开协议原文；`common.isAgreePact` 是内部机制键）
        id: 'about_license',
        i18nKey: 'setting__about_license_title', // 新增（不复用 setting__about_pact_tip：那条是半截句，附 A13 要改写）
        items: [
          // 非 key 项：打开协议原文（上游 Apache-2.0 全文 + 补充条款，原文不可改，AGENTS §8）
          { id: 'about_show_pact', i18nKey: 'setting__about_pact_btn', control: 'button' },
        ],
      },
    ],
  },

  // ===================================================================================
  // §10 高级（advanced）—— 一级分组「高级」
  // ===================================================================================
  {
    id: 'advanced',
    i18nKey: 'setting__advanced', // 新增（spec §1 Q1：上游扩展节全保留但收进「高级」）
    navGroup: 'advanced',
    groups: [
      {
        // §10.1 开放 API
        id: 'advanced_open_api',
        i18nKey: 'setting__open_api',
        items: [
          // 起本地 HTTP 服务（默认仅回环）；同时告诉歌词播放器「有外部渲染方」
          { key: 'openAPI.enable', i18nKey: 'setting__open_api_enable', control: 'checkbox', helpI18nKey: 'setting__open_api_tip' },
          // 开 = 绑 0.0.0.0，局域网内任何设备都能调用（无鉴权）
          { key: 'openAPI.bindLan', i18nKey: 'setting__open_api_bind_lan', control: 'checkbox', helpI18nKey: 'setting__open_api_bind_lan_tip' },
          // 改端口会重启服务
          { key: 'openAPI.port', i18nKey: 'setting__open_api_port', control: 'input', helpI18nKey: 'setting__open_api_port_tip' },
        ],
      },
      {
        // §10.2 数据同步（服务端模式的设备列表 / 连接码是非 key 控件）
        id: 'advanced_sync',
        i18nKey: 'setting__sync',
        items: [
          // 开启期间模式与端口/host 都被禁用（要先关掉才能改）
          { key: 'sync.enable', i18nKey: 'setting__sync_enable', control: 'checkbox' },
          // 服务端 / 客户端二选一：帮助里讲清两者的角色与「开着时不能改」
          { key: 'sync.mode', i18nKey: 'setting__sync_mode', control: 'checkboxGroup', helpI18nKey: 'setting__sync_mode_tip' },
          { key: 'sync.server.port', i18nKey: 'setting__sync_server_port', control: 'input', helpI18nKey: 'setting__sync_server_port_tip' },
          // 客户端模式下唯一必填项（为空时开 enable 不生效）
          { key: 'sync.client.host', i18nKey: 'setting__sync_client_host', control: 'input', helpI18nKey: 'setting__sync_client_host_tip' },
          // 无入口但主进程真读（服务端每个用户保留的快照数上限）：spec §3 要求补入口；改小会让旧快照被丢
          { key: 'sync.server.maxSsnapshotNum', i18nKey: 'setting__sync_server_max_snapshot_num', control: 'numberInput', helpI18nKey: 'setting__sync_server_max_snapshot_num_tip' },
          // 下面两个是非 key 项（服务端模式才有，且都是动作）：连接码只在服务端起监听后能刷新；
          // 设备列表弹窗里可以移除设备（移除后需重新输连接码）
          { id: 'advanced_sync_refresh_code', i18nKey: 'setting__sync_server_refresh_code', control: 'button' },
          { id: 'advanced_sync_device_list', i18nKey: 'setting__sync_server_show_device_list', control: 'panel' },
        ],
      },
      {
        // §10.3 音效与均衡器（17 key 现全部只有浮层入口）：
        // 设置页按 spec §5 口径只给「打开面板」的入口，但**对账要逐 key 认到这一组**——
        // 均衡器 10 个 key 尤其不能并成一项（9 个预设与「重置」都是一次写满 10 个 key）。
        id: 'advanced_sound_effect',
        i18nKey: 'setting__advanced_sound_effect_title', // 新增
        items: [
          // 非 key 项：「打开音效面板」按钮。面板里是播放详情页那四个组件的复用，面板内部控件不单独
          // 登记——它们不在内容区，挂了 id 也定位不到（同 `data_dislike_edit` 的口径）
          { id: 'advanced_sound_effect_open_panel', i18nKey: 'setting__advanced_sound_effect_open_btn', control: 'button' },
          // 环境混响：选中的预设会顺带写入下面两个增益
          { key: 'player.soundEffect.convolution.fileName', i18nKey: 'player__sound_effect_convolution', control: 'selection' },
          { key: 'player.soundEffect.convolution.mainGain', i18nKey: 'player__sound_effect_convolution_main_gain', control: 'panel' },
          { key: 'player.soundEffect.convolution.sendGain', i18nKey: 'player__sound_effect_convolution_send_gain', control: 'panel' },
          // 10 段均衡器：各有独立语义（31Hz 超低频 → 16kHz 极高频），逐 key 登记
          { key: 'player.soundEffect.biquadFilter.hz31', i18nKey: 'setting__eq_hz31', control: 'panel' },
          { key: 'player.soundEffect.biquadFilter.hz62', i18nKey: 'setting__eq_hz62', control: 'panel' },
          { key: 'player.soundEffect.biquadFilter.hz125', i18nKey: 'setting__eq_hz125', control: 'panel' },
          { key: 'player.soundEffect.biquadFilter.hz250', i18nKey: 'setting__eq_hz250', control: 'panel' },
          { key: 'player.soundEffect.biquadFilter.hz500', i18nKey: 'setting__eq_hz500', control: 'panel' },
          { key: 'player.soundEffect.biquadFilter.hz1000', i18nKey: 'setting__eq_hz1000', control: 'panel' },
          { key: 'player.soundEffect.biquadFilter.hz2000', i18nKey: 'setting__eq_hz2000', control: 'panel' },
          { key: 'player.soundEffect.biquadFilter.hz4000', i18nKey: 'setting__eq_hz4000', control: 'panel' },
          { key: 'player.soundEffect.biquadFilter.hz8000', i18nKey: 'setting__eq_hz8000', control: 'panel' },
          { key: 'player.soundEffect.biquadFilter.hz16000', i18nKey: 'setting__eq_hz16000', control: 'panel' },
          // 3D 环绕：与 isMaxOutputChannelCount 冲突（后者读它）
          { key: 'player.soundEffect.panner.enable', i18nKey: 'player__sound_effect_panner_enabled', control: 'checkbox', helpI18nKey: 'player__sound_effect_features_tip' },
          { key: 'player.soundEffect.panner.soundR', i18nKey: 'player__sound_effect_panner_sound_r', control: 'panel' },
          { key: 'player.soundEffect.panner.speed', i18nKey: 'player__sound_effect_panner_sound_speed', control: 'panel' },
          // 升降调（与播放倍速无关，独立处理音频数据；CPU 不够会让声音异常）
          { key: 'player.soundEffect.pitchShifter.playbackRate', i18nKey: 'player__sound_effect_pitch_shifter', control: 'slider' },
        ],
      },
      {
        // §10.4 实验性（媒体键缺口见附 C.3：spec §2 把它列进本组，但 §5 没给 key，
        // 需要先定「开关 key + 默认绑定」，否则本组只有 audioVisualization 一项）
        id: 'advanced_experimental',
        i18nKey: 'setting__advanced_experimental_title', // 新增
        items: [
          // 浮层：播放详情页左下角的按钮；与桌面歌词的 desktopLyric.audioVisualization 独立
          { key: 'player.audioVisualization', i18nKey: 'audio_visualization', control: 'checkbox', helpI18nKey: 'setting__advanced_audio_visualization_tip' },
        ],
      },
    ],
  },
]
