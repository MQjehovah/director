import { watch } from 'vue'
import { useCharacterStore } from '../../stores/characterStore'
import { useScriptStore } from '../../stores/scriptStore'
import { useStoryboardStore } from '../../stores/storyboardStore'
import { useProjectStore } from '../../stores/projectStore'
import { usePluginStore } from '../../stores/pluginStore'
import type { Project } from '../../core/models'

export const WORKSPACE_ID = 'workspace'
const AUTOSAVE_DELAY_MS = 500

let hydrated = false
let saveTimer: ReturnType<typeof setTimeout> | undefined

/** 仅供测试重置模块级状态 */
export function resetWorkspacePersistenceForTest(): void {
  hydrated = false
  if (saveTimer !== undefined) clearTimeout(saveTimer)
  saveTimer = undefined
}

function buildSnapshot(): Project {
  const projectStore = useProjectStore()
  const characterStore = useCharacterStore()
  const scriptStore = useScriptStore()
  const storyboardStore = useStoryboardStore()
  return {
    id: projectStore.project?.id ?? WORKSPACE_ID,
    name: projectStore.project?.name ?? '未命名项目',
    meta: projectStore.project?.meta ?? {},
    characterIds: characterStore.characters.map((c) => c.id),
    scriptId: scriptStore.script?.id,
    storyboardRefs: storyboardStore.shots.map((s) => s.id),
    characters: characterStore.characters,
    script: scriptStore.script,
    shots: storyboardStore.shots,
  }
}

/**
 * 启动时从存储 Provider 恢复工作区（角色/剧本/镜头）。
 * 无存档时静默跳过；恢复后才允许自动保存，避免空数据覆盖存档。
 */
export async function hydrateWorkspace(): Promise<boolean> {
  const projectStore = useProjectStore()
  const characterStore = useCharacterStore()
  const scriptStore = useScriptStore()
  const storyboardStore = useStoryboardStore()
  const storage = usePluginStore().storageProvider
  if (!storage) return false

  let saved: Project | undefined
  try {
    saved = await storage.loadProject(WORKSPACE_ID)
  } catch {
    return false
  }
  if (!saved) {
    hydrated = true
    return false
  }

  projectStore.project = {
    id: saved.id,
    name: saved.name,
    meta: saved.meta,
    characterIds: saved.characterIds,
    scriptId: saved.scriptId,
    storyboardRefs: saved.storyboardRefs,
    characters: saved.characters,
    script: saved.script,
    shots: saved.shots,
  }
  characterStore.restoreCharacters(saved.characters)
  if (saved.script) scriptStore.setScript(saved.script)
  storyboardStore.restoreShots(saved.shots)

  hydrated = true
  return true
}

/**
 * 监听三个领域 store，防抖快照到存储 Provider（单条 workspace 记录）。
 */
export function startWorkspaceAutoSave(): void {
  const characterStore = useCharacterStore()
  const scriptStore = useScriptStore()
  const storyboardStore = useStoryboardStore()
  const projectStore = useProjectStore()

  watch(
    () => [
      characterStore.characters,
      scriptStore.script,
      storyboardStore.shots,
      projectStore.project?.name,
    ],
    () => {
      if (!hydrated) return
      if (saveTimer !== undefined) clearTimeout(saveTimer)
      saveTimer = setTimeout(async () => {
        saveTimer = undefined
        const storage = usePluginStore().storageProvider
        if (!storage) return
        try {
          await storage.saveProject(buildSnapshot())
        } catch {
          // 存储失败（隐私模式/配额）时静默跳过，内存数据不受影响
        }
      }, AUTOSAVE_DELAY_MS)
    },
    { deep: true },
  )
}
