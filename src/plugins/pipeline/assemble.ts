import type { PipelinePlugin } from '../../core/plugin/types'
import { assembleStep } from '../../features/composer/presetSteps'

export function createAssemblePipelinePlugin(): PipelinePlugin {
  return {
    id: 'pipeline-assemble',
    name: '组装成片',
    kind: 'pipeline',
    enabled: true,
    version: '0.1.0',
    description: '汇总剧本、镜头与任务结果，供成片预览使用。',
    step: { kind: 'assemble', label: '组装成片', order: 70, factory: assembleStep },
  }
}