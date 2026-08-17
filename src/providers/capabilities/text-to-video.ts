import type { Job } from '../../core/models'

export interface TextToVideoParams {
  prompt: string
  shotRef?: string
}

export interface TextToVideoCapability {
  generateVideo(params: TextToVideoParams): Promise<Job>
}
