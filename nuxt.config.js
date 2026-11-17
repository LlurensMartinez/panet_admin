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

  ui: {
    // Las fuentes se sirven desde app/assets/fonts (ver main.css). Se
    // desactiva el módulo de fuentes de Nuxt UI para que la compilación no
    // consulte proveedores externos (Google Fonts, Bunny…).
    fonts: false,
  },

  // Variables privadas del servidor (nunca llegan al navegador):
  //   - NUXT_PANET_ADMIN_USER_ID: UUID (Supabase Auth) de la cuenta de
  //     administración principal, la única que puede gestionar usuarios.
  //   - NUXT_SUPABASE_SECRET_KEY: clave secreta de Supabase, la lee el módulo
  //     de Supabase (runtimeConfig.supabase.secretKey) y solo la usan las
  //     rutas de server/api/admin. Ver SUPABASE_SETUP.md, sección 15.
  runtimeConfig: {
    panetAdminUserId: '',
  },

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
