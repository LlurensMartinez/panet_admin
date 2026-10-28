// Protección de páginas en la interfaz.
// Importante: esto NO protege los datos. La protección real de la base de
// datos dependerá de las políticas RLS de Supabase (fase posterior).

const PUBLIC_PATHS = ['/login']

export default defineNuxtRouteMiddleware((to) => {
  // Usuario verificado por el módulo de Supabase (claims del JWT), no solo
  // la existencia de una cookie de sesión.
  const user = useSupabaseUser()

  if (PUBLIC_PATHS.includes(to.path)) {
    if (user.value) {
      return navigateTo(getSafeRedirect(to.query.redirect), { replace: true })
    }
    return
  }

  if (!user.value) {
    const query = to.fullPath === '/' ? {} : { redirect: to.fullPath }
    return navigateTo({ path: '/login', query })
  }
})
