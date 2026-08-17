import type { FeaturePlugin } from '../../core/plugin/types'
import SettingsPanel from '../../features/settings/SettingsPanel.vue'

export function createSettingsFeaturePlugin(): FeaturePlugin {
  return {
    id: 'feature-settings',
    name: '设置',
    kind: 'feature',
    featureId: 'settings',
    enabled: true,
    version: '0.1.0',
    description: '设置模块：Provider 配置与能力展示',
    module: { key: 'settings', label: '设置', title: '设置', order: 7 },
    component: SettingsPanel,
  }
}
