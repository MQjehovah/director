export type ModuleKey = 'characters' | 'script' | 'storyboard' | 'film' | 'tasks' | 'pipeline'

export interface ModuleDef {
  key: ModuleKey
  label: string
  title: string
}

export const MODULES: ModuleDef[] = [
  { key: 'characters', label: '角色', title: '角色管理' },
  { key: 'script', label: '剧本', title: '剧本编辑器' },
  { key: 'storyboard', label: '分镜', title: '分镜设计' },
  { key: 'film', label: '成片', title: '成片合成' },
  { key: 'tasks', label: '任务', title: '任务中心' },
  { key: 'pipeline', label: '全流程', title: '全流程' },
]

export function moduleTitle(key: string): string {
  return MODULES.find((m) => m.key === key)?.title ?? key
}
