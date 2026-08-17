import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { PluginRegistry } from '../../core'
import { usePluginStore } from '../pluginStore'
import { useProjectStore } from '../projectStore'
import type { Project } from '../../core/models'
import type { StorageProvider } from '../../providers'

function installStorage(storage: Partial<StorageProvider>): void {
  const r = new PluginRegistry()
  r.register({
    id: 'mock-storage',
    name: 'Mock Storage',
    kind: 'provider',
    providerType: 'storage',
    enabled: true,
    instance: storage as StorageProvider,
  })
  usePluginStore().init(r)
}

describe('project store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })
  it('creates and persists a project via the storage provider', async () => {
    const saveProject = vi.fn()
    installStorage({ saveProject })
    const s = useProjectStore()
    s.createProject('我的项目')
    await s.save()
    expect(saveProject).toHaveBeenCalledTimes(1)
    const saved = saveProject.mock.calls[0][0] as Project
    expect(saved.name).toBe('我的项目')
    expect(saved.characterIds).toEqual([])
    expect(saved.storyboardRefs).toEqual([])
  })
  it('loads a project from storage', async () => {
    installStorage({
      loadProject: async () => ({
        id: 'p1',
        name: '已存项目',
        meta: {},
        characterIds: ['c1'],
        scriptId: undefined,
        storyboardRefs: [],
      }),
    })
    const s = useProjectStore()
    const p = await s.loadProject('p1')
    expect(p?.name).toBe('已存项目')
    expect(s.project?.name).toBe('已存项目')
    expect(s.project?.characterIds).toEqual(['c1'])
  })
  it('newProject clears the current project', () => {
    const s = useProjectStore()
    s.createProject('x')
    s.newProject()
    expect(s.project).toBeNull()
  })
  it('save is a no-op without a storage provider', async () => {
    const s = useProjectStore()
    s.createProject('离线')
    await expect(s.save()).resolves.toBeUndefined()
  })
})
