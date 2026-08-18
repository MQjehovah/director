import type { PipelinePlugin } from '../../core/plugin/types'
import { portraitStep } from '../../features/composer/presetSteps'

export function createPortraitPipelinePlugin(): PipelinePlugin {
  return {
    id: 'pipeline-portrait',
    name: '生成角色立绘',
    kind: 'pipeline',
    enabled: true,
    version: '0.1.0',
    description: '为所有角色生成立绘参考图。',
    step: { kind: 'portrait', label: '生成角色立绘', order: 40, factory: portraitStep },
  }
}