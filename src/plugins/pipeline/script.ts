import type { PipelinePlugin } from '../../core/plugin/types'
import { scriptStep } from '../../features/composer/presetSteps'

export function createScriptPipelinePlugin(): PipelinePlugin {
  return {
    id: 'pipeline-script',
    name: '生成剧本',
    kind: 'pipeline',
    enabled: true,
    version: '0.1.0',
    description: '根据故事梗概调用 LLM 生成剧本（场景 + 节拍）。',
    step: { kind: 'script', label: '生成剧本', order: 10, factory: scriptStep },
  }
}