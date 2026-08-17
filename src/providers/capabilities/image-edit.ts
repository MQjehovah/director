import type { Job } from '../../core/models'

export interface ImageEditParams {
  imageAssetId: string
  prompt: string
  seed?: number
  shotRef?: string
}

export interface ImageEditCapability {
  editImage(params: ImageEditParams): Promise<Job>
}
