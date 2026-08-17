import { z } from 'zod'

export const JobStatusSchema = z.enum(['queued', 'running', 'done', 'failed', 'canceled'])

export const JobResultSchema = z.object({
  assetIds: z.array(z.string()).optional(),
  url: z.string().optional(),
  data: z.record(z.unknown()).optional(),
})

export const JobSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  status: JobStatusSchema.default('queued'),
  progress: z.number().min(0).max(100).default(0),
  pluginId: z.string().optional(),
  shotRef: z.string().optional(),
  params: z.record(z.unknown()).default({}),
  result: JobResultSchema.optional(),
  createdAt: z.string().default(() => new Date().toISOString()),
})

export type Job = z.infer<typeof JobSchema>
export type JobResult = z.infer<typeof JobResultSchema>
