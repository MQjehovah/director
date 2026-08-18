import { z } from 'zod'

/** 镜头默认时长（秒） */
export const DEFAULT_SHOT_DURATION = 5
/** 镜头时长上限（秒）：视频生成/成片进度的统一上限 */
export const MAX_SHOT_DURATION = 10

export const ShotTypeSchema = z.enum(['image', 'video'])

export const ShotSizeSchema = z.enum(['close-up', 'medium', 'wide'])

export const AngleSchema = z.enum(['eye-level', 'high', 'low', 'dutch'])

export const MoveSchema = z.enum(['static', 'pan', 'tilt', 'zoom-in', 'zoom-out', 'tracking'])

/** 视频镜头的生成方式：文生视频 / 参考生视频 / 首尾帧生视频；不设置时按可用参考图自动推断 */
export const VideoModeSchema = z.enum(['text2video', 'image2video', 'firstLastFrameVideo'])

export const CameraSchema = z.object({
  shotSize: ShotSizeSchema,
  angle: AngleSchema,
  move: MoveSchema,
  duration: z.number().positive(),
})

export const ShotSchema = z.object({
  id: z.string().min(1),
  sceneId: z.string().optional(),
  beatRef: z.string().optional(),
  shotType: ShotTypeSchema,
  videoMode: VideoModeSchema.optional(),
  camera: CameraSchema.optional(),
  prompt: z.string().optional(),
  negativePrompt: z.string().optional(),
  seed: z.number().optional(),
  mediaAssets: z.array(z.string()).default([]),
  renderJobRef: z.string().optional(),
  metadata: z.record(z.unknown()).default({}),
})

export type Shot = z.infer<typeof ShotSchema>
