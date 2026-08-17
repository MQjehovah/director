import type { FeaturePlugin } from '../../core/plugin/types'
import ScriptPanel from '../../features/script/ScriptPanel.vue'

export function createScriptFeaturePlugin(): FeaturePlugin {
  return {
    id: 'feature-script',
    name: '剧本编辑器',
    kind: 'feature',
    featureId: 'script',
    enabled: true,
    version: '0.1.0',
    description: '剧本编辑器模块：剧本大纲与 AI 生成',
    module: { key: 'script', label: '剧本', title: '剧本编辑器', order: 2 },
    component: ScriptPanel,
  }
}
