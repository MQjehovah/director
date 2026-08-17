import type { Job } from '../../core/models'

export type JobStatusVariant = 'neutral' | 'success' | 'warning' | 'danger'

export const JOB_TYPE_LABELS: Record<string, string> = {
  text2image: '文生图',
  image2video: '图生视频',
  videoContinue: '视频续写',
  text2video: '文生视频',
  editImage: '图生图',
  upscale: '超分',
  tts: '配音',
  llm: 'AI 文本',
}

export const JOB_STATUS_META: Record<Job['status'], { label: string; variant: JobStatusVariant }> = {
  queued: { label: '排队中', variant: 'neutral' },
  running: { label: '生成中', variant: 'warning' },
  done: { label: '已完成', variant: 'success' },
  failed: { label: '失败', variant: 'danger' },
  canceled: { label: '已取消', variant: 'neutral' },
}

export function jobTypeLabel(type: string): string {
  return JOB_TYPE_LABELS[type] ?? type
}

export function jobStatusInfo(status: Job['status']): { label: string; variant: JobStatusVariant } {
  return JOB_STATUS_META[status]
}
