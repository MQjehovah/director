import { defineStore } from 'pinia'
import { computed, reactive, ref, shallowRef } from 'vue'
import type { Component } from 'vue'
import { PluginRegistry } from '../core/plugin/registry'
import type {
  FeatureModuleDef,
  FeaturePlugin,
  MediaCapability,
  PipelineStepDef,
  Plugin,
  ProviderPlugin,
  ProviderType,
} from '../core/plugin/types'
import {
  collectModules,
  resolveFeatureComponent,
  resolveFeatureViewProps,
} from '../core/plugin/features'
import { collectPipelineStepDefs, pipelineStepDefByKind } from '../core/plugin/pipeline'
import type { LLMProvider, MediaProvider, StorageProvider, TTSProvider } from '../providers'

const CAPABILITY_PROVIDER_KEY = 'ai-director:capability-providers'

function loadCapabilityProviders(): Partial<Record<MediaCapability, string>> {
  try {
    const raw = localStorage.getItem(CAPABILITY_PROVIDER_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Partial<Record<MediaCapability, string>>
    }
    return {}
  } catch {
    return {}
  }
}

export const usePluginStore = defineStore('plugin', () => {
  const registry = shallowRef<PluginRegistry | null>(null)
  const activeProviders = ref<Partial<Record<ProviderType, string>>>({})
  const enabledState = reactive<Record<string, boolean>>({})
  const capabilityProviders = reactive<Partial<Record<MediaCapability, string>>>(
    loadCapabilityProviders(),
  )
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

  /** 指派某个能力由哪个 Provider 提供；传空则恢复自动匹配 */
  function setCapabilityProvider(cap: MediaCapability, providerId?: string): void {
    if (providerId) capabilityProviders[cap] = providerId
    else delete capabilityProviders[cap]
    try {
      localStorage.setItem(CAPABILITY_PROVIDER_KEY, JSON.stringify(capabilityProviders))
    } catch {
      // storage may be unavailable; resolution still works within the session
    }
  }

  function capabilityProviderFor(cap: MediaCapability): string | undefined {
    const value = capabilityProviders[cap]
    return typeof value === 'string' && value.length > 0 ? value : undefined
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
    // 1) 用户显式指派的能力提供方
    const assignedId = capabilityProviderFor(cap)
    if (assignedId) {
      const assigned = r.getProvider(assignedId)
      if (
        assigned &&
        assigned.providerType === type &&
        enabledState[assigned.id] &&
        hasCapability(assigned, cap)
      ) {
        return assigned
      }
    }
    // 2) 「设为当前使用」的 Provider
    const preferredId = activeProviders.value[type]
    if (preferredId) {
      const preferred = r.getProvider(preferredId)
      if (preferred && enabledState[preferred.id] && hasCapability(preferred, cap)) {
        return preferred
      }
    }
    // 3) 第一个启用的具备该能力的 Provider
    return enabledProviders(type).find((p) => hasCapability(p, cap))
  }

  function resolveInstanceCapability<T = unknown>(
    type: ProviderType,
    cap: MediaCapability,
    providerId?: string,
  ): T | undefined {
    const r = registry.value
    if (!r) return undefined
    // 指定 Provider 时按 id 精确解析
    if (providerId) {
      const p = r.getProvider(providerId)
      if (
        p &&
        p.providerType === type &&
        enabledState[p.id] &&
        hasCapability(p, cap) &&
        p.instance !== undefined
      ) {
        return p.instance as T
      }
      return undefined
    }
    // 未指定时：优先取用户指派 / 当前启用的 Provider（若具备该能力）
    const resolved = resolveProviderCapability(type, cap)
    if (resolved && resolved.instance !== undefined) return resolved.instance as T
    // 兜底：扫描带实例的已启用 Provider
    const fallback = enabledProviders(type).find(
      (p) => hasCapability(p, cap) && p.instance !== undefined,
    )
    return fallback?.instance as T | undefined
  }

  const mediaProvider = computed<MediaProvider | undefined>(() => resolveInstance<MediaProvider>('media'))
  const llmProvider = computed<LLMProvider | undefined>(() => resolveInstance<LLMProvider>('llm'))
  const ttsProvider = computed<TTSProvider | undefined>(() => resolveInstance<TTSProvider>('tts'))
  const storageProvider = computed<StorageProvider | undefined>(() =>
    resolveInstance<StorageProvider>('storage'),
  )

  const plugins = computed<Plugin[]>(() => registry.value?.list() ?? [])

  function features(): FeaturePlugin[] {
    const r = registry.value
    if (!r) return []
    return r.list().filter((p): p is FeaturePlugin => p.kind === 'feature')
  }

  function featureModules(): FeatureModuleDef[] {
    const r = registry.value
    if (!r) return []
    return collectModules(r)
  }

  function featureComponent(key: string): Component | undefined {
    const r = registry.value
    if (!r) return undefined
    return resolveFeatureComponent(r, key)
  }

  function featureViewProps(key: string): Record<string, unknown> | undefined {
    const r = registry.value
    if (!r) return undefined
    return resolveFeatureViewProps(r, key)
  }

  /** 已启用 PipelinePlugin 的步骤定义，按 order 排序，供画布「添加节点」使用。 */
  function pipelineStepDefs(): PipelineStepDef[] {
    const r = registry.value
    if (!r) return []
    return collectPipelineStepDefs(r)
  }

  function pipelineStepDef(kind: string): PipelineStepDef | undefined {
    const r = registry.value
    if (!r) return undefined
    return pipelineStepDefByKind(r, kind)
  }

  return {
    activeProviders,
    init,
    enabledProviders,
    setActiveProvider,
    setCapabilityProvider,
    capabilityProviderFor,
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
    features,
    featureModules,
    featureComponent,
    featureViewProps,
    pipelineStepDefs,
    pipelineStepDef,
  }
})
