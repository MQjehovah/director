import type { PluginRegistry } from './registry'
import type { PipelineStepDef } from './types'

/**
 * 收集已启用 PipelinePlugin 的步骤定义，未声明 order 的排到最后，
 * 便于新插件注册后自动出现在画布「添加节点」面板且不挤占内置步骤。
 */
export function collectPipelineStepDefs(registry: PluginRegistry): PipelineStepDef[] {
  return registry
    .resolveEnabledPipelinePlugins()
    .map((p) => p.step)
    .sort(
      (a, b) =>
        (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER),
    )
}

export function pipelineStepDefByKind(
  registry: PluginRegistry,
  kind: string,
): PipelineStepDef | undefined {
  return collectPipelineStepDefs(registry).find((d) => d.kind === kind)
}