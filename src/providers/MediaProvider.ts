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
  /** 上一段已生成视频的资产 id：用于参照其结尾继续生成（如 MiniMax H3 Motion Context） */
  prevVideoAssetId?: string
}

export interface TextToVideoParams {
  prompt: string
  shotRef?: string
  /** 镜头时长（秒）：用于 {duration} 占位符注入 */
  duration?: number
  /** 上一段已生成视频的资产 id：用于参照其结尾继续生成（如 MiniMax H3 Motion Context） */
  prevVideoAssetId?: string
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
