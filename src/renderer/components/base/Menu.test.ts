import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import Menu from './Menu.vue'

/**
 * 收起态 inert(2026-10-25 UI 审查新发现):菜单收起只有 opacity+pointerEvents,
 * 不把 `tabindex="0"` 的子项移出 Tab 序,键盘会掉进看不见的菜单项。
 * inert 断言到属性反射为止(jsdom 不实现 inert 的焦点行为);teleport 到手动建的 #root。
 * xy 用最小合法值:打开路径会读 clientWidth 夹位置,jsdom 里全 0 也不会崩(0>0 为假)。
 */
const menus = [
  { action: 'play', name: '播放' },
  { action: 'download', name: '下载' },
]

const mountMenu = (modelValue: boolean) => mount(Menu, {
  props: { modelValue, xy: { x: 10, y: 10 }, menus, itemName: 'name' },
})

describe('components/base/Menu.vue', () => {
  it('菜单项常驻 DOM(收起是 opacity 不是 v-if),开合不增减节点', async() => {
    const root = document.createElement('div')
    root.id = 'root'
    document.body.appendChild(root)
    const wrapper = mountMenu(false)
    await wrapper.vm.$nextTick()

    const ul = document.getElementById('root')!.querySelector('ul')!
    expect(ul).toBeTruthy()
    // 收起时节点也在(这正是「Tab 掉进看不见菜单」的根源),所以这里断常驻而不是断消失
    expect(ul.textContent).toContain('播放')
    expect(ul.querySelectorAll('li')).toHaveLength(2)

    await wrapper.setProps({ modelValue: true })
    await wrapper.vm.$nextTick()
    expect(ul.querySelectorAll('li')).toHaveLength(2)

    wrapper.unmount()
    root.remove()
  })

  it('收起时绑定 inert(子项移出 Tab 序与无障碍树),打开时解除', async() => {
    const root = document.createElement('div')
    root.id = 'root'
    document.body.appendChild(root)
    const wrapper = mountMenu(false)
    await wrapper.vm.$nextTick()

    const ul = document.getElementById('root')!.querySelector('ul')!
    // jsdom 没有 inert IDL 属性('inert' in el 为 false),Vue 3.3 走 setAttribute 路径,
    // 属性值 'true'/'false' 就是绑定表达式本身;真 Chromium 有该属性,走 el.inert 赋值,
    // presence 语义由浏览器保证(Electron 42 ≥ Chromium 102)
    expect(ul.getAttribute('inert'), '收起的菜单必须绑定 inert=true').toBe('true')

    await wrapper.setProps({ modelValue: true })
    await wrapper.vm.$nextTick()
    expect(ul.getAttribute('inert'), '打开的菜单绑定必须翻到 false').toBe('false')

    await wrapper.setProps({ modelValue: false })
    await wrapper.vm.$nextTick()
    expect(ul.getAttribute('inert')).toBe('true')

    wrapper.unmount()
    root.remove()
  })
})
