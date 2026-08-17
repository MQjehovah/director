import { mount } from '@vue/test-utils'
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import TopBar from '../TopBar.vue'
import { usePluginStore } from '../../../stores/pluginStore'
import { useProjects, resetProjectsForTest } from '../../../features/projects/useProjects'
import { PluginRegistry } from '../../../core'
import type { Project } from '../../../core/models'

function createStorageStub() {
  const projects = new Map<string, Project & { updatedAt: string }>()
  return {
    id: 'storage-stub',
    name: 'Storage Stub',
    async loadProject(id: string) {
      return projects.get(id) as Project | undefined
    },
    async saveProject(p: Project) {
      projects.set(p.id, { ...p, updatedAt: new Date().toISOString() })
    },
    async listProjects() {
      return [...projects.values()]
        .map((r) => ({ id: r.id, name: r.name, updatedAt: r.updatedAt }))
        .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    },
    async deleteProject(id: string) {
      projects.delete(id)
    },
    async saveAsset() {
      throw new Error('not needed')
    },
    async getAssetUrl() {
      return undefined
    },
    __dump: () => projects,
  }
}

function installStub(storage: ReturnType<typeof createStorageStub>): void {
  const registry = new PluginRegistry()
  registry.register({
    id: 'storage-stub',
    name: 'Storage Stub',
    kind: 'provider',
    providerType: 'storage',
    enabled: true,
    instance: storage,
  })
  usePluginStore().init(registry)
}

describe('top bar project management', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    resetProjectsForTest()
    installStub(createStorageStub())
    await useProjects().initProjects()
  })

  it('shows the current project name and opens the manager dialog', async () => {
    const w = mount(TopBar)
    expect(w.get('[data-test="topbar-project"]').text()).toContain('默认项目')
    await w.get('[data-test="topbar-project"]').trigger('click')
    expect(document.body.querySelector('[data-test="new-project-input"]')).not.toBeNull()
  })

  it('creates a new project from the dialog', async () => {
    const projects = useProjects()
    const w = mount(TopBar)
    await w.get('[data-test="topbar-project"]').trigger('click')
    const input = document.body.querySelector<HTMLInputElement>('[data-test="new-project-input"]')
    input!.value = '新项目甲'
    input!.dispatchEvent(new Event('input'))
    await new Promise((r) => setTimeout(r, 0))
    const btn = document.body.querySelector<HTMLButtonElement>('[data-test="new-project-create"]')
    btn!.click()
    await new Promise((r) => setTimeout(r, 50))
    expect(projects.currentProject.value?.name).toBe('新项目甲')
    expect(projects.projects.value).toHaveLength(2)
  })
})
