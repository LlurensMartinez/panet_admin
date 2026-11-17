// Lista de cuentas autorizadas (filas de public.profiles) con su correo y si
// han aceptado la invitación. Solo para la cuenta de administración principal.
export default defineEventHandler(async (event) => {
  const { userId, admin } = await requireAdmin(event)

  const { data: profiles, error } = await admin.from('profiles').select('id, created_at')
  if (error) throw supabaseFailure(error)
  const authUsers = await listAuthUsers(admin)

  return {
    currentUserId: userId,
    users: buildAuthorizedUsers({ profiles: profiles ?? [], authUsers, adminId: getAdminUserId(event) }),
  }
})
