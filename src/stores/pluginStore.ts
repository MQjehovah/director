import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { PluginRegistry } from '../core/plugin/registry'
import type { Plugin, ProviderPlugin, ProviderType } from '../core/plugin/types'
import type { LLMProvider, MediaProvider, StorageProvider, TTSProvider } from '../providers'

export const usePluginStore = defineStore('plugin', () => {
  const registry = ref<PluginRegistry | null>(null)
  const activeProviders = ref<Partial<Record<ProviderType, string>>>({})
  const version = ref(0)

  function init(r: PluginRegistry): void {
    registry.value = r
    version.value += 1
  }

  function enabledProviders(type: ProviderType): ProviderPlugin[] {
    return registry.value?.resolveEnabledProvider(type) ?? []
  }

  function setActiveProvider(type: ProviderType, id: string): void {
    activeProviders.value = { ...activeProviders.value, [type]: id }
  }

  function isEnabled(id: string): boolean {
    return registry.value?.isEnabled(id) ?? false
  }

  function toggle(id: string, enabled?: boolean): void {
    const r = registry.value
    if (!r) return
    const next = enabled ?? !r.isEnabled(id)
    if (next) r.enable(id)
    else r.disable(id)
    version.value += 1
  }

  function resolveInstance<T>(type: ProviderType): T | undefined {
    const preferredId = activeProviders.value[type]
    if (preferredId) {
      const preferred = registry.value?.getProvider(preferredId)
      if (preferred?.enabled && preferred.instance !== undefined) {
        return preferred.instance as T
      }
    }
    const first = enabledProviders(type)[0]
    return first?.instance as T | undefined
  }

  const mediaProvider = computed<MediaProvider | undefined>(() => {
    void version.value
    return resolveInstance<MediaProvider>('media')
  })
  const llmProvider = computed<LLMProvider | undefined>(() => {
    void version.value
    return resolveInstance<LLMProvider>('llm')
  })
  const ttsProvider = computed<TTSProvider | undefined>(() => {
    void version.value
    return resolveInstance<TTSProvider>('tts')
  })
  const storageProvider = computed<StorageProvider | undefined>(() => {
    void version.value
    return resolveInstance<StorageProvider>('storage')
  })

  const plugins = computed<Plugin[]>(() => {
    void version.value
    return registry.value?.list() ?? []
  })

  return {
    registry,
    activeProviders,
    init,
    enabledProviders,
    setActiveProvider,
    isEnabled,
    toggle,
    mediaProvider,
    llmProvider,
    ttsProvider,
    storageProvider,
    plugins,
  }
})
