import type { Job } from '../core/models'
import type { ProviderCapabilities } from '../core/plugin/types'

export type MediaProviderCapabilities = ProviderCapabilities

export interface TextToImageParams {
  prompt: string
  negativePrompt?: string
  width?: number
  height?: number
  seed?: number
  shotRef?: string
}

export interface ImageToVideoParams {
  imageAssetId?: string
  prompt?: string
  shotRef?: string
}

export interface TextToVideoParams {
  prompt: string
  shotRef?: string
}

export interface MediaProvider {
  id: string
  name: string
  capabilities: MediaProviderCapabilities
  generateImage(params: TextToImageParams): Promise<Job>
  generateVideo(params: ImageToVideoParams | TextToVideoParams): Promise<Job>
  getJob(id: string): Promise<Job>
  cancelJob(id: string): Promise<Job>
  onJobUpdate(cb: (job: Job) => void): () => void
}
