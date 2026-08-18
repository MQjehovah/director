import type { Component } from 'vue'
import type { PipelineStep } from '../pipeline/types'

export type PluginKind = 'provider' | 'feature' | 'pipeline'

export type ProviderType = 'media' | 'llm' | 'tts' | 'storage'

export type MediaCapability =
  | 'text2image'
  | 'editImage'
  | 'text2video'
  | 'image2video'
  | 'firstLastFrameVideo'
  | 'upscale'

/** 媒体能力的中文名：文生图 / 参考生图 / 文生视频 / 首尾帧生视频 / 参考生视频 */
export const MEDIA_CAPABILITY_LABELS: Record<MediaCapability, string> = {
  text2image: '文生图',
  editImage: '参考生图',
  text2video: '文生视频',
  image2video: '参考生视频',
  firstLastFrameVideo: '首尾帧生视频',
  upscale: '超分',
}

/** 能力名集合：保持该名称向后兼容（MediaProviderCapabilities 别名引用） */
export type ProviderCapabilities = MediaCapability[]

export type ProviderConfigField =
  | 'baseUrl'
  | 'apiKey'
  | 'model'
  | 'workflow'
  | 'workflowTemplateId'
  | 'videoWorkflowTemplateId'
  | 'textVideoWorkflowTemplateId'
  | 'imageVideoWorkflowTemplateId'
  | 'firstLastFrameWorkflowTemplateId'
  | 'img2imgWorkflowTemplateId'

export interface PluginBase {
  id: string
  name: string
  kind: PluginKind
  enabled: boolean
  version?: string
  description?: string
}

export interface ProviderPlugin<T = unknown> extends PluginBase {
  kind: 'provider'
  providerType: ProviderType
  capabilities?: MediaCapability[]
  configFields?: ProviderConfigField[]
  instance?: T
}

export interface FeatureModuleDef {
  key: string
  label: string
  title: string
  order?: number
}

export interface FeaturePlugin extends PluginBase {
  kind: 'feature'
  featureId: string
  module?: FeatureModuleDef
  component: Component
  viewProps?: Record<string, unknown>
}

export interface PipelineStepDef {
  kind: string
  label: string
  order?: number
  factory: () => PipelineStep
}

export interface PipelinePlugin extends PluginBase {
  kind: 'pipeline'
  step: PipelineStepDef
}

export type Plugin = ProviderPlugin | FeaturePlugin | PipelinePlugin

export interface PluginEvents {
  'plugin:registered': Plugin
  'plugin:stateChanged': Plugin
}
