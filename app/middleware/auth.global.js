// Protección de páginas en la interfaz.
// Importante: esto NO protege los datos. La protección real de la base de
// datos la hacen las políticas RLS de Supabase (private.is_authorized()).
//
// Flujo:
//   /login          → pública (con sesión válida, se envía a la app).
//   sin sesión      → /login?redirect=…
//   con sesión      → se comprueba si la cuenta está en public.profiles:
//     autorizada        → se permite (y /acceso-denegado se envía a /).
//     no autorizada     → /acceso-denegado (única página que puede ver).
//     sesión caducada   → se cierra la sesión local y /login?reason=expired.
//     error de conexión → página de error 503 con «Reintentar» (sin redirigir).
//     falta migración   → página de error 503 con instrucciones.

const PUBLIC_PATHS = ['/login']

export default defineNuxtRouteMiddleware(async (to) => {
  // En la primera carga, el servidor ya ha ejecutado este middleware y ha
  // decidido qué se muestra (página, redirección o error). Repetirlo en el
  // navegador durante la hidratación duplicaría la consulta y, si la
  // comprobación falla, reintentaría sin fin sobre la página de error.
  const nuxtApp = useNuxtApp()
  if (import.meta.client && nuxtApp.isHydrating && nuxtApp.payload.serverRendered) {
    return
  }

  // Usuario verificado por el módulo de Supabase (claims del JWT), no solo
  // la existencia de una cookie de sesión.
  const user = useSupabaseUser()
  const supabase = useSupabaseClient()
  const authorization = useAuthorization()

  if (PUBLIC_PATHS.includes(to.path)) {
    // Tras una sesión caducada se muestra el formulario aunque quede algún
    // resto de sesión local: así no se puede producir un bucle /login ↔ /.
    if (user.value && to.query.reason !== 'expired') {
      return navigateTo(getSafeRedirect(to.query.redirect), { replace: true })
    }
    return
  }

  if (!user.value) {
    return navigateTo({ path: '/login', query: redirectQuery(to) })
  }

  const status = await authorization.check()
  const decision = getAccessDecision(to.path, status)

  if (decision.action === 'allow') {
    return
  }

  if (decision.action === 'redirect') {
    return navigateTo(decision.to, { replace: true })
  }

  if (decision.action === 'expired') {
    try {
      await supabase.auth.signOut({ scope: 'local' })
    }
    catch {
      // Sin conexión: igualmente se olvida la sesión en la interfaz.
    }
    user.value = null
    authorization.reset()
    return navigateTo({ path: '/login', query: { reason: 'expired', ...redirectQuery(to) } })
  }

  // Errores: se deniega el acceso sin redirigir y se muestra app/error.vue.
  return abortNavigation(createError({
    statusCode: 503,
    statusMessage: 'Service Unavailable',
    fatal: true,
    data: { reason: decision.reason, path: to.fullPath },
  }))
})

function redirectQuery(to) {
  return to.fullPath === '/' ? {} : { redirect: to.fullPath }
}
