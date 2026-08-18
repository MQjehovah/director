import type { PipelinePlugin } from '../../core/plugin/types'
import { voiceStep } from '../../features/composer/presetSteps'

export function createVoicePipelinePlugin(): PipelinePlugin {
  return {
    id: 'pipeline-voice',
    name: '配音',
    kind: 'pipeline',
    enabled: true,
    version: '0.1.0',
    description: '为带台词的镜头生成配音任务（需要 TTS Provider）。',
    step: { kind: 'voice', label: '配音', order: 60, factory: voiceStep },
  }
}