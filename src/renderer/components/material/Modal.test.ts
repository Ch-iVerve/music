import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import Modal from './Modal.vue'

/**
 * Esc 关弹窗(2026-10-25 UI 审查 P1)的行为测试:
 * - 打开时按 Esc → emit close;
 * - 关着时不响应;
 * - 嵌套弹窗只关栈顶(最后打开的那个)。
 * teleport 用 'body'(prop 默认 '#root',jsdom 里没有该节点)。
 * appSetting 只被随机动画用到,桩掉免拉整条 store 链。
 */
vi.mock('@renderer/store/setting', () => ({ appSetting: {} }))

const keydownEscape = () => {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
}

describe('components/material/Modal.vue', () => {
  it('打开时按 Esc 发出 close', async() => {
    const wrapper = mount(Modal, { props: { show: true, teleport: 'body' } })
    await wrapper.vm.$nextTick()

    keydownEscape()

    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
  })

  it('关闭状态按 Esc 不响应', () => {
    const wrapper = mount(Modal, { props: { show: false, teleport: 'body' } })

    keydownEscape()

    expect(wrapper.emitted('close')).toBeUndefined()
    wrapper.unmount()
  })

  it('show 从 true 变 false 后,监听被移除,Esc 不再触发', async() => {
    const wrapper = mount(Modal, { props: { show: true, teleport: 'body' } })
    await wrapper.vm.$nextTick()
    await wrapper.setProps({ show: false })
    await wrapper.vm.$nextTick()

    keydownEscape()

    expect(wrapper.emitted('close')).toBeUndefined()
    wrapper.unmount()
  })

  it('嵌套打开两个弹窗,Esc 只关栈顶那个', async() => {
    const bottom = mount(Modal, { props: { show: true, teleport: 'body' } })
    const top = mount(Modal, { props: { show: true, teleport: 'body' } })
    await top.vm.$nextTick()

    keydownEscape()

    expect(top.emitted('close')).toHaveLength(1)
    expect(bottom.emitted('close')).toBeUndefined()

    // 栈顶关掉(父组件会把 show 置 false)后,Esc 轮到底下的
    await top.setProps({ show: false })
    await bottom.vm.$nextTick()
    keydownEscape()
    expect(bottom.emitted('close')).toHaveLength(1)

    bottom.unmount()
    top.unmount()
  })
})
