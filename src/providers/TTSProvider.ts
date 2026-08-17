import type { Job } from '../core/models'

export interface VoiceOption {
  id: string
  name: string
  gender?: string
}

export interface TTSProvider {
  id: string
  name: string
  voices: VoiceOption[]
  synthesize(text: string, voiceId?: string): Promise<Job>
}
