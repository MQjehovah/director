import { usePluginStore } from '../../stores/pluginStore'
import type { Asset } from '../../core/models'

export type AssetResolver = {
  getAsset?: (assetId: string) => Promise<Asset | undefined>
}

/**
 * 把媒体 Provider 生成的资产镜像到存储 Provider（IndexedDB）：
 * 资产 id 保持不变，刷新后仍能按 id 解析出 URL。
 * 存储 Provider 不支持 saveAssetRecord 时静默跳过（资产仅在当前会话可见）。
 */
export async function persistGeneratedAssets(
  assetIds: string[],
  provider: AssetResolver | undefined,
): Promise<void> {
  const storage = usePluginStore().storageProvider
  if (!storage?.saveAssetRecord || !provider?.getAsset) return
  for (const id of assetIds) {
    try {
      const asset = await provider.getAsset(id)
      if (asset) await storage.saveAssetRecord(asset)
    } catch {
      // 持久化失败不影响当前会话展示
    }
  }
}
