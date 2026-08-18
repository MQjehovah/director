import type { Job } from '../core/models'
import type { ProviderCapabilities } from '../core/plugin/types'
import type { ImageEditParams } from './capabilities/image-edit'

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
  /** 镜头时长（秒）：用于 {duration} 占位符注入 */
  duration?: number
  /** 尾帧图片资产 id：与首帧（imageAssetId）一起做首尾帧文生视频 */
  lastFrameAssetId?: string
  referenceAssetIds?: string[]
  referenceLabels?: string[]
  referenceVideoIds?: string[]
  characterContext?: string
  templateOverrides?: Record<string, unknown>
}

export interface TextToVideoParams {
  prompt: string
  shotRef?: string
  /** 镜头时长（秒）：用于 {duration} 占位符注入 */
  duration?: number
  /** 尾帧图片资产 id：与首帧一起做首尾帧文生视频 */
  lastFrameAssetId?: string
  templateOverrides?: Record<string, unknown>
}

export interface MediaProvider {
  id: string
  name: string
  capabilities: MediaProviderCapabilities
  generateImage(params: TextToImageParams): Promise<Job>
  generateVideo(params: ImageToVideoParams | TextToVideoParams): Promise<Job>
  editImage(params: ImageEditParams): Promise<Job>
  getJob(id: string): Promise<Job>
  cancelJob(id: string): Promise<Job>
  onJobUpdate(cb: (job: Job) => void): () => void
}
