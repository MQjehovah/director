import { PluginRegistry } from '../core/plugin/registry'
import {
  createMediaMockPlugin,
  createLLMMockPlugin,
  createLLMHttpPlugin,
  createTTSSyncPlugin,
  createStorageIndexedDBPlugin,
} from './providers'
import { loadProviderConfigs } from '../features/settings/httpBackendConfig'

export function buildAppPlugins(): PluginRegistry {
  const registry = new PluginRegistry()
  registry.register(createMediaMockPlugin())
  registry.register(createLLMMockPlugin())
  // 注册在 mock 之后：未手动选择时默认仍使用 mock，配置并选用 HTTP LLM 后切换
  registry.register(createLLMHttpPlugin())
  registry.register(createTTSSyncPlugin())
  registry.register(createStorageIndexedDBPlugin())
  return registry
}

export interface ProviderConfigApplicator {
  toggle(id: string, enabled?: boolean): void
}

/**
 * Applies persisted provider config (localStorage, written only by the settings
 * feature) on top of the freshly built registry: any provider saved with
 * `enabled === false` stays disabled after registration.
 */
export function applySavedProviderConfig(store: ProviderConfigApplicator): void {
  const configs = loadProviderConfigs()
  for (const [id, config] of Object.entries(configs)) {
    if (config.enabled === false) store.toggle(id, false)
  }
}
