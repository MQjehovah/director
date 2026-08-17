import type { Job } from '../../core/models'

export interface ImageToVideoParams {
  imageAssetId?: string
  prompt?: string
  shotRef?: string
}

export interface ImageToVideoCapability {
  generateVideo(params: ImageToVideoParams): Promise<Job>
}
