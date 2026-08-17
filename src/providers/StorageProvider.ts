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
  /** 按资产自身 id 保存记录（供 AI 生成资产持久化，URL/localPath 原样保留） */
  saveAssetRecord?(asset: Asset): Promise<void>
  loadAsset?(id: string): Promise<Asset | undefined>
  getAssetUrl(asset: Asset): Promise<string | undefined>
  revokeAssetUrl?(assetId: string): Promise<void>
}
