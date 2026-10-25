import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { i18nPlugin } from '@renderer/plugins/i18n'
import BaseBtn from '@renderer/components/base/Btn.vue'
import Modal from '@renderer/components/material/Modal.vue'
import zhCn from '@root/lang/zh-cn.json'
import LyricDictModal from './LyricDictModal.vue'

/**
 * 歌词词典弹窗的钉子（票：播放类能力 / 歌词词典）。
 *
 * 挂的是**真 SFC**，只有 `material-modal` 是替身：真件 teleport 到 `#root`，jsdom 里没有那个锚点
 * （**同 `SettingHelpModal.test.ts` 的口径**，`material-modal` 本体不在这里测）。
 *
 * 钉住三件事（都在「数据层拿不到东西」这一侧——实测中文歌 / 日文歌都没有词典，这是主路径）：
 *   1. **查不到时给「无释义」而不是空白**：不命中要有一句带词条名的说明；
 *   2. 命中的词条要出**释义 + 出处行 + 该行翻译**（`explain` / `lyric_text` / `trans_lyric_text`）；
 *   3. 出口：底部「关闭」键与 Esc 都要能关（Esc 的实现归 `material-modal`，本文件用真件走全链路）。
 *
 * 文案断 `zh-cn.json` 里的值而不是写死中文字面量：措辞归 i18n 管，改词不该让这里红。
 */
const t = (key: keyof typeof zhCn) => zhCn[key]

/** `material-modal` 替身：照 `show` 渲染 slot，本文件断的正是「开没开 / 里面是什么」 */
const materialModalStub = {
  props: { show: { type: Boolean, default: false } },
  template: '<div v-if="show" class="modal"><slot /></div>',
}

const entry = {
  phrase: 'poor boy',
  explain: '在这个上下文中，“poor boy”用作俚语…',
  lyric_text: "I'm just a poor boy nobody loves me",
  trans_lyric_text: '但我只是个穷小孩 没有人爱我',
  lyric_timestamp: '[03:23.75]',
}

const mountModal = (props: Record<string, unknown>) => mount(LyricDictModal, {
  props,
  global: {
    plugins: [i18nPlugin],
    components: { 'base-btn': BaseBtn },
    stubs: { 'material-modal': materialModalStub },
  },
})

afterEach(() => {
  // Esc 的监听挂在 document 上：用例之间不留 listener（组件卸载时会自己摘，这里兜一道）
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
})

describe('LyricDictModal', () => {
  it('命中的词条：出释义 + 出处行 + 翻译 + 时间戳', () => {
    const wrapper = mountModal({ show: true, word: 'poor boy', entries: [entry] })

    expect(wrapper.text()).toContain('poor boy')
    expect(wrapper.text()).toContain(entry.explain)
    expect(wrapper.text()).toContain(entry.lyric_text)
    expect(wrapper.text()).toContain(entry.trans_lyric_text)
    expect(wrapper.text()).toContain(entry.lyric_timestamp)
  })

  it('查不到时给「无释义」而不是空白（且带上词条名）', () => {
    const wrapper = mountModal({ show: true, word: '晚安', entries: [] })

    const text = wrapper.text()
    expect(text).toContain('晚安')
    // i18n 的 {word} 插值要真的落到文案里，不是把模板原样显示
    expect(text).toContain(t('player__lyric_dict_empty').replace('{word}', '晚安'))
    expect(text).not.toContain('{word}')
  })

  it('词典还在取时给加载态，不误报「无释义」', () => {
    const wrapper = mountModal({ show: true, word: 'poor boy', entries: [], loading: true })

    expect(wrapper.text()).toContain(t('player__lyric_dict_loading'))
    expect(wrapper.text()).not.toContain(t('player__lyric_dict_empty').replace('{word}', 'poor boy'))
  })

  it('底部「关闭」键发出 update:show=false', async() => {
    const wrapper = mountModal({ show: true, word: 'poor boy', entries: [entry] })

    // 按 `aria-label` 找而不是按 CSS Module 类名：类名在真构建里是 hash（`_footerBtn_f9ece4`），
    // 写死必然过一阵就红（同 scripts/verify/README.md 的探针纪律）
    await wrapper.find(`button[aria-label="${t('btn_close')}"]`).trigger('click')

    expect(wrapper.emitted('update:show')).toEqual([[false]])
  })

  it('Esc 也能关（Esc 由 material-modal 统一处理，2026-10-25 起；真件走全链路）', async() => {
    // 真件 teleport 到 #root：锚点先建（替身测不出 Esc——Esc 的实现归 Modal，由 Modal.test.ts 钉）
    const root = document.createElement('div')
    root.id = 'root'
    document.body.appendChild(root)

    const wrapper = mount(LyricDictModal, {
      props: { show: true, word: 'poor boy', entries: [entry] },
      global: {
        plugins: [i18nPlugin],
        components: { 'base-btn': BaseBtn, 'material-modal': Modal },
      },
    })
    await wrapper.vm.$nextTick()

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('update:show')).toEqual([[false]])
    wrapper.unmount()
    root.remove()
  })

  it('没打开时不渲染内容，Esc 也不该有反应', () => {
    const wrapper = mountModal({ show: false, word: 'poor boy', entries: [entry] })

    expect(wrapper.find('.modal').exists()).toBe(false)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(wrapper.emitted('update:show')).toBeUndefined()
  })
})
