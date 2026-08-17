import { reactive } from 'vue'
import { usePluginStore } from '../../stores/pluginStore'
import type { Asset } from '../../core/models'

const urlCache = reactive<Record<string, string>>({})
const pending = new Set<string>()

function isDirectUrl(value: string): boolean {
  return (
    value.startsWith('data:') ||
    value.startsWith('http') ||
    value.startsWith('/') ||
    value.startsWith('blob:')
  )
}

type AssetResolvingMedia = {
  getAsset?: (assetId: string) => Promise<Asset | undefined>
}

/**
 * 统一解析参考图/媒体资产的显示 URL：
 * - 直接 URL（data:/http//blob:）原样使用
 * - 其余视为资产 ID：先查存储 Provider（上传的资产），再查媒体 Provider（AI 生成的资产）
 * 结果缓存在模块级 reactive map，供网格/编辑器共享。
 */
export function useAssetUrls() {
  const pluginStore = usePluginStore()

  async function resolveAsset(idOrUrl: string): Promise<string | undefined> {
    if (urlCache[idOrUrl]) return urlCache[idOrUrl]
    if (isDirectUrl(idOrUrl)) {
      urlCache[idOrUrl] = idOrUrl
      return idOrUrl
    }
    if (pending.has(idOrUrl)) return undefined
    pending.add(idOrUrl)
    try {
      const storage = pluginStore.storageProvider
      if (storage?.loadAsset) {
        const asset = await storage.loadAsset(idOrUrl)
        const url = asset ? await storage.getAssetUrl(asset) : undefined
        if (url) {
          urlCache[idOrUrl] = url
          return url
        }
      }
      // 遍历所有启用的媒体 Provider，用各自 getAsset 解析（生成可能走任一 Provider）
      for (const provider of pluginStore.enabledProviders('media')) {
        const instance = provider.instance as AssetResolvingMedia | undefined
        if (instance?.getAsset) {
          const asset = await instance.getAsset(idOrUrl)
          if (asset?.url) {
            urlCache[idOrUrl] = asset.url
            return asset.url
          }
        }
      }
      return undefined
    } catch {
      return undefined
    } finally {
      pending.delete(idOrUrl)
    }
  }

  function urlOf(idOrUrl: string | undefined): string | undefined {
    if (!idOrUrl) return undefined
    return urlCache[idOrUrl] ?? (isDirectUrl(idOrUrl) ? idOrUrl : undefined)
  }

  return { resolveAsset, urlOf }
}
