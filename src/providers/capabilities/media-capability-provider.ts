import type { Job } from '../../core/models'
import type { ImageToVideoCapability } from './image-to-video'
import type { TextToImageCapability } from './text-to-image'
import type { TextToVideoCapability } from './text-to-video'

/**
 * 按能力解析出的媒体 Provider 形态：
 * 由各能力接口组合生成方法（依所解析能力具备），加上通用任务生命周期方法。
 * 与旧 MediaProvider 结构兼容（不含 id/name/capabilities 元数据）。
 */
export type MediaCapabilityProvider = TextToImageCapability &
  ImageToVideoCapability &
  TextToVideoCapability & {
    getJob(id: string): Promise<Job>
    onJobUpdate(cb: (job: Job) => void): () => void
    cancelJob(id: string): Promise<Job>
  }
