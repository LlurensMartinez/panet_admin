// ¿La cuenta con sesión es la de administración principal? Solo sirve para
// mostrar u ocultar la sección «Usuarios» en la interfaz; cada operación
// administrativa lo vuelve a comprobar (requireAdmin). No devuelve ningún
// dato de otras cuentas.
export default defineEventHandler(async (event) => {
  const userId = await getSessionUserId(event)
  if (!userId) throw createError({ statusCode: 401, statusMessage: USER_ADMIN_ERROR.NO_SESSION, data: { code: USER_ADMIN_ERROR.NO_SESSION } })
  return { isAdmin: userId === getAdminUserId(event) }
})
