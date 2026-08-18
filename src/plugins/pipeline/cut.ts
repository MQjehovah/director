import type { PipelinePlugin } from '../../core/plugin/types'
import { cutStep } from '../../features/composer/presetSteps'

export function createCutPipelinePlugin(): PipelinePlugin {
  return {
    id: 'pipeline-cut',
    name: '切分镜头',
    kind: 'pipeline',
    enabled: true,
    version: '0.1.0',
    description: '把剧本场景按节拍一键切分为分镜镜头。',
    step: { kind: 'cut', label: '切分镜头', order: 20, factory: cutStep },
  }
}