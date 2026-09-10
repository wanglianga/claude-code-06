import { createPinia } from 'pinia'
import { createApp } from 'vue'
import App from './App.vue'
import './style.css'
import { useShowStore } from './stores/show'

const app = createApp(App)
app.use(createPinia())

const store = useShowStore()
store.restore()
store.startClock()

app.mount('#app')
