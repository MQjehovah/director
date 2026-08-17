import { z } from 'zod'

export const ProjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  meta: z.record(z.unknown()).default({}),
  characterIds: z.array(z.string()).default([]),
  scriptId: z.string().optional(),
  storyboardRefs: z.array(z.string()).default([]),
})

export type Project = z.infer<typeof ProjectSchema>
