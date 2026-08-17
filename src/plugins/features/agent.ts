import type { FeaturePlugin } from '../../core/plugin/types'
import AgentPanel from '../../features/agent/agentPanel/AgentPanel.vue'

export function createAgentFeaturePlugin(): FeaturePlugin {
  return {
    id: 'feature-agent',
    name: 'AI 助手',
    kind: 'feature',
    featureId: 'agent',
    enabled: true,
    version: '0.1.0',
    description: 'AI 助手模块：对话式指挥 agent 完成创作任务',
    module: { key: 'agent', label: 'AI助手', title: 'AI 助手', order: 8 },
    component: AgentPanel,
  }
}
