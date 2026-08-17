import { ref, watch } from 'vue'
import { useCharacterStore } from '../../stores/characterStore'
import { useJobStore } from '../../stores/jobStore'
import { useScriptStore } from '../../stores/scriptStore'
import { useStoryboardStore } from '../../stores/storyboardStore'
import { usePluginStore } from '../../stores/pluginStore'
import { ProjectSchema } from '../../core/models'
import type { Project } from '../../core/models'
import { newId } from '../../core/utils/id'
import type { StorageProvider } from '../../providers'
import { reconcileJobs } from '../jobs/reconcileJobs'

export const LEGACY_WORKSPACE_ID = 'workspace'
const AUTOSAVE_DELAY_MS = 500

let saveTimer: ReturnType<typeof setTimeout> | undefined
let ready = false

// 模块级单例状态：useProjects() 任意次调用共享同一组 ref，
// 使 TopBar / main.ts / 各功能在切换项目时保持同步
const currentProjectId = ref<string | null>(null)
const projects = ref<Array<{ id: string; name: string; updatedAt: string }>>([])
const currentProject = ref<Project | null>(null)

/** 仅供测试重置模块级状态 */
export function resetProjectsForTest(): void {
  ready = false
  if (saveTimer !== undefined) clearTimeout(saveTimer)
  saveTimer = undefined
  currentProjectId.value = null
  projects.value = []
  currentProject.value = null
}

function getStorage(): StorageProvider | undefined {
  return usePluginStore().storageProvider
}

function buildSnapshot(projectId: string, projectName: string): Project {
  const characterStore = useCharacterStore()
  const jobStore = useJobStore()
  const scriptStore = useScriptStore()
  const storyboardStore = useStoryboardStore()
  return {
    id: projectId,
    name: projectName,
    meta: {},
    characterIds: characterStore.characters.map((c) => c.id),
    scriptId: scriptStore.script?.id,
    storyboardRefs: storyboardStore.shots.map((s) => s.id),
    // 拷贝快照，避免与 store 数组共享引用：后续 resetWorkspace 的 splice 会原地清空
    characters: characterStore.characters.map((c) => ({ ...c })),
    script: scriptStore.script
      ? {
          id: scriptStore.script.id,
          title: scriptStore.script.title,
          synopsis: scriptStore.script.synopsis,
          globalContext: scriptStore.script.globalContext,
          scenes: scriptStore.script.scenes.map((s) => ({ ...s, beats: s.beats.map((b) => ({ ...b })) })),
        }
      : null,
    shots: storyboardStore.shots.map((s) => ({ ...s, mediaAssets: [...s.mediaAssets] })),
    jobs: jobStore.jobs.map((j) => ({ ...j })),
  }
}

