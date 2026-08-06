import '@mdi/font/css/materialdesignicons.css'
import 'vuetify/styles'
import './styles/theme.css'
// Before/After比較スライダー(ResultExplorer.vue)用のWeb Component。
// importするだけで <img-comparison-slider> がグローバルに自己登録される。
import 'img-comparison-slider'

import { createApp } from 'vue'
import App from './App.vue'
import vuetify from './plugins/vuetify'

createApp(App).use(vuetify).mount('#app')
