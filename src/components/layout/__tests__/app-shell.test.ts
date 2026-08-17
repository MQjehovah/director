import { mount } from '@vue/test-utils'
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import AppShell from '../AppShell.vue'

describe('app shell', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('renders nav sections', () => {
    const w = mount(AppShell)
    expect(w.text()).toContain('角色')
    expect(w.text()).toContain('剧本')
    expect(w.text()).toContain('分镜')
    expect(w.text()).toContain('设置')
  })

  it('switches active module when a nav item is clicked', async () => {
    const w = mount(AppShell)
    const buttons = w.findAll('nav button')
    expect(buttons.map((b) => b.text())).toEqual([
      '角色',
      '剧本',
      '分镜',
      '成片',
      '任务',
      '全流程',
      '设置',
    ])

    await buttons[1].trigger('click')
    expect(w.text()).toContain('剧本编辑器')
    expect(w.get('[data-test="ai-generate"]')).toBeTruthy()

    await buttons[4].trigger('click')
    expect(w.text()).toContain('任务中心')
    expect(w.get('[data-test="jobs-drawer"]')).toBeTruthy()
  })

  it('opens settings from the top bar settings button', async () => {
    const w = mount(AppShell)
    await w.get('[data-test="topbar-settings"]').trigger('click')
    expect(w.text()).toContain('设置')
    expect(w.get('[data-test="enabled-summary"]')).toBeTruthy()
  })
})
