import type { FeaturePlugin } from '../../core/plugin/types'
import ComposerPanel from '../../features/composer/ComposerPanel.vue'

export function createPipelineFeaturePlugin(): FeaturePlugin {
  return {
    id: 'feature-pipeline',
    name: '画布',
    kind: 'feature',
    featureId: 'pipeline',
    enabled: true,
    version: '0.1.0',
    description: '画布模块：节点化编排一键创作流水线',
    module: { key: 'pipeline', label: '画布', title: '画布', order: 6 },
    component: ComposerPanel,
  }
}
