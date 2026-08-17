import { mount } from '@vue/test-utils'
import { describe, it, expect } from 'vitest'
import AppShell from '../AppShell.vue'

describe('app shell', () => {
  it('renders nav sections', () => {
    const w = mount(AppShell)
    expect(w.text()).toContain('角色')
    expect(w.text()).toContain('剧本')
    expect(w.text()).toContain('分镜')
  })

  it('switches active module when a nav item is clicked', async () => {
    const w = mount(AppShell)
    const buttons = w.findAll('nav button')
    expect(buttons.map((b) => b.text())).toEqual(['角色', '剧本', '分镜', '成片', '任务', '全流程'])

    await buttons[1].trigger('click')
    expect(w.text()).toContain('剧本编辑器')
    expect(w.text()).toContain('「剧本编辑器」模块尚未实现')

    await buttons[4].trigger('click')
    expect(w.text()).toContain('任务中心')
  })
})
