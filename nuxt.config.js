// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: ['@nuxt/eslint', '@nuxt/ui', '@nuxtjs/supabase'],

  $development: {
    supabase: {
      // En local se sirve por http (también al probar desde el móvil en la
      // misma red) y el navegador no guardaría cookies "Secure".
      cookieOptions: { secure: false },
    },
  },

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

  // La URL y la clave publicable se leen de NUXT_PUBLIC_SUPABASE_URL y
  // NUXT_PUBLIC_SUPABASE_KEY (ver .env.example y SUPABASE_SETUP.md).
  supabase: {
    // La protección de páginas la hace app/middleware/auth.global.js, que
    // exige un usuario verificado y no solo la presencia de una cookie.
    redirect: false,
    // Proyecto en JavaScript: no se usan tipos generados de la base de datos.
    types: false,
  },
})
