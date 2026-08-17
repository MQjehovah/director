import type { Asset, Project } from '../core/models'

export interface ProjectSummary {
  id: string
  name: string
  updatedAt: string
}

export interface AssetMeta {
  kind: Asset['kind']
  source: Asset['source']
  name?: string
}

export interface StorageProvider {
  id: string
  name: string
  loadProject(id: string): Promise<Project | undefined>
  saveProject(project: Project): Promise<void>
  listProjects(): Promise<ProjectSummary[]>
  deleteProject(id: string): Promise<void>
  saveAsset(file: Blob | File, meta: AssetMeta): Promise<Asset>
  getAssetUrl(asset: Asset): Promise<string | undefined>
}
