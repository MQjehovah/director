import type { PipelinePlugin } from '../../core/plugin/types'
import { sceneArtStep } from '../../features/composer/presetSteps'

export function createSceneArtPipelinePlugin(): PipelinePlugin {
  return {
    id: 'pipeline-scene-art',
    name: '生成场景图',
    kind: 'pipeline',
    enabled: true,
    version: '0.1.0',
    description: '为尚未配图的剧本场景生成场景图。',
    step: { kind: 'scene-art', label: '生成场景图', order: 30, factory: sceneArtStep },
  }
}