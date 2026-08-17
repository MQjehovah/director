import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { PluginRegistry } from '../../../core'
import { usePluginStore } from '../../../stores/pluginStore'
import { AssetSchema } from '../../../core/models'
import type { Asset } from '../../../core/models'
import { persistGeneratedAssets } from '../persistGeneratedAssets'

function initStorage(records: Asset[], withSaveRecord = true): void {
  const registry = new PluginRegistry()
  registry.register({
    id: 'storage-test',
    name: 'Storage Test',
    kind: 'provider',
    providerType: 'storage',
    enabled: true,
    instance: {
      id: 'storage-test',
      name: 'Storage Test',
      ...(withSaveRecord
        ? {
            async saveAssetRecord(asset: Asset) {
              records.push(asset)
            },
          }
        : {}),
    },
  })
  usePluginStore().init(registry)
}

describe('persistGeneratedAssets', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('mirrors provider assets into the storage provider', async () => {
    const records: Asset[] = []
    initStorage(records)
    const provider = {
      async getAsset(id: string) {
        return AssetSchema.parse({
          id,
          kind: 'image' as const,
          source: 'ai' as const,
          url: 'https://example.com/a.png',
        })
      },
    }
    await persistGeneratedAssets(['a1', 'a2'], provider)
    expect(records.map((r) => r.id)).toEqual(['a1', 'a2'])
  })

  it('keeps going when an asset cannot be resolved', async () => {
    const records: Asset[] = []
    initStorage(records)
    const provider = {
      async getAsset() {
        throw new Error('boom')
      },
    }
    await expect(persistGeneratedAssets(['a1'], provider)).resolves.toBeUndefined()
    expect(records).toHaveLength(0)
  })

  it('is a no-op when the storage provider cannot save records', async () => {
    initStorage([], false)
    await expect(
      persistGeneratedAssets(['a1'], {
        async getAsset() {
          return undefined
        },
      }),
    ).resolves.toBeUndefined()
  })
})
