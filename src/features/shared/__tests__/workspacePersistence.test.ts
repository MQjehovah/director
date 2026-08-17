import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import {
  hydrateWorkspace,
  startWorkspaceAutoSave,
  resetWorkspacePersistenceForTest,
  WORKSPACE_ID,
} from '../useWorkspacePersistence'
import { useCharacterStore } from '../../../stores/characterStore'
import { useScriptStore } from '../../../stores/scriptStore'
import { useStoryboardStore } from '../../../stores/storyboardStore'
import { usePluginStore } from '../../../stores/pluginStore'
import { PluginRegistry } from '../../../core'

/** 内存版存储 Provider 桩，模拟 IndexedDB 的 project 表 */
function createStorageStub() {
  const projects = new Map<string, unknown>()
  return {
    id: 'storage-stub',
    name: 'Storage Stub',
    async loadProject(id: string) {
      return projects.get(id) as never
    },
    async saveProject(_p: { id: string }) {
      projects.set(_p.id, _p)
    },
    async listProjects() {
      return []
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

async function settleAutosave(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 600))
}

describe('workspace persistence', () => {
  let storage: ReturnType<typeof createStorageStub>

  beforeEach(() => {
    setActivePinia(createPinia())
    resetWorkspacePersistenceForTest()
    storage = createStorageStub()
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
  })

  it('saves workspace data on change (debounced) and restores it after refresh', async () => {
    await hydrateWorkspace()
    startWorkspaceAutoSave()

    const characters = useCharacterStore()
    const script = useScriptStore()
    const storyboard = useStoryboardStore()

    const c = characters.addCharacter({ name: '小明', appearance: '黑发少年' })
    const scene = script.addScene({ title: '屋顶' })
    const beat = script.addBeat(scene.id, {
      type: 'dialogue',
      dialogue: { speaker: '小明', text: '你好' },
    })
    storyboard.cutSceneToShots(script.scenes[0])

    await settleAutosave()
    const saved = storage.__dump().get(WORKSPACE_ID) as {
      characters: { id: string }[]
      script: { scenes: unknown[] }
      shots: { id: string; beatRef: string }[]
    }
    expect(saved.characters).toHaveLength(1)
    expect(saved.script.scenes).toHaveLength(1)
    expect(saved.shots).toHaveLength(1)
    expect(saved.shots[0].beatRef).toBe(beat.id)

    // 模拟刷新：全新 pinia + 相同存储
    setActivePinia(createPinia())
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
    const restored = await hydrateWorkspace()
    expect(restored).toBe(true)

    const characters2 = useCharacterStore()
    const script2 = useScriptStore()
    const storyboard2 = useStoryboardStore()
    expect(characters2.characters[0]?.id).toBe(c.id)
    expect(characters2.characters[0]?.name).toBe('小明')
    expect(script2.scenes[0]?.title).toBe('屋顶')
    expect(script2.scenes[0]?.beats[0]?.id).toBe(beat.id)
    expect(storyboard2.shots).toHaveLength(1)
    expect(storyboard2.shots[0]?.beatRef).toBe(beat.id)
  })

  it('restoreShots 推进序号，恢复后新增镜头 id 不冲突', async () => {
    await hydrateWorkspace()
    const storyboard = useStoryboardStore()
    storyboard.restoreShots([{ id: 'shot-3', shotType: 'image' } as never])
    const fresh = storyboard.addShot({ shotType: 'image' })
    expect(fresh.id).toBe('shot-4')
  })

  it('returns false when there is no saved workspace', async () => {
    const restored = await hydrateWorkspace()
    expect(restored).toBe(false)
  })

  it('does not autosave before hydration completed', async () => {
    // 未调用 hydrateWorkspace 就启动自动保存：不应写任何数据
    startWorkspaceAutoSave()
    useCharacterStore().addCharacter({ name: '小明' })
    await settleAutosave()
    expect(storage.__dump().has(WORKSPACE_ID)).toBe(false)
  })
})
