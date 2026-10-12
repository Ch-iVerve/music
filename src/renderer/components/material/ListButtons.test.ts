import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'
import ListButtons from './ListButtons.vue'
import { favSongIds } from '@renderer/store/user/state'

/**
 * 行内「我喜欢」键（ui-polish-3 工单 06）与它的空心/实心两态（工单 10）。
 *
 * 真机要求：这个键的**文案与状态要跟着当前状态走**（不在我喜欢里 → 「收藏到…」，
 * 已经在里面 → 「取消喜欢」），点了直接切换、不再开弹窗。用例钉三件事：
 *   1. 文案随状态变（读 store/user 的收藏全量 id 集合，写成功后会就地变）；
 *   2. 点了把 `fav` 交给调用方（行内键只 emit，动作在容器里做——与其它键同一套约定）；
 *   3. 不能收藏的歌（本地文件 / 非 QQ 源）与没开这个键时**不渲染**，不留死键。
 *
 * 工单 10 追加两件（用户原话「喜欢和取消的样式区别不大，如果是已经喜欢了的要是实心爱心」、
 * 「添加歌曲到的按钮不要用爱心的图标」）：
 *   4. 心形的 href 按状态在空心/实心之间切，同时叠主色类；
 *   5. 「加入歌单」键用的是歌单图形（`#icon-list-add`），**不是**任何心形。
 *
 * `$t` 用桩（键名即文案），断言的是「用了哪个 key」——文案本身在 i18n 四语里。
 */

const $t = (key: string) => key

const txSong = (id: string) => ({
  id: `tx_${id}`,
  name: '歌名',
  singer: '歌手',
  source: 'tx',
  interval: '03:00',
  meta: { id, songType: 0 },
}) as any

const localSong = {
  id: 'local_1',
  name: '本地文件',
  singer: '歌手',
  source: 'local',
  interval: '03:00',
  meta: {},
} as any

const mountBtns = (props: Record<string, any>) => mount(ListButtons, {
  // `downloadBtn` 默认关：下载开关（`download.enable`）已随集合概念统一下架，不再有全局兜底，
  // 想开下载键的用例显式传入（渲染契约本身在 ListButtons.vue 的 v-if）
  props: { index: 3, playBtn: false, listAddBtn: false, favBtn: true, downloadBtn: false, ...props },
  global: { mocks: { $t } },
})

const heartBtn = (wrapper: ReturnType<typeof mountBtns>) => wrapper.find('button')
// CSS Modules 的类名带哈希（`_favOn_7af6e4`），所以只断言「带上了这个状态类」，
// 不锁死生成出来的名字（同 components/base/Btn.test.ts 的口径）
const hasFavOnClass = (wrapper: ReturnType<typeof mountBtns>) =>
  wrapper.find('svg').classes().some(name => name.includes('favOn'))
// `xlink:href` 落在 xlink 命名空间里，`attributes()` 取不到，只能断言序列化结果
// （同 plugins/SvgIcon/SvgIcon.test.ts 的口径）
const favIconHref = (wrapper: ReturnType<typeof mountBtns>) =>
  wrapper.find('svg use').element.outerHTML
/** 按无障碍名找键：本文件里同时开着心形键与「加入歌单」键时，`find('button')` 只能拿到第一个 */
const btnByLabel = (wrapper: ReturnType<typeof mountBtns>, label: string) =>
  wrapper.findAll('button').find(btn => btn.attributes('aria-label') === label)!

beforeEach(() => {
  favSongIds.splice(0, favSongIds.length)
})

