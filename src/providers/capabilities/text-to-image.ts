import type { Job } from '../../core/models'

export interface TextToImageParams {
  prompt: string
  negativePrompt?: string
  width?: number
  height?: number
  seed?: number
  shotRef?: string
}

export interface TextToImageCapability {
  generateImage(params: TextToImageParams): Promise<Job>
}
