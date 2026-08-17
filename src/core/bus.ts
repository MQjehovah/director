export type BusHandler<P> = (payload: P) => void

export class EventBus<E = Record<string, unknown>> {
  private handlers = new Map<keyof E, Set<BusHandler<any>>>()

  on<K extends keyof E>(event: K, handler: BusHandler<E[K]>): () => void {
    let set = this.handlers.get(event)
    if (!set) {
      set = new Set()
      this.handlers.set(event, set)
    }
    set.add(handler)
    return () => this.off(event, handler)
  }

  off<K extends keyof E>(event: K, handler: BusHandler<E[K]>): void {
    this.handlers.get(event)?.delete(handler)
  }

  emit<K extends keyof E>(event: K, payload: E[K]): void {
    this.handlers.get(event)?.forEach((h) => h(payload))
  }

  clear(): void {
    this.handlers.clear()
  }
}
