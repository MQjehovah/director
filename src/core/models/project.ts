import { z } from 'zod'
import { CharacterSchema } from './character'
import { ScriptSchema } from './script'
import { ShotSchema } from './shot'

export const ProjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  meta: z.record(z.unknown()).default({}),
  characterIds: z.array(z.string()).default([]),
  scriptId: z.string().optional(),
  storyboardRefs: z.array(z.string()).default([]),
  // 工作区快照：持久化时内嵌完整领域数据，供刷新后恢复
  characters: z.array(CharacterSchema).default([]),
  script: ScriptSchema.nullable().default(null),
  shots: z.array(ShotSchema).default([]),
})

export type Project = z.infer<typeof ProjectSchema>
