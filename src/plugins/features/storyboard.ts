import type { FeaturePlugin } from '../../core/plugin/types'
import StoryboardPanel from '../../features/storyboard/StoryboardPanel.vue'

export function createStoryboardFeaturePlugin(): FeaturePlugin {
  return {
    id: 'feature-storyboard',
    name: '分镜设计',
    kind: 'feature',
    featureId: 'storyboard',
    enabled: true,
    version: '0.1.0',
    description: '分镜设计模块：镜头网格与生成',
    module: { key: 'storyboard', label: '分镜', title: '分镜设计', order: 3 },
    component: StoryboardPanel,
  }
}
