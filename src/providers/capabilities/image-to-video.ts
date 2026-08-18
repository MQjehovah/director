import type { Job } from '../../core/models'

export interface ImageToVideoParams {
  imageAssetId?: string
  prompt?: string
  shotRef?: string
  /** 镜头时长（秒）：用于 {duration} 占位符注入 */
  duration?: number
  /** 尾帧图片资产 id：与首帧（imageAssetId）一起做首尾帧文生视频 */
  lastFrameAssetId?: string
}

export interface ImageToVideoCapability {
  generateVideo(params: ImageToVideoParams): Promise<Job>
}
