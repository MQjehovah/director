import type { Job } from '../../core/models'

export interface UpscaleParams {
  imageAssetId: string
  scale?: number
}

export interface UpscaleCapability {
  upscale(params: UpscaleParams): Promise<Job>
}
