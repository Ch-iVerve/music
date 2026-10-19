import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import ExpandableDesc from './ExpandableDesc.vue'

/**
 * 可展开简介（专辑页 3 行 / 歌手页 4 行共用，2026-10-19）。
 *
 * 钉四条行为：**只在真被截断时**给展开键、收起态键在**段落内部**（「融合进末行」那条口径的
 * 结构证据）、点击展开/收起、换内容回到收起态。
 * jsdom 里 scrollHeight / clientHeight 恒为 0（不做布局），所以「被截断」靠桩住这两个度量模拟——
 * 判据本身（scrollHeight > clientHeight）就是组件要测的那条逻辑。
 *
 * 与 MvPlayerModal.test.ts 同款：`base-btn` 是全局注册的，测试里桩掉；文案断言用 i18n 的 key
 * （`$t` 桩直通），措辞改了不误伤。
 */
const stubMetrics = (scrollHeight: number, clientHeight: number) => {
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => scrollHeight })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => clientHeight })
}
afterEach(() => {
  // 删掉自己挂在 HTMLElement.prototype 上的影子，jsdom 原有的（Element.prototype）度量跟着回来
  delete (HTMLElement.prototype as any).scrollHeight
  delete (HTMLElement.prototype as any).clientHeight
})

const stubs = { 'base-btn': { template: '<button><slot /></button>' } }
const mocks = { $t: (key: string) => key }

const mountDesc = (props: Record<string, unknown> = {}) => mount(ExpandableDesc, {
  props: { text: '一段很长的简介', ...props },
  global: { stubs, mocks },
})

describe('components/common/ExpandableDesc.vue', () => {
  it('正文渲染在 <p> 上，行数经 --desc-lines 传给裁切高度', async() => {
    stubMetrics(100, 100)
    const wrapper = mountDesc({ text: '短简介', lines: 4 })
    await flushPromises()

    expect(wrapper.get('p').text()).toBe('短简介')
    expect(wrapper.element.getAttribute('style')).toContain('--desc-lines: 4')
  })

  it('没被截断（scrollHeight == clientHeight）时不给展开键', async() => {
    stubMetrics(100, 100)
    const wrapper = mountDesc()
    await flushPromises()

    expect(wrapper.find('button').exists()).toBe(false)
  })

  it('被截断时展开键在**段落内部**（融合进末行），省略号也跟着出现', async() => {
    stubMetrics(200, 100)
    const wrapper = mountDesc()
    await flushPromises()

    expect(wrapper.get('p').find('button').exists()).toBe(true)
    expect(wrapper.get('p').find('button').text()).toBe('desc__expand')
    expect(wrapper.get('p').text()).toContain('…')
  })

  it('点击展开：键换成「收起」、省略号收掉，但**仍在段落内**（展开态同样贴全文末尾）；再点回收起态', async() => {
    stubMetrics(200, 100)
    const wrapper = mountDesc()
    await flushPromises()

    await wrapper.get('button').trigger('click')
    expect(wrapper.get('p').find('button').text()).toBe('desc__collapse')
    expect(wrapper.get('p').text()).not.toContain('…')
    // 通知调用页（页面据此给下方列表留最小高度）
    expect(wrapper.emitted('toggle')).toEqual([[true]])

    await wrapper.get('button').trigger('click')
    expect(wrapper.get('p').find('button').text()).toBe('desc__expand')
    expect(wrapper.get('p').text()).toContain('…')
    expect(wrapper.emitted('toggle')).toEqual([[true], [false]])
  })

  it('换内容（换专辑 / 换歌手）回到收起态', async() => {
    stubMetrics(200, 100)
    const wrapper = mountDesc()
    await flushPromises()

    await wrapper.get('button').trigger('click')
    expect(wrapper.get('button').text()).toBe('desc__collapse')

    await wrapper.setProps({ text: '另一段简介' })
    await flushPromises()
    expect(wrapper.get('button').text()).toBe('desc__expand')
  })

  it('文本为空时整块不渲染', async() => {
    stubMetrics(200, 100)
    const wrapper = mountDesc({ text: '' })
    await flushPromises()

    expect(wrapper.find('p').exists()).toBe(false)
    expect(wrapper.find('button').exists()).toBe(false)
  })
})
