import { defineStore } from 'pinia'
import { ref } from 'vue'
import { ProjectSchema } from '../core/models'
import type { Project } from '../core/models'
import { newId } from '../core/utils/id'
import { usePluginStore } from './pluginStore'
import type { StorageProvider } from '../providers'

export const useProjectStore = defineStore('project', () => {
  const project = ref<Project | null>(null)

  function getStorage(): StorageProvider | undefined {
    return usePluginStore().storageProvider
  }

  function createProject(name: string): Project {
    const p = ProjectSchema.parse({ id: newId('project'), name })
    project.value = p
    return p
  }

  async function loadProject(id: string): Promise<Project | undefined> {
    const storage = getStorage()
    if (!storage) return undefined
    const p = await storage.loadProject(id)
    if (!p) return undefined
    const parsed = ProjectSchema.parse(p)
    project.value = parsed
    return parsed
  }

  async function save(): Promise<void> {
    if (!project.value) return
    const storage = getStorage()
    if (!storage) return
    await storage.saveProject(project.value)
  }

  function newProject(): void {
    project.value = null
  }

  return { project, createProject, loadProject, save, newProject }
})
