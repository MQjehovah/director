import { PluginRegistry } from '../core/plugin/registry'
import {
  createMediaComfyUIPlugin,
  createMediaDashScopePlugin,
  createLLMHttpPlugin,
  createStorageIndexedDBPlugin,
} from './providers'
import {
  createCharactersFeaturePlugin,
  createScriptFeaturePlugin,
  createStoryboardFeaturePlugin,
  createFilmFeaturePlugin,
  createTasksFeaturePlugin,
  createPipelineFeaturePlugin,
  createSettingsFeaturePlugin,
  createAgentFeaturePlugin,
} from './features'
import {
  createAssemblePipelinePlugin,
  createCutPipelinePlugin,
  createPortraitPipelinePlugin,
  createRenderPipelinePlugin,
  createSceneArtPipelinePlugin,
  createScriptPipelinePlugin,
  createVoicePipelinePlugin,
} from './pipeline'
import { loadProviderConfigs } from '../features/settings/httpBackendConfig'

export function buildAppPlugins(): PluginRegistry {
  const registry = new PluginRegistry()
  registry.register(createMediaComfyUIPlugin())
  registry.register(createMediaDashScopePlugin())
  registry.register(createLLMHttpPlugin())
  registry.register(createStorageIndexedDBPlugin())
  registry.register(createCharactersFeaturePlugin())
  registry.register(createScriptFeaturePlugin())
  registry.register(createStoryboardFeaturePlugin())
  registry.register(createFilmFeaturePlugin())
  registry.register(createTasksFeaturePlugin())
  registry.register(createPipelineFeaturePlugin())
  registry.register(createSettingsFeaturePlugin())
  registry.register(createAgentFeaturePlugin())
  registry.register(createScriptPipelinePlugin())
  registry.register(createCutPipelinePlugin())
  registry.register(createSceneArtPipelinePlugin())
  registry.register(createPortraitPipelinePlugin())
  registry.register(createRenderPipelinePlugin())
  registry.register(createVoicePipelinePlugin())
  registry.register(createAssemblePipelinePlugin())
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
