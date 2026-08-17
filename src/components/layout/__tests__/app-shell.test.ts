import { mount } from '@vue/test-utils'
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { defineComponent } from 'vue'
import { PluginRegistry } from '../../../core/plugin/registry'
import { usePluginStore } from '../../../stores/pluginStore'
import { buildAppPlugins } from '../../../plugins/register'
import AppShell from '../AppShell.vue'

const Panel = defineComponent({ name: 'TestPanel', render: () => null })

describe('app shell', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    usePluginStore().init(buildAppPlugins())
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

  it('renders nav modules from the plugin registry', async () => {
    setActivePinia(createPinia())
    const r = new PluginRegistry()
    r.register({
      id: 'feature-custom',
      name: '自定义',
      kind: 'feature',
      featureId: 'custom',
      enabled: true,
      module: { key: 'custom', label: '自定义', title: '自定义模块', order: 1 },
      component: Panel,
    })
    usePluginStore().init(r)
    const w = mount(AppShell)
    const buttons = w.findAll('nav button')
    expect(buttons.map((b) => b.text())).toEqual(['自定义'])
    await buttons[0].trigger('click')
    expect(w.text()).toContain('自定义模块')
  })
})
