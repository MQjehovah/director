import { PluginRegistry } from '../core/plugin/registry'
import {
  createMediaMockPlugin,
  createLLMMockPlugin,
  createTTSSyncPlugin,
  createStorageIndexedDBPlugin,
} from './providers'
import { loadProviderConfigs } from '../features/settings/httpBackendConfig'

export function buildAppPlugins(): PluginRegistry {
  const registry = new PluginRegistry()
  registry.register(createMediaMockPlugin())
  registry.register(createLLMMockPlugin())
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
