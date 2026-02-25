export default defineNuxtConfig({
  devtools: { enabled: true },
  css: ['~/assets/css/main.css'],
  runtimeConfig: {
    soundcloud: {
      apiBase: 'https://api-v2.soundcloud.com'
    }
  },
  compatibilityDate: '2025-01-01'
})
