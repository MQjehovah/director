import type { Component } from 'vue'
import type { PluginRegistry } from '../../core/plugin/registry'
import type { FeatureModuleDef } from '../../core/plugin/types'

export {
  collectModules,
  resolveFeatureComponent,
  resolveFeatureViewProps,
} from '../../core/plugin/features'

/** 内置模块键（历史兼容：模块已动态化，AppShell 使用 string 键） */
export type ModuleKey =
  | 'characters'
  | 'script'
  | 'storyboard'
  | 'film'
  | 'tasks'
  | 'pipeline'
  | 'settings'
  | 'agent'

export type { FeatureModuleDef }
export type { Component }
export type { PluginRegistry }
