import { afterEach, describe, it, expect } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { useAssetPreview } from '../assetPreview'
import AssetPreviewOverlay from '../AssetPreviewOverlay.vue'

let wrapper: VueWrapper | undefined

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  useAssetPreview().closePreview()
})

function overlayEl(selector: string): HTMLElement | null {
  return document.body.querySelector(selector)
}

describe('useAssetPreview', () => {
  afterEach(() => {
    useAssetPreview().closePreview()
  })

  it('opens and closes the shared preview state', () => {
    const { previewState, openPreview, closePreview } = useAssetPreview()
    expect(previewState.open).toBe(false)

    openPreview('data:image/png;base64,abc', 'image', '角色')
    expect(previewState.open).toBe(true)
    expect(previewState.url).toBe('data:image/png;base64,abc')
    expect(previewState.kind).toBe('image')
    expect(previewState.title).toBe('角色')

    closePreview()
    expect(previewState.open).toBe(false)
  })
})

describe('AssetPreviewOverlay', () => {
  it('renders an enlarged image and closes via the close button', async () => {
    const { openPreview } = useAssetPreview()
    wrapper = mount(AssetPreviewOverlay)
    expect(overlayEl('[data-test="asset-preview-overlay"]')).toBeNull()

    openPreview('data:image/png;base64,abc', 'image', '参考图')
    await new Promise((resolve) => setTimeout(resolve))

    expect(overlayEl('[data-test="asset-preview-overlay"]')).not.toBeNull()
    expect(overlayEl('[data-test="asset-preview-title"]')?.textContent).toBe('参考图')
    expect(overlayEl('[data-test="asset-preview-image"]')?.getAttribute('src')).toBe(
      'data:image/png;base64,abc',
    )

    ;(overlayEl('[data-test="asset-preview-close"]') as HTMLButtonElement).click()
    await new Promise((resolve) => setTimeout(resolve))
    expect(overlayEl('[data-test="asset-preview-overlay"]')).toBeNull()
  })

  it('renders a video preview when the asset kind is video', async () => {
    const { openPreview } = useAssetPreview()
    wrapper = mount(AssetPreviewOverlay)

    openPreview('http://192.168.31.34:8188/view?filename=a.mp4&subfolder=video', 'video')
    await new Promise((resolve) => setTimeout(resolve))

    expect(overlayEl('[data-test="asset-preview-video"]')).not.toBeNull()
    expect(overlayEl('[data-test="asset-preview-video"]')?.getAttribute('src')).toBe(
      'http://192.168.31.34:8188/view?filename=a.mp4&subfolder=video',
    )
  })

  it('closes when clicking the backdrop', async () => {
    const { openPreview } = useAssetPreview()
    wrapper = mount(AssetPreviewOverlay)

    openPreview('blob:preview/1')
    await new Promise((resolve) => setTimeout(resolve))
    expect(overlayEl('[data-test="asset-preview-overlay"]')).not.toBeNull()

    ;(overlayEl('[data-test="asset-preview-overlay"]') as HTMLElement).click()
    await new Promise((resolve) => setTimeout(resolve))
    expect(overlayEl('[data-test="asset-preview-overlay"]')).toBeNull()
  })

  it('zooms in/out with the control buttons and resets the view', async () => {
    const { openPreview } = useAssetPreview()
    wrapper = mount(AssetPreviewOverlay)
    openPreview('blob:preview/1')
    await new Promise((resolve) => setTimeout(resolve))

    expect(overlayEl('[data-test="asset-preview-zoom-label"]')?.textContent).toBe('100%')
    const image = overlayEl('[data-test="asset-preview-image"]')
    expect(image?.getAttribute('style')).toContain('scale(1)')

    ;(overlayEl('[data-test="asset-preview-zoom-in"]') as HTMLButtonElement).click()
    await new Promise((resolve) => setTimeout(resolve))
    expect(overlayEl('[data-test="asset-preview-zoom-label"]')?.textContent).toBe('125%')
    expect(overlayEl('[data-test="asset-preview-image"]')?.getAttribute('style')).toContain(
      'scale(1.25)',
    )

    ;(overlayEl('[data-test="asset-preview-zoom-out"]') as HTMLButtonElement).click()
    await new Promise((resolve) => setTimeout(resolve))
    expect(overlayEl('[data-test="asset-preview-zoom-label"]')?.textContent).toBe('100%')

    ;(overlayEl('[data-test="asset-preview-zoom-in"]') as HTMLButtonElement).click()
    await new Promise((resolve) => setTimeout(resolve))
    ;(overlayEl('[data-test="asset-preview-reset"]') as HTMLButtonElement).click()
    await new Promise((resolve) => setTimeout(resolve))
    expect(overlayEl('[data-test="asset-preview-zoom-label"]')?.textContent).toBe('100%')
    expect(overlayEl('[data-test="asset-preview-image"]')?.getAttribute('style')).toContain(
      'scale(1)',
    )
  })

  it('zooms with the mouse wheel anchored at the cursor', async () => {
    const { openPreview } = useAssetPreview()
    wrapper = mount(AssetPreviewOverlay)
    openPreview('blob:preview/1')
    await new Promise((resolve) => setTimeout(resolve))

    const stage = overlayEl('[data-test="asset-preview-stage"]')
    stage?.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, clientX: 80, clientY: 60 }))
    await new Promise((resolve) => setTimeout(resolve))
    expect(overlayEl('[data-test="asset-preview-zoom-label"]')?.textContent).toBe('112%')
  })
})
