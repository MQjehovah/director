import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useProjects, resetProjectsForTest, LEGACY_WORKSPACE_ID } from '../useProjects'
import { useCharacterStore } from '../../../stores/characterStore'
import { useScriptStore } from '../../../stores/scriptStore'
import { useStoryboardStore } from '../../../stores/storyboardStore'
import { usePluginStore } from '../../../stores/pluginStore'
import { PluginRegistry } from '../../../core'
import { ProjectSchema } from '../../../core/models'
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

async function settleAutosave(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 600))
}

describe('useProjects', () => {
  let storage: ReturnType<typeof createStorageStub>

  beforeEach(() => {
    setActivePinia(createPinia())
    resetProjectsForTest()
    storage = createStorageStub()
    installStub(storage)
  })

  it('initializes with a default project when none exist', async () => {
    const p = useProjects()
    await p.initProjects()
    expect(p.currentProjectId.value).toBeTruthy()
    expect(p.currentProject.value?.name).toBe('默认项目')
    expect(p.projects.value).toHaveLength(1)
  })

  it('creates, switches and deletes projects with isolated workspaces', async () => {
    const p = useProjects()
    await p.initProjects()
    const firstId = p.currentProjectId.value!

    // 在项目 A 中放数据
    const characters = useCharacterStore()
    const script = useScriptStore()
    const storyboard = useStoryboardStore()
    characters.addCharacter({ name: '甲' })
    script.addScene({ title: '第一场' })
    storyboard.addShot({ shotType: 'image' })

    // 新建项目 B，工作区清空
    const b = await p.createProject('项目B')
    expect(p.currentProjectId.value).toBe(b.id)
    expect(useCharacterStore().characters).toHaveLength(0)
    expect(useScriptStore().scenes).toHaveLength(0)
    expect(useStoryboardStore().shots).toHaveLength(0)

    await settleAutosave()
    // 切回项目 A → 数据恢复
    await p.switchProject(firstId)
    expect(useCharacterStore().characters[0]?.name).toBe('甲')
    expect(useScriptStore().scenes[0]?.title).toBe('第一场')
    expect(useStoryboardStore().shots).toHaveLength(1)

    // 删除项目 A → 自动切到剩余项目
    await p.deleteProject(firstId)
    expect(p.currentProjectId.value).toBe(b.id)
    expect(useCharacterStore().characters).toHaveLength(0)
  })

  it('renames the current project', async () => {
    const p = useProjects()
    await p.initProjects()
    await p.renameProject(p.currentProjectId.value!, '改名后')
    expect(p.currentProject.value?.name).toBe('改名后')
    expect(p.projects.value[0].name).toBe('改名后')
  })

  it('migrates a legacy workspace record into a default project', async () => {
    const legacy = ProjectSchema.parse({
      id: LEGACY_WORKSPACE_ID,
      name: '旧工作区',
      characters: [{ id: 'c1', name: '旧角色' }],
      script: null,
      shots: [],
    })
    storage.saveProject(legacy as Project)
    const p = useProjects()
    await p.initProjects()
    expect(p.currentProject.value?.name).toBe('旧工作区')
    expect(useCharacterStore().characters[0]?.name).toBe('旧角色')
    // 旧记录已迁移删除
    expect(storage.__dump().has(LEGACY_WORKSPACE_ID)).toBe(false)
  })

  it('switching projects persists the current workspace before loading the next', async () => {
    const p = useProjects()
    await p.initProjects()
    const firstId = p.currentProjectId.value!
    useCharacterStore().addCharacter({ name: '要保存的' })
    await p.createProject('空项目')
    // 切回第一个项目，未触发 autosave 也应持久化（switchProject 内保存）
    await p.switchProject(firstId)
    const saved = storage.__dump().get(firstId) as Project | undefined
    expect(saved?.characters[0]?.name).toBe('要保存的')
  })
})
