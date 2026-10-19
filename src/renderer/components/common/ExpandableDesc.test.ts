import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import ExpandableDesc from './ExpandableDesc.vue'

/**
 * 可展开简介（专辑页 3 行 / 歌手页 4 行共用，2026-10-19）。
 *
 * 钉四条行为：**只在真被截断时**给展开键、键在**段落内部**（融合进末行）、点击展开/收起、
 * 换内容回到收起态。
 *
 * jsdom 不做布局（行高、行 rect 都拿不到），所以「被截断」靠桩住 scrollHeight 模拟——
 * 组件正是用 `量尺.scrollHeight / lineHeight > lines` 判的。行 rect 拿不到时组件会退回
 * 「让位块放全文末尾」，这正是测试里该有的行为（只断言 DOM 结构，不断言像素）。
 */
const stubMetrics = (scrollHeight: number, clientHeight: number) => {
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => scrollHeight })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => clientHeight })
}
afterEach(() => {
  delete (HTMLElement.prototype as any).scrollHeight
  delete (HTMLElement.prototype as any).clientHeight
})

const stubs = { 'base-btn': { template: '<button><slot /></button>' } }
const mocks = { $t: (key: string) => key }

const mountDesc = (props: Record<string, unknown> = {}) => mount(ExpandableDesc, {
  props: { text: '一段很长的简介', ...props },
  global: { stubs, mocks },
})

/** 可见正文（`<p>` 里还有隐藏量尺整段复述原文、让位块里是按钮文案，两者都不能算进去） */
const visibleText = (wrapper: ReturnType<typeof mountDesc>) => {
  const p = wrapper.get('p').element
  const parts: string[] = []
  for (const node of Array.from(p.childNodes)) {
    if (node.nodeType === 3) {
      parts.push(node.nodeValue ?? '')
      continue
    }
    // 注释节点（模板里的说明文字在测试环境会保留）不算正文
    if (node.nodeType !== 1) continue
    const el = node as HTMLElement
    const cls = el.getAttribute('class') ?? ''
    if (cls.includes('measure') || cls.includes('tail')) continue
    parts.push(el.textContent ?? '')
  }
  return parts.join('')
}

describe('components/common/ExpandableDesc.vue', () => {
  it('正文渲染在 <p> 上，行数经 --desc-lines 传给裁切高度', async() => {
    stubMetrics(30, 30) // 30/16.8 ≈ 2 行，不超过 3 行 → 不截断
    const wrapper = mountDesc({ text: '短简介', lines: 4 })
    await flushPromises()

    expect(visibleText(wrapper)).toBe('短简介')
    expect(wrapper.element.getAttribute('style')).toContain('--desc-lines: 4')
  })

  it('没被截断（行数不超过 lines）时不给展开键', async() => {
    stubMetrics(30, 30)
    const wrapper = mountDesc()
    await flushPromises()

    expect(wrapper.find('button').exists()).toBe(false)
  })

  it('被截断时展开键在**段落内部**（融合进末行），前面带省略号', async() => {
    stubMetrics(200, 100) // 200/16.8 ≈ 12 行 > 3
    const wrapper = mountDesc()
    await flushPromises()

    expect(wrapper.get('p').find('button').exists()).toBe(true)
    expect(wrapper.get('p').find('button').text()).toBe('desc__expand')
    expect(wrapper.get('p').text()).toContain('…')
  })

  it('点击展开：键换成「收起」、省略号收掉，仍在该组件内；再点回收起态', async() => {
    stubMetrics(200, 100)
    const wrapper = mountDesc()
    await flushPromises()

    await wrapper.get('button').trigger('click')
    expect(wrapper.get('button').text()).toBe('desc__collapse')
    expect(wrapper.text()).not.toContain('…')
    // 通知调用页（页面据此给下方列表留最小高度）
    expect(wrapper.emitted('toggle')).toEqual([[true]])

    await wrapper.get('button').trigger('click')
    expect(wrapper.get('button').text()).toBe('desc__expand')
    expect(wrapper.text()).toContain('…')
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

  it('正文全文只出现一次（让位块切分不丢字、不重复）', async() => {
    stubMetrics(200, 100)
    const text = '第一段文字\n第二段文字\n第三段文字\n第四段文字'
    const wrapper = mountDesc({ text })
    await flushPromises()

    // 可见正文（不含隐藏量尺）拼起来应与原文完全一致
    expect(visibleText(wrapper)).toBe(text)
  })
})
