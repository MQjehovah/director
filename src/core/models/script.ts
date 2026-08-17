import { z } from 'zod'

export const BeatTypeSchema = z.enum(['shot', 'dialogue', 'action', 'sfx'])

export const DialogueSchema = z.object({
  speaker: z.string().min(1),
  text: z.string(),
})

export const BeatSchema = z.object({
  id: z.string().min(1),
  type: BeatTypeSchema,
  dialogue: DialogueSchema.optional(),
  action: z.string().optional(),
  shotRef: z.string().optional(),
})

export const SceneSchema = z.object({
  id: z.string().min(1),
  title: z.string().optional(),
  location: z.string().optional(),
  timeOfDay: z.string().optional(),
  beats: z.array(BeatSchema).default([]),
})

export const ScriptSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  synopsis: z.string().optional(),
  globalContext: z.string().optional(),
  scenes: z.array(SceneSchema).default([]),
})

export type Beat = z.infer<typeof BeatSchema>
export type Scene = z.infer<typeof SceneSchema>
export type Script = z.infer<typeof ScriptSchema>
