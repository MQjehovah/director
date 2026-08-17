import type { Component } from 'vue'
import type { PluginRegistry } from './registry'
import type { FeatureModuleDef, FeaturePlugin } from './types'

export function collectModules(registry: PluginRegistry): FeatureModuleDef[] {
  return registry
    .list()
    .filter((p): p is FeaturePlugin => p.kind === 'feature' && p.module !== undefined)
    .map((p) => p.module as FeatureModuleDef)
    // 未声明 order 的插件排到最后，避免新插件意外排到内置模块前面
    .sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER))
}

export function resolveFeatureComponent(
  registry: PluginRegistry,
  key: string,
): Component | undefined {
  const p = registry
    .list()
    .find((p): p is FeaturePlugin => p.kind === 'feature' && p.module?.key === key)
  return p?.component
}

export function resolveFeatureViewProps(
  registry: PluginRegistry,
  key: string,
): Record<string, unknown> | undefined {
  const p = registry
    .list()
    .find((p): p is FeaturePlugin => p.kind === 'feature' && p.module?.key === key)
  return p?.viewProps
}
