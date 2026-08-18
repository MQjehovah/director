import { reactive } from 'vue'

export type AssetPreviewKind = 'image' | 'video'

export interface AssetPreviewState {
  open: boolean
  url: string | undefined
  kind: AssetPreviewKind
  title: string | undefined
}

const state = reactive<AssetPreviewState>({
  open: false,
  url: undefined,
  kind: 'image',
  title: undefined,
})

/** 全局素材放大预览状态：任意组件调用 openPreview 打开，浮层由 AppShell 挂载 */
export function useAssetPreview() {
  function openPreview(
    url: string,
    kind: AssetPreviewKind = 'image',
    title?: string,
  ): void {
    state.url = url
    state.kind = kind
    state.title = title
    state.open = true
  }

  function closePreview(): void {
    state.open = false
  }

  return { previewState: state, openPreview, closePreview }
}
