import type { MediaCapability } from '../../core/plugin/types'

/**
 * 任务类型 → 能力：用于在缺少 job.pluginId 时按任务类型解析应具备该能力的 Provider。
 * 覆盖全部任务类型，避免 editImage/upscale 等类型落入无能力 Provider。
 */
export function capabilityForJobType(type: string | undefined): MediaCapability | undefined {
  switch (type) {
    case 'text2image':
      return 'text2image'
    case 'image2video':
      return 'image2video'
    case 'text2video':
      return 'text2video'
    case 'upscale':
      return 'upscale'
    case 'editImage':
      return 'editImage'
    default:
      return undefined
  }
}
