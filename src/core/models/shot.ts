import { z } from 'zod'

export const ShotTypeSchema = z.enum(['image', 'video'])

export const ShotSizeSchema = z.enum(['close-up', 'medium', 'wide'])

export const AngleSchema = z.enum(['eye-level', 'high', 'low', 'dutch'])

export const MoveSchema = z.enum(['static', 'pan', 'tilt', 'zoom-in', 'zoom-out', 'tracking'])

export const CameraSchema = z.object({
  shotSize: ShotSizeSchema,
  angle: AngleSchema,
  move: MoveSchema,
  duration: z.number().positive(),
})

export const ShotSchema = z.object({
  id: z.string().min(1),
  beatRef: z.string().optional(),
  shotType: ShotTypeSchema,
  camera: CameraSchema.optional(),
  prompt: z.string().optional(),
  negativePrompt: z.string().optional(),
  seed: z.number().optional(),
  mediaAssets: z.array(z.string()).default([]),
  renderJobRef: z.string().optional(),
  metadata: z.record(z.unknown()).default({}),
})

export type Shot = z.infer<typeof ShotSchema>
