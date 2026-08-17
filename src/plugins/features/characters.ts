import type { FeaturePlugin } from '../../core/plugin/types'
import CharacterPanel from '../../features/characters/CharacterPanel.vue'

export function createCharactersFeaturePlugin(): FeaturePlugin {
  return {
    id: 'feature-characters',
    name: '角色管理',
    kind: 'feature',
    featureId: 'characters',
    enabled: true,
    version: '0.1.0',
    description: '角色管理模块：角色列表与编辑',
    module: { key: 'characters', label: '角色', title: '角色管理', order: 1 },
    component: CharacterPanel,
  }
}
