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
  beatRef: z.string().min(1),
  shotType: ShotTypeSchema,
  camera: CameraSchema,
  prompt: z.string().optional(),
  negativePrompt: z.string().optional(),
  seed: z.number().optional(),
  mediaAssets: z.array(z.string()).default([]),
  renderJobRef: z.string().optional(),
})

export type Shot = z.infer<typeof ShotSchema>
