import { useJobStore } from '../../stores/jobStore'
import { usePluginStore } from '../../stores/pluginStore'
import { useStoryboardStore } from '../../stores/storyboardStore'
import { capabilityForJobType } from '../../providers/capabilities'
import { persistGeneratedAssets } from '../shared/persistGeneratedAssets'
import type { AssetResolver } from '../shared/persistGeneratedAssets'
import type { Job } from '../../core/models'

type ResumableProvider = AssetResolver & {
  getJob?: (id: string) => Promise<Job>
  resumeJob?: (job: Job) => Promise<Job>
  onJobUpdate?: (cb: (job: Job) => void) => () => void
}

function providerFor(job: Job): ResumableProvider | undefined {
  const pluginStore = usePluginStore()
  const byPlugin = pluginStore.getProviderInstance<ResumableProvider>(job.pluginId)
  if (byPlugin?.getJob || byPlugin?.resumeJob) return byPlugin
  const cap = capabilityForJobType(job.type)
  if (cap) {
    const byCap = pluginStore.resolveInstanceCapability<ResumableProvider>('media', cap)
    if (byCap?.getJob || byCap?.resumeJob) return byCap
  }
  return undefined
}

function applyAssetsToShot(shotRef: string | undefined, assetIds: string[]): void {
  if (!shotRef || assetIds.length === 0) return
  const storyboardStore = useStoryboardStore()
  const shot = storyboardStore.shotById(shotRef)
  if (!shot) return
  const existing = new Set(shot.mediaAssets)
  const fresh = assetIds.filter((id) => !existing.has(id))
  if (fresh.length === 0) return
  storyboardStore.updateShot(shotRef, { mediaAssets: [...shot.mediaAssets, ...fresh] })
}

/**
 * 项目恢复后与媒体 Provider 对账：
 * - 运行中/排队中的任务若支持续跑（ComfyUI 可重新挂轮询），恢复进度并等它完成；
 * - 其余任务尝试 getJob 查询一次最新状态；
 * - 完成的任务补持久化资产并挂到对应镜头。
 */
export async function reconcileJobs(): Promise<void> {
  const jobStore = useJobStore()
  for (const job of [...jobStore.jobs]) {
    const provider = providerFor(job)
    if (!provider) continue

    if (
      provider.resumeJob &&
      (job.status === 'queued' || job.status === 'running')
    ) {
      const off =
        provider.onJobUpdate?.((updated) => {
          if (updated.id !== job.id) return
          jobStore.updateJob(updated)
          if (updated.status === 'done') {
            const assetIds = updated.result?.assetIds ?? []
            void persistGeneratedAssets(assetIds, provider).then(() => {
              applyAssetsToShot(job.shotRef, assetIds)
            })
            off?.()
          } else if (updated.status === 'failed' || updated.status === 'canceled') {
            off?.()
          }
        }) ?? (() => {})
      try {
        await provider.resumeJob(job)
        continue
      } catch {
        off?.()
      }
    }

    if (!provider.getJob) continue
    try {
      const latest = await provider.getJob(job.id)
      jobStore.updateJob(latest)
      if (latest.status === 'done') {
        const assetIds = latest.result?.assetIds ?? []
        await persistGeneratedAssets(assetIds, provider)
        applyAssetsToShot(job.shotRef, assetIds)
      }
    } catch {
      // 提供方内存态已丢失且不支持续跑：保留恢复后的状态，用户可在任务队列中处理
    }
  }
}
