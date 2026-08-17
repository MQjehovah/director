import type { FeaturePlugin } from '../../core/plugin/types'
import PlayerPanel from '../../features/player/PlayerPanel.vue'

export function createFilmFeaturePlugin(): FeaturePlugin {
  return {
    id: 'feature-film',
    name: '成片合成',
    kind: 'feature',
    featureId: 'film',
    enabled: true,
    version: '0.1.0',
    description: '成片合成模块：成片播放与合成',
    module: { key: 'film', label: '成片', title: '成片合成', order: 4 },
    component: PlayerPanel,
  }
}
