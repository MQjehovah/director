import type { PipelinePlugin } from '../../core/plugin/types'
import { renderStep } from '../../features/composer/presetSteps'

export function createRenderPipelinePlugin(): PipelinePlugin {
  return {
    id: 'pipeline-render',
    name: '生成画面',
    kind: 'pipeline',
    enabled: true,
    version: '0.1.0',
    description: '为尚未生成媒体的镜头提交出图 / 出视频任务。',
    step: { kind: 'render', label: '生成画面', order: 50, factory: renderStep },
  }
}