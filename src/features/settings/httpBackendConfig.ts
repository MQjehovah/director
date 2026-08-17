export interface ProviderConfig {
  baseUrl?: string
  apiKey?: string
  model?: string
  enabled?: boolean
  [k: string]: unknown
}

export type ProviderConfigMap = Record<string, ProviderConfig>

const STORAGE_PREFIX = 'ai-director:provider:'

function storageKey(id: string): string {
  return `${STORAGE_PREFIX}${id}`
}

export function loadProviderConfigs(): ProviderConfigMap {
  const out: ProviderConfigMap = {}
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i)
    if (!key || !key.startsWith(STORAGE_PREFIX)) continue
    const id = key.slice(STORAGE_PREFIX.length)
    const config = loadProviderConfig(id)
    if (config) out[id] = config
  }
  return out
}

export function loadProviderConfig(id: string): ProviderConfig | undefined {
  const raw = localStorage.getItem(storageKey(id))
  if (!raw) return undefined
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as ProviderConfig
    }
    return undefined
  } catch {
    return undefined
  }
}

export function saveProviderConfig(id: string, config: ProviderConfig): void {
  localStorage.setItem(storageKey(id), JSON.stringify(config))
}

export function clearProviderConfig(id: string): void {
  localStorage.removeItem(storageKey(id))
}
