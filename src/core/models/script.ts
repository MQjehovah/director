import { z } from 'zod'

export const BeatTypeSchema = z.enum(['shot', 'dialogue', 'action', 'sfx'])

export const DialogueSchema = z.object({
  speaker: z.string(),
  text: z.string(),
})

export const BeatSchema = z.object({
  id: z.string().min(1),
  type: BeatTypeSchema,
  dialogue: DialogueSchema.optional(),
  action: z.string().optional(),
  shotRef: z.string().optional(),
})

export const SceneArtModeSchema = z.enum(['auto', 'text2image', 'img2img'])
export type SceneArtMode = z.infer<typeof SceneArtModeSchema>

export const SceneSchema = z.object({
  id: z.string().min(1),
  title: z.string().optional(),
  location: z.string().optional(),
  timeOfDay: z.string().optional(),
  beats: z.array(BeatSchema).default([]),
  // 场景图生成方式：auto（有参考图走图生图，否则文生图）/ 强制文生图 / 强制图生图
  artMode: SceneArtModeSchema.optional(),
  // 场景图资产（AI 图生图结果）
  sceneImage: z.string().optional(),
  // 图生图参考图（上传或先前生成的底图）
  referenceImages: z.array(z.string()).default([]),
  metadata: z.record(z.unknown()).default({}),
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
