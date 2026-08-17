import type { Job } from '../../core/models'
import type { ImageToVideoParams } from './image-to-video'
import type { TextToImageParams } from './text-to-image'
import type { TextToVideoParams } from './text-to-video'

/**
 * 按能力解析出的媒体 Provider 形态：
 * 生成方法（依所解析能力具备）+ 通用任务生命周期方法（getJob/onJobUpdate/cancelJob）。
 * 与旧 MediaProvider 结构兼容（不含 id/name/capabilities 元数据）。
 */
export interface MediaCapabilityProvider {
  generateImage(params: TextToImageParams): Promise<Job>
  generateVideo(params: ImageToVideoParams | TextToVideoParams): Promise<Job>
  getJob(id: string): Promise<Job>
  onJobUpdate(cb: (job: Job) => void): () => void
  cancelJob(id: string): Promise<Job>
}
