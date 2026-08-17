import Dexie from 'dexie'
import { AssetSchema, ProjectSchema } from '../../core/models'
import type { Asset, Project } from '../../core/models'
import type { ProviderPlugin } from '../../core/plugin/types'
import type { AssetMeta, ProjectSummary, StorageProvider } from '../../providers/StorageProvider'

interface StoredProject extends Project {
  updatedAt: string
}

class DirectorDatabase extends Dexie {
  projects!: Dexie.Table<StoredProject, string>
  assets!: Dexie.Table<Asset, string>
  blobs!: Dexie.Table<{ assetId: string; blob: Blob }, string>

  constructor(name: string) {
    super(name)
    this.version(1).stores({
      projects: 'id, updatedAt',
      assets: 'id, kind, source',
      blobs: 'assetId',
    })
  }
}

let db: DirectorDatabase | undefined
let dbName = ''

function getDb(name: string): DirectorDatabase {
  if (!db || dbName !== name) {
    db?.close()
    db = new DirectorDatabase(name)
    dbName = name
  }
  return db
}

export interface StorageIndexedDBOptions {
  databaseName?: string
}

export function createStorageIndexedDBProvider(opts: StorageIndexedDBOptions = {}): StorageProvider {
  const databaseName = opts.databaseName ?? 'ai-director'

  async function loadProject(id: string): Promise<Project | undefined> {
    const record = await getDb(databaseName).projects.get(id)
    if (!record) return undefined
    return ProjectSchema.parse(record)
  }

  async function saveProject(project: Project): Promise<void> {
    const parsed = ProjectSchema.parse(project)
    const record: StoredProject = { ...parsed, updatedAt: new Date().toISOString() }
    await getDb(databaseName).projects.put(record)
  }

  async function listProjects(): Promise<ProjectSummary[]> {
    const records = await getDb(databaseName).projects.toArray()
    return records
      .map((r) => ({ id: r.id, name: r.name, updatedAt: r.updatedAt }))
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
  }

  async function deleteProject(id: string): Promise<void> {
    await getDb(databaseName).projects.delete(id)
  }

  async function saveAsset(file: Blob | File, meta: AssetMeta): Promise<Asset> {
    const id = `asset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
    const db = getDb(databaseName)
    await db.blobs.put({ assetId: id, blob: file })
    const asset = AssetSchema.parse({
      id,
      kind: meta.kind,
      source: meta.source,
      metadata: {
        name: meta.name,
        fileName: file instanceof File ? file.name : undefined,
        size: file.size,
        type: file.type,
      },
    })
    await db.assets.put(asset)
    return asset
  }

  const objectUrls = new Map<string, string>()

  async function getAssetUrl(asset: Asset): Promise<string | undefined> {
    if (asset.url) return asset.url
    if (asset.localPath) return asset.localPath
    const cached = objectUrls.get(asset.id)
    if (cached) return cached
    const record = await getDb(databaseName).blobs.get(asset.id)
    if (!record) return undefined
    const url = URL.createObjectURL(record.blob)
    objectUrls.set(asset.id, url)
    return url
  }

  async function revokeAssetUrl(assetId: string): Promise<void> {
    const url = objectUrls.get(assetId)
    if (url) {
      URL.revokeObjectURL(url)
      objectUrls.delete(assetId)
    }
  }

  return {
    id: 'storage-indexeddb',
    name: 'IndexedDB 存储',
    loadProject,
    saveProject,
    listProjects,
    deleteProject,
    saveAsset,
    getAssetUrl,
    revokeAssetUrl,
  }
}

export function createStorageIndexedDBPlugin(opts?: StorageIndexedDBOptions): ProviderPlugin<StorageProvider> {
  const instance = createStorageIndexedDBProvider(opts)
  return {
    id: 'storage-indexeddb',
    name: 'IndexedDB 存储',
    kind: 'provider',
    providerType: 'storage',
    enabled: true,
    instance,
  }
}
