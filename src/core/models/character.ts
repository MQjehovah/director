import { z } from 'zod'

export const ReferenceImageSchema = z.string()

export const CharacterSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  appearance: z.string().optional(),
  referenceImages: z.array(ReferenceImageSchema).default([]),
  voice: z.string().optional(),
  loraConfig: z.record(z.unknown()).optional(),
  tags: z.array(z.string()).default([]),
  metadata: z.record(z.unknown()).default({}),
})

export type Character = z.infer<typeof CharacterSchema>
