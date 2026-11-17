// Revoca el acceso de una cuenta: borra su fila de public.profiles. La cuenta
// de Supabase Auth se conserva, pero private.is_authorized() pasa a ser false:
// la RLS le impide leer o escribir cualquier dato y la app la envía a
// /acceso-denegado. La cuenta de administración principal no puede revocarse
// a sí misma.
export default defineEventHandler(async (event) => {
  const { userId, admin } = await requireAdmin(event, { mutation: true })

  const id = String(getRouterParam(event, 'id') ?? '').toLowerCase()
  if (!isUserId(id)) {
    throw createError({ statusCode: 400, statusMessage: USER_ADMIN_ERROR.INVALID_USER, data: { code: USER_ADMIN_ERROR.INVALID_USER } })
  }
  if (id === userId) {
    throw createError({ statusCode: 400, statusMessage: USER_ADMIN_ERROR.CANNOT_REVOKE_SELF, data: { code: USER_ADMIN_ERROR.CANNOT_REVOKE_SELF } })
  }

  const { data, error } = await admin.from('profiles').delete().eq('id', id).select('id')
  if (error) throw supabaseFailure(error)
  if (!data?.length) {
    throw createError({ statusCode: 404, statusMessage: USER_ADMIN_ERROR.NOT_FOUND, data: { code: USER_ADMIN_ERROR.NOT_FOUND } })
  }
  return { revoked: id }
})
