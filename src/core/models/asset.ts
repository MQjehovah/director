import { z } from 'zod'

export const AssetKindSchema = z.enum(['image', 'video', 'audio', 'lora', 'ref'])

export const AssetSourceSchema = z.enum(['ai', 'upload', 'generated'])

export const AssetSchema = z
  .object({
    id: z.string().min(1),
    kind: AssetKindSchema,
    source: AssetSourceSchema,
    url: z.string().optional(),
    localPath: z.string().optional(),
    thumbUrl: z.string().optional(),
    metadata: z.record(z.unknown()).default({}),
  })
  .superRefine((val, ctx) => {
    if (!val.url && !val.localPath) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['url'],
        message: 'asset must have at least one of url or localPath',
      })
    }
  })

export type Asset = z.infer<typeof AssetSchema>
