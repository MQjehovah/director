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

export interface PipelineRunnerOptions {
  input?: unknown
  onStepStart?: (stepId: string, index: number) => void
  onStepDone?: (stepId: string, status: StepRunStatus, error?: string) => void
}

/**
 * 顺序执行管道步骤。
 * - 跳过 `enabled === false` 或 `skip === true` 的步骤。
 * - 步骤成功时将返回值写入 `ctx.results`；失败时记录到 `ctx.errors` 并继续执行后续步骤，
 *   避免某个 Provider 缺失拖垮整个流程。
 */
export class PipelineRunner {
  private readonly options: PipelineRunnerOptions

  constructor(options: PipelineRunnerOptions = {}) {
    this.options = options
  }

  async run(steps: PipelineStep[]): Promise<RunReport> {
    const ctx: PipelineContext = {
      input: this.options.input,
      results: {},
      errors: {},
      setResult(id, value) {
        ctx.results[id] = value
      },
      fail(id, error) {
        ctx.errors[id] = error
      },
    }
    const completed: string[] = []

    for (let i = 0; i < steps.length; i += 1) {
      const step = steps[i]
      if (step.enabled === false || step.skip === true) {
        this.options.onStepDone?.(step.id, 'skipped')
        continue
      }
      this.options.onStepStart?.(step.id, i)
      try {
        const value = await step.run(ctx)
        if (ctx.errors[step.id] !== undefined) {
          this.options.onStepDone?.(step.id, 'failed', ctx.errors[step.id])
          continue
        }
        if (value !== undefined) ctx.results[step.id] = value
        completed.push(step.id)
        this.options.onStepDone?.(step.id, 'done')
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        ctx.errors[step.id] = message
        this.options.onStepDone?.(step.id, 'failed', message)
      }
    }

    return {
      ok: Object.keys(ctx.errors).length === 0,
      results: ctx.results,
      errors: ctx.errors,
      completed,
    }
  }
}
