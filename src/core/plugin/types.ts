export type PluginKind = 'provider' | 'feature' | 'pipeline'

export type ProviderType = 'media' | 'llm' | 'tts' | 'storage'

export interface ProviderCapabilities {
  text2image: boolean
  image2video: boolean
  text2video: boolean
  upscale: boolean
}

export type ProviderConfigField = 'baseUrl' | 'apiKey' | 'model'

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
  capabilities?: ProviderCapabilities
  configFields?: ProviderConfigField[]
  instance?: T
}

export interface FeaturePlugin extends PluginBase {
  kind: 'feature'
  featureId: string
}

export interface PipelinePlugin extends PluginBase {
  kind: 'pipeline'
  steps?: string[]
}

export type Plugin = ProviderPlugin | FeaturePlugin | PipelinePlugin

export interface PluginEvents {
  'plugin:registered': Plugin
  'plugin:stateChanged': Plugin
}