export function useProjects() {
  async function refreshList(): Promise<void> {
    const storage = getStorage()
    if (!storage) return
    projects.value = await storage.listProjects()
  }

  function resetWorkspace(): void {
    const characterStore = useCharacterStore()
    const jobStore = useJobStore()
    const scriptStore = useScriptStore()
    const storyboardStore = useStoryboardStore()
    characterStore.characters.splice(0)
    jobStore.removeAll()
    scriptStore.clearScript()
    storyboardStore.shots.splice(0)
  }

  /** 从已加载的 Project 恢复工作区（角色/剧本/分镜） */
  function applyProject(saved: Project): void {
    const characterStore = useCharacterStore()
    const jobStore = useJobStore()
    const scriptStore = useScriptStore()
    const storyboardStore = useStoryboardStore()
    currentProject.value = saved
    characterStore.restoreCharacters(saved.characters)
    if (saved.script) scriptStore.setScript(saved.script)
    storyboardStore.restoreShots(saved.shots)
    jobStore.restoreJobs(saved.jobs)
    // 刷新/切回项目后：恢复任务列表，并尝试与媒体 Provider 对账（运行中的任务续跑）
    void reconcileJobs()
  }

  /** 启动初始化：迁移旧 workspace、列出项目、默认加载最近项目 */
  async function initProjects(): Promise<void> {
    const storage = getStorage()
    if (!storage) return
    // 迁移旧版单工作区记录 → 默认项目
    const legacy = await storage.loadProject(LEGACY_WORKSPACE_ID)
    if (legacy) {
      const defaultProject = ProjectSchema.parse({
        id: newId('project'),
        name: legacy.name && legacy.name !== '未命名项目' ? legacy.name : '默认项目',
        meta: legacy.meta,
        characterIds: legacy.characterIds,
        scriptId: legacy.scriptId,
        storyboardRefs: legacy.storyboardRefs,
        characters: legacy.characters,
        script: legacy.script,
        shots: legacy.shots,
      })
      await storage.saveProject(defaultProject)
      await storage.deleteProject(LEGACY_WORKSPACE_ID)
    }
    await refreshList()
    if (projects.value.length === 0) {
      const first = ProjectSchema.parse({ id: newId('project'), name: '默认项目' })
      await storage.saveProject(first)
      await refreshList()
    }
    // 加载最近更新的项目
    const latest = projects.value[0]
    if (latest) {
      await switchProject(latest.id)
    }
    ready = true
  }

  /** 切换前持久化当前项目快照（新建/删除/切换共用） */
  async function persistCurrent(): Promise<void> {
    const storage = getStorage()
    const proj = currentProject.value
    if (!storage || !proj) return
    await storage.saveProject(buildSnapshot(proj.id, proj.name))
  }

  async function switchProject(id: string): Promise<void> {
    const storage = getStorage()
    if (!storage) return
    if (currentProject.value && currentProject.value.id !== id) {
      await persistCurrent()
    }
    const saved = await storage.loadProject(id)
    if (!saved) return
    resetWorkspace()
    applyProject(saved)
    currentProjectId.value = id
    await refreshList()
  }

  async function createProject(name: string): Promise<Project> {
    const storage = getStorage()
    if (!storage) throw new Error('未配置存储 Provider')
    await persistCurrent()
    const p = ProjectSchema.parse({ id: newId('project'), name: name || '未命名项目' })
    await storage.saveProject(p)
    resetWorkspace()
    currentProject.value = p
    currentProjectId.value = p.id
    await refreshList()
    return p
  }

  async function renameProject(id: string, name: string): Promise<void> {
    const storage = getStorage()
    if (!storage) return
    const saved = await storage.loadProject(id)
    if (!saved) return
    const renamed = ProjectSchema.parse({ ...saved, name: name || saved.name })
    await storage.saveProject(renamed)
    if (currentProject.value?.id === id) currentProject.value = renamed
    await refreshList()
  }

  async function deleteProject(id: string): Promise<void> {
    const storage = getStorage()
    if (!storage) return
    // 清除挂起的自动保存，避免删除后 timer 把已删项目写回
    if (saveTimer !== undefined) {
      clearTimeout(saveTimer)
      saveTimer = undefined
    }
    await storage.deleteProject(id)
    if (currentProjectId.value === id) {
      resetWorkspace()
      currentProject.value = null
      currentProjectId.value = null
      await refreshList()
      const next = projects.value[0]
      if (next) await switchProject(next.id)
      else await createProject('默认项目')
    } else {
      await refreshList()
    }
  }

  /** 监听领域 store，防抖保存当前项目快照 */
  function startAutoSave(): void {
    const characterStore = useCharacterStore()
    const jobStore = useJobStore()
    const scriptStore = useScriptStore()
    const storyboardStore = useStoryboardStore()
    watch(
      () => [
        characterStore.characters,
        scriptStore.script,
        storyboardStore.shots,
        jobStore.jobs,
        currentProject.value?.name,
      ],
      () => {
        if (!ready) return
        if (!currentProject.value) return
        if (saveTimer !== undefined) clearTimeout(saveTimer)
        saveTimer = setTimeout(async () => {
          saveTimer = undefined
          const storage = getStorage()
          const proj = currentProject.value
          if (!storage || !proj) return
          try {
            await storage.saveProject(buildSnapshot(proj.id, proj.name))
          } catch {
            // 存储失败（隐私模式/配额）时静默跳过
          }
        }, AUTOSAVE_DELAY_MS)
      },
      { deep: true },
    )
  }

  return {
    currentProjectId,
    currentProject,
    projects,
    refreshList,
    initProjects,
    switchProject,
    createProject,
    renameProject,
    deleteProject,
    startAutoSave,
  }
}
