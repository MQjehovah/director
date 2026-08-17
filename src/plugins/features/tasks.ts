import type { FeaturePlugin } from '../../core/plugin/types'
import JobDrawer from '../../features/jobs/JobDrawer.vue'

export function createTasksFeaturePlugin(): FeaturePlugin {
  return {
    id: 'feature-tasks',
    name: '任务中心',
    kind: 'feature',
    featureId: 'tasks',
    enabled: true,
    version: '0.1.0',
    description: '任务中心模块：任务队列与进度',
    module: { key: 'tasks', label: '任务', title: '任务中心', order: 5 },
    component: JobDrawer,
    viewProps: { open: true, inline: true },
  }
}
