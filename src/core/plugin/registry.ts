import { EventBus } from '../bus'
import type { Plugin, PluginEvents, ProviderPlugin, ProviderType } from './types'

export class PluginRegistry {
  private plugins = new Map<string, Plugin>()
  private bus = new EventBus<PluginEvents>()

  register(p: Plugin): void {
    if (this.plugins.has(p.id)) {
      throw new Error(`plugin already registered: ${p.id}`)
    }
    this.plugins.set(p.id, p)
    this.bus.emit('plugin:registered', p)
  }

  unregister(id: string): void {
    this.plugins.delete(id)
  }

  get(id: string): Plugin | undefined {
    return this.plugins.get(id)
  }

  getProvider(id: string): ProviderPlugin | undefined {
    const p = this.plugins.get(id)
    return p?.kind === 'provider' ? p : undefined
  }

  resolveProvider(providerType: ProviderType): ProviderPlugin[] {
    const out: ProviderPlugin[] = []
    for (const p of this.plugins.values()) {
      if (p.kind === 'provider' && p.providerType === providerType) out.push(p)
    }
    return out
  }

  list(): Plugin[] {
    return [...this.plugins.values()]
  }

  isEnabled(id: string): boolean {
    return this.plugins.get(id)?.enabled ?? false
  }

  enable(id: string): void {
    const p = this.plugins.get(id)
    if (p && !p.enabled) {
      p.enabled = true
      this.bus.emit('plugin:stateChanged', p)
    }
  }

  disable(id: string): void {
    const p = this.plugins.get(id)
    if (p && p.enabled) {
      p.enabled = false
      this.bus.emit('plugin:stateChanged', p)
    }
  }

  on(event: keyof PluginEvents, handler: (payload: Plugin) => void): () => void {
    return this.bus.on(event, handler)
  }

  off(event: keyof PluginEvents, handler: (payload: Plugin) => void): void {
    this.bus.off(event, handler)
  }

  emit(event: keyof PluginEvents, payload: Plugin): void {
    this.bus.emit(event, payload)
  }
}
