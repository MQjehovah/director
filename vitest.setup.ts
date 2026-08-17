import { vi } from 'vitest'

// Vue Flow 等画布组件依赖 ResizeObserver / matchMedia，jsdom 缺失，这里补齐
class ResizeObserverMock {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  ;(globalThis as Record<string, unknown>).ResizeObserver = ResizeObserverMock
}

if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList
}

// jsdom 不计算布局（getBoundingClientRect 恒为 0），Vue Flow 要求容器有宽高才渲染。
// 给画布相关元素返回一个默认尺寸，仅测试环境生效。
const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect
Element.prototype.getBoundingClientRect = function (this: Element) {
  const rect = originalGetBoundingClientRect.call(this)
  if (rect.width === 0 && rect.height === 0) {
    const isFlowCanvas =
      this.classList?.contains('vue-flow') || this.closest?.('.vue-flow') != null
    if (isFlowCanvas) {
      return { ...rect, width: 1200, height: 720 } as DOMRect
    }
  }
  return rect
}

// Vue Flow 用 offsetWidth/offsetHeight 量画布尺寸，jsdom 恒为 0；画布内元素返回默认尺寸
Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
  configurable: true,
  get(this: HTMLElement) {
    return this.classList?.contains('vue-flow') || this.closest?.('.vue-flow')
      ? 1000
      : 0
  },
})
Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
  configurable: true,
  get(this: HTMLElement) {
    return this.classList?.contains('vue-flow') || this.closest?.('.vue-flow')
      ? 700
      : 0
  },
})

export { vi }
