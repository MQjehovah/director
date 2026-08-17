import { defineStore } from 'pinia'
import { computed, reactive, ref } from 'vue'
import { PluginRegistry } from '../core/plugin/registry'
import type { MediaCapability, Plugin, ProviderPlugin, ProviderType } from '../core/plugin/types'
import type { LLMProvider, MediaProvider, StorageProvider, TTSProvider } from '../providers'

export const usePluginStore = defineStore('plugin', () => {
  const registry = ref<PluginRegistry | null>(null)
  const activeProviders = ref<Partial<Record<ProviderType, string>>>({})
  const enabledState = reactive<Record<string, boolean>>({})
  let unsubscribe: (() => void) | undefined

  function init(r: PluginRegistry): void {
    unsubscribe?.()
    registry.value = r
    for (const p of r.list()) enabledState[p.id] = p.enabled
    unsubscribe = r.on('plugin:stateChanged', (p) => {
      enabledState[p.id] = p.enabled
    })
  }

  function enabledProviders(type: ProviderType): ProviderPlugin[] {
    const r = registry.value
    if (!r) return []
    return r.resolveProvider(type).filter((p) => enabledState[p.id])
  }

  function setActiveProvider(type: ProviderType, id: string): void {
    activeProviders.value = { ...activeProviders.value, [type]: id }
  }

  function isEnabled(id: string): boolean {
    return enabledState[id] ?? false
  }

  function toggle(id: string, enabled?: boolean): void {
    const r = registry.value
    if (!r) return
    const next = enabled ?? !r.isEnabled(id)
    if (next) r.enable(id)
    else r.disable(id)
    enabledState[id] = next
  }

  function resolveInstance<T>(type: ProviderType): T | undefined {
    const r = registry.value
    if (!r) return undefined
    const preferredId = activeProviders.value[type]
    if (preferredId) {
      const preferred = r.getProvider(preferredId)
      if (preferred && enabledState[preferred.id] && preferred.instance !== undefined) {
        return preferred.instance as T
      }
    }
    const first = enabledProviders(type)[0]
    return first?.instance as T | undefined
  }

  function getProviderInstance<T = unknown>(id: string | undefined): T | undefined {
    if (!id) return undefined
    const r = registry.value
    if (!r) return undefined
    const p = r.getProvider(id)
    if (!p || !enabledState[p.id] || p.instance === undefined) return undefined
    return p.instance as T
  }

  /** 能力判断：兼容旧的布尔位图与新的能力名数组两种形态；未声明能力视为具备全部能力 */
  function hasCapability(p: ProviderPlugin | undefined, cap: MediaCapability): boolean {
    const capabilities = p?.capabilities as unknown
    if (capabilities === undefined) return true
    if (Array.isArray(capabilities)) return capabilities.includes(cap)
    if (typeof capabilities === 'object') return Boolean((capabilities as Record<string, boolean>)[cap])
    return false
  }

  function resolveProviderCapability(
    type: ProviderType,
    cap: MediaCapability,
  ): ProviderPlugin | undefined {
    const r = registry.value
    if (!r) return undefined
    const preferredId = activeProviders.value[type]
    if (preferredId) {
      const preferred = r.getProvider(preferredId)
      if (preferred && enabledState[preferred.id] && hasCapability(preferred, cap)) {
        return preferred
      }
    }
    return enabledProviders(type).find((p) => hasCapability(p, cap))
  }

  function resolveInstanceCapability<T = unknown>(
    type: ProviderType,
    cap: MediaCapability,
  ): T | undefined {
    return resolveProviderCapability(type, cap)?.instance as T | undefined
  }

  const mediaProvider = computed<MediaProvider | undefined>(() => resolveInstance<MediaProvider>('media'))
  const llmProvider = computed<LLMProvider | undefined>(() => resolveInstance<LLMProvider>('llm'))
  const ttsProvider = computed<TTSProvider | undefined>(() => resolveInstance<TTSProvider>('tts'))
  const storageProvider = computed<StorageProvider | undefined>(() =>
    resolveInstance<StorageProvider>('storage'),
  )

  const plugins = computed<Plugin[]>(() => registry.value?.list() ?? [])

  return {
    activeProviders,
    init,
    enabledProviders,
    setActiveProvider,
    isEnabled,
    toggle,
    getProviderInstance,
    hasCapability,
    resolveProviderCapability,
    resolveInstanceCapability,
    mediaProvider,
    llmProvider,
    ttsProvider,
    storageProvider,
    plugins,
  }
})
