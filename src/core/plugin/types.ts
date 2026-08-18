import type { Component } from 'vue'
import type { PipelineStep } from '../pipeline/types'

export type PluginKind = 'provider' | 'feature' | 'pipeline'

export type ProviderType = 'media' | 'llm' | 'tts' | 'storage'

export type MediaCapability = 'text2image' | 'text2video' | 'image2video' | 'editImage' | 'upscale'

/** 能力名集合：保持该名称向后兼容（MediaProviderCapabilities 别名引用） */
export type ProviderCapabilities = MediaCapability[]

export type ProviderConfigField =
  | 'baseUrl'
  | 'apiKey'
  | 'model'
  | 'workflow'
  | 'workflowTemplateId'
  | 'videoWorkflowTemplateId'
  | 'img2imgWorkflowTemplateId'
  | 'continuationVideoWorkflowTemplateId'

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
