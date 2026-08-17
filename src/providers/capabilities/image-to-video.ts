import type { Job } from '../../core/models'

export interface ImageToVideoParams {
  imageAssetId?: string
  prompt?: string
  shotRef?: string
  /** 镜头时长（秒）：用于 {duration} 占位符注入 */
  duration?: number
  /** 上一段已生成视频的资产 id：用于参照其结尾继续生成（如 MiniMax H3 Motion Context） */
  prevVideoAssetId?: string
}

export interface ImageToVideoCapability {
  generateVideo(params: ImageToVideoParams): Promise<Job>
}
