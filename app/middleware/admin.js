// Páginas solo para la cuenta de administración principal (/usuarios). Se
// ejecuta después de auth.global.js (sesión válida y cuenta autorizada).
//
// Importante: esto solo controla la INTERFAZ. Las rutas del servidor
// (server/api/admin/…) vuelven a comprobar la sesión y la cuenta en cada
// operación.
export default defineNuxtRouteMiddleware(async () => {
  // En la primera carga ya lo ha decidido el servidor.
  const nuxtApp = useNuxtApp()
  if (import.meta.client && nuxtApp.isHydrating && nuxtApp.payload.serverRendered) return

  const isAdmin = await useUserAdmin().checkAdmin()
  if (!isAdmin) {
    return abortNavigation(createError({ statusCode: 403, statusMessage: 'Forbidden', fatal: true }))
  }
})
