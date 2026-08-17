import type { Plugin } from './types'
import type { PluginRegistry } from './registry'

export class PluginManager {
  constructor(private readonly registry: PluginRegistry) {}

  register(p: Plugin): void {
    this.registry.register(p)
  }

  get(id: string): Plugin | undefined {
    return this.registry.get(id)
  }

  list(): Plugin[] {
    return this.registry.list()
  }

  isEnabled(id: string): boolean {
    return this.registry.isEnabled(id)
  }

  enable(id: string): void {
    this.registry.enable(id)
  }

  disable(id: string): void {
    this.registry.disable(id)
  }

  toggle(id: string, enabled?: boolean): void {
    const next = enabled ?? !this.isEnabled(id)
    if (next) this.registry.enable(id)
    else this.registry.disable(id)
  }
}
