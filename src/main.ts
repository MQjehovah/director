import { createApp } from 'vue'
import { createPinia } from 'pinia'
import './assets/main.css'
import App from './App.vue'
import { usePluginStore } from './stores/pluginStore'
import { buildAppPlugins, applySavedProviderConfig } from './plugins/register'

const app = createApp(App)
const pinia = createPinia()
app.use(pinia)
const pluginStore = usePluginStore(pinia)
const registry = buildAppPlugins()
pluginStore.init(registry)
applySavedProviderConfig(pluginStore)
app.mount('#app')
