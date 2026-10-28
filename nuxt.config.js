// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: ['@nuxt/eslint', '@nuxt/ui'],

  devtools: { enabled: true },

  app: {
    head: {
      htmlAttrs: { lang: 'es' },
      title: 'Panet Admin',
      // Aplicación privada: evitar que los buscadores la indexen.
      meta: [{ name: 'robots', content: 'noindex, nofollow' }],
    },
  },

  css: ['~/assets/css/main.css'],

  compatibilityDate: '2026-10-28',

  eslint: {
    config: {
      // Reglas de estilo de ESLint (sustituyen a un formateador aparte).
      stylistic: true,
    },
  },
})
