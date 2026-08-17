import type { FeaturePlugin } from '../../core/plugin/types'
import ComposerPanel from '../../features/composer/ComposerPanel.vue'

export function createPipelineFeaturePlugin(): FeaturePlugin {
  return {
    id: 'feature-pipeline',
    name: '全流程',
    kind: 'feature',
    featureId: 'pipeline',
    enabled: true,
    version: '0.1.0',
    description: '全流程模块：一键创作流水线',
    module: { key: 'pipeline', label: '全流程', title: '全流程', order: 6 },
    component: ComposerPanel,
  }
}
