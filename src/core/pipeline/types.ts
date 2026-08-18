export type StepRunStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped'

export interface StepStatusInfo {
  status: StepRunStatus
  error?: string
}

export interface PipelineContext {
  input?: unknown
  results: Record<string, unknown>
  errors: Record<string, string>
  setResult(id: string, value: unknown): void
  fail(id: string, error: string): void
}

export interface PipelineStep<T = unknown> {
  id: string
  title?: string
  enabled?: boolean
  skip?: boolean
  run: (ctx: PipelineContext) => Promise<T | void>
}

export interface RunReport {
  ok: boolean
  results: Record<string, unknown>
  errors: Record<string, string>
  completed: string[]
}