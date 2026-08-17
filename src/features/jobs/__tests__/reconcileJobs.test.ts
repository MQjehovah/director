import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { PluginRegistry } from '../../../core'
import { usePluginStore } from '../../../stores/pluginStore'
import { useJobStore } from '../../../stores/jobStore'
import { useStoryboardStore } from '../../../stores/storyboardStore'
import { AssetSchema, JobSchema } from '../../../core/models'
import type { Asset } from '../../../core/models'
import { reconcileJobs } from '../reconcileJobs'

function initProviderAndStorage(records: Asset[]): void {
  const registry = new PluginRegistry()
  registry.register({
    id: 'recon-media',
    name: 'Recon Media',
    kind: 'provider',
    providerType: 'media',
    enabled: true,
    capabilities: ['text2image'],
    instance: {
      id: 'recon-media',
      name: 'Recon Media',
      capabilities: ['text2image'],
      async getJob() {
        return JobSchema.parse({
          id: 'j1',
          type: 'text2image',
          status: 'done',
          progress: 100,
          result: { assetIds: ['a1'] },
        })
      },
      async getAsset(id: string) {
        return AssetSchema.parse({
          id,
          kind: 'image',
          source: 'ai',
          url: 'https://example.com/a.png',
        })
      },
    },
  })
  registry.register({
    id: 'storage-inline',
    name: 'Inline Storage',
    kind: 'provider',
    providerType: 'storage',
    enabled: true,
    instance: {
      async saveAssetRecord(asset: Asset) {
        records.push(asset)
      },
      async loadAsset(id: string) {
        return records.find((r) => r.id === id)
      },
      async getAssetUrl(asset: Asset) {
        return asset.url
      },
    },
  })
  usePluginStore().init(registry)
}

describe('reconcileJobs', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('syncs a restored job, persists its asset and attaches it to the shot', async () => {
    const records: Asset[] = []
    initProviderAndStorage(records)
    const jobs = useJobStore()
    const storyboard = useStoryboardStore()
    const shot = storyboard.addShot({ shotType: 'image', prompt: 'x' })
    jobs.restoreJobs([
      JobSchema.parse({
        id: 'j1',
        type: 'text2image',
        status: 'running',
        progress: 10,
        pluginId: 'recon-media',
        shotRef: shot.id,
      }),
    ])
    await reconcileJobs()
    expect(jobs.getJob('j1')?.status).toBe('done')
    expect(storyboard.shotById(shot.id)?.mediaAssets).toContain('a1')
    expect(records.some((a) => a.id === 'a1')).toBe(true)
  })

  it('keeps the restored status when the provider cannot be queried', async () => {
    const registry = new PluginRegistry()
    registry.register({
      id: 'empty-media',
      name: 'Empty Media',
      kind: 'provider',
      providerType: 'media',
      enabled: true,
      capabilities: ['text2image'],
      instance: {
        id: 'empty-media',
        name: 'Empty Media',
        capabilities: ['text2image'],
        async getJob() {
          throw new Error('job not found')
        },
      },
    })
    usePluginStore().init(registry)
    const jobs = useJobStore()
    jobs.restoreJobs([
      JobSchema.parse({
        id: 'j2',
        type: 'text2image',
        status: 'running',
        progress: 10,
        pluginId: 'empty-media',
      }),
    ])
    await reconcileJobs()
    expect(jobs.getJob('j2')?.status).toBe('running')
  })
})