describe('components/material/ListButtons.vue 的「我喜欢」键', () => {
  it('不在我喜欢里 → 文案是「收藏到 QQ 音乐我喜欢」，点心形键 emit fav', async() => {
    const wrapper = mountBtns({ musicInfo: txSong('1') })

    expect(heartBtn(wrapper).attributes('aria-label')).toBe('list_add__cloud_fav')
    expect(heartBtn(wrapper).attributes('title')).toBe('list_add__cloud_fav')
    // 未收藏：空心 + 不上主色
    expect(favIconHref(wrapper)).toContain('xlink:href="#icon-love"')
    expect(favIconHref(wrapper)).not.toContain('love-solid')
    expect(hasFavOnClass(wrapper)).toBe(false)

    await heartBtn(wrapper).trigger('click')

    expect(wrapper.emitted('btn-click')?.[0]?.[0]).toEqual({ action: 'fav', index: 3 })
  })

  it('已在我喜欢里 → 文案变「取消喜欢」、图标换实心并上主色（写成功后就地变）', async() => {
    const wrapper = mountBtns({ musicInfo: txSong('1') })

    favSongIds.push('1')
    await wrapper.vm.$nextTick()

    expect(heartBtn(wrapper).attributes('aria-label')).toBe('list__unlove')
    expect(heartBtn(wrapper).attributes('title')).toBe('list__unlove')
    // 形状与颜色**两处都变**：只靠颜色区分时用户报「喜欢和取消的样式区别不大」
    expect(favIconHref(wrapper)).toContain('xlink:href="#icon-love-solid"')
    expect(hasFavOnClass(wrapper)).toBe(true)
  })

  it('取消后图标退回空心：状态是双向的，不留「看起来还收藏着」的实心', async() => {
    const wrapper = mountBtns({ musicInfo: txSong('1') })
    favSongIds.push('1')
    await wrapper.vm.$nextTick()
    expect(favIconHref(wrapper)).toContain('#icon-love-solid')

    favSongIds.splice(0, favSongIds.length)
    await wrapper.vm.$nextTick()

    expect(favIconHref(wrapper)).toContain('xlink:href="#icon-love"')
    expect(favIconHref(wrapper)).not.toContain('love-solid')
    expect(hasFavOnClass(wrapper)).toBe(false)
  })

  it('「加入歌单」键用的是歌单图形，不是心形（工单 10 用户原话）', () => {
    const wrapper = mountBtns({ musicInfo: txSong('1'), listAddBtn: true })

    const addBtn = btnByLabel(wrapper, 'list__add_to')
    expect(addBtn.find('use').element.outerHTML).toContain('xlink:href="#icon-list-add"')
    // 「添加到…」下面挂一颗心（原 `#icon-add-2` 就是心形带加号）正是用户报的那条
    expect(addBtn.find('use').element.outerHTML).not.toContain('love')
  })

  it('本地文件（没有 QQ 歌曲 ID）→ 不渲染这个键', () => {
    const wrapper = mountBtns({ musicInfo: localSong })

    expect(heartBtn(wrapper).exists()).toBe(false)
  })

  it('没传 favBtn 的调用方（本地列表 / 下载页）→ 不渲染这个键', () => {
    const wrapper = mountBtns({ musicInfo: txSong('1'), favBtn: false })

    expect(heartBtn(wrapper).exists()).toBe(false)
  })
})

/**
 * 行内**移除键**的可用性（ui-polish-followups 票 17 接缝 3 的「移除」那一半）。
 *
 * 契约：这一键**不自己判来源**——可用性完全由宿主给的 `removeBtn` 决定，语义由 `removeLabel` 给。
 * 现场（「本地 vs 在线」就是在这里分的）：
 *   - 在线表（`OnlineList/index.vue:117-119`）由宿主的 `show-remove-btn` 决定：收藏页传
 *     「取消喜欢」（`QqFavList.vue`）、云端歌单传「移除歌曲」（`CloudListPane.vue`）；
 *   - 本地表（`ListMusicTable`）**不给**这个键，移除走右键菜单的 `list__remove`。
 * 所以「哪些歌/哪个列表能移除」在宿主那层，本组件只保证「不给就不渲染死键」。
 *
 * 期望值来源：`ListButtons.vue:54` 的 `v-if="removeBtn"` 与
 * `:aria-label="removeLabel || $t('list__remove')"`；使用现场见上面两个宿主的模板。
 */
describe('components/material/ListButtons.vue 的「移除」键', () => {
  it('宿主开了 removeBtn 才渲染：文案优先用 removeLabel（取消喜欢 / 移除歌曲），空则落 list__remove', () => {
    const withLabel = mountBtns({ musicInfo: txSong('1'), removeBtn: true, removeLabel: 'list__unlove' })
    expect(btnByLabel(withLabel, 'list__unlove')).toBeTruthy()

    const withoutLabel = mountBtns({ musicInfo: txSong('1'), removeBtn: true })
    expect(btnByLabel(withoutLabel, 'list__remove')).toBeTruthy()
  })

  it('宿主没开（本地表那一侧）→ 不渲染这个键', () => {
    // favBtn / downloadBtn 都关（本文件的 mountBtns 默认关），此时按钮排应为空
    const wrapper = mountBtns({ musicInfo: txSong('1'), favBtn: false })

    expect(wrapper.findAll('button')).toHaveLength(0)
  })
})
