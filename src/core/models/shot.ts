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

/** 镜头渲染方式：文生视频 / 参考生视频（多参考）；不设置时按可用参考自动推断 */
export const ShotRenderModeSchema = z.enum(['text2video', 'ref2v'])

/** 渲染绑定：镜头把自身数据（参考图/视频/标量参数）按工作流参数键 `${nodeId}:${input}` 填入 */
export const ShotRenderSchema = z.object({
  mode: ShotRenderModeSchema,
  params: z.record(z.unknown()).default({}),
})

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
  /** 渲染区块的绑定：模式与工作流参数覆盖；未设置时沿用自动推断 */
  render: ShotRenderSchema.optional(),
  metadata: z.record(z.unknown()).default({}),
})

export type Shot = z.infer<typeof ShotSchema>
