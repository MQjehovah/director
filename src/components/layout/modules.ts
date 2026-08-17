import type { Component } from 'vue'
import type { PluginRegistry } from '../../core/plugin/registry'
import type { FeatureModuleDef, FeaturePlugin } from '../../core/plugin/types'

/** 内置模块键（历史兼容：模块已动态化，AppShell 使用 string 键） */
export type ModuleKey =
  | 'characters'
  | 'script'
  | 'storyboard'
  | 'film'
  | 'tasks'
  | 'pipeline'
  | 'settings'

export function collectModules(registry: PluginRegistry): FeatureModuleDef[] {
  return registry
    .list()
    .filter((p): p is FeaturePlugin => p.kind === 'feature' && p.module !== undefined)
    .map((p) => p.module as FeatureModuleDef)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
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
