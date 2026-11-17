// Invita a una persona por correo (Supabase Auth, auth.admin.inviteUserByEmail)
// y le da acceso (fila en public.profiles). Solo para la cuenta de
// administración principal.
//
//   - Correo nuevo: se envía la invitación; el enlace lleva a /bienvenida,
//     donde elige su contraseña.
//   - Cuenta invitada que aún no ha aceptado: se reenvía la invitación.
//   - Cuenta que ya existía sin acceso (por ejemplo, revocada): se le devuelve
//     el acceso, sin correo; entra con su contraseña de siempre.
//   - Cuenta que ya tiene acceso: error.
export default defineEventHandler(async (event) => {
  const { admin } = await requireAdmin(event, { mutation: true })

  const body = await readBody(event).catch(() => null)
  const email = normalizeEmail(body?.email)
  if (validateInviteEmail(email)) {
    throw createError({ statusCode: 422, statusMessage: USER_ADMIN_ERROR.INVALID_EMAIL, data: { code: USER_ADMIN_ERROR.INVALID_EMAIL } })
  }

  const existing = findAuthUserByEmail(await listAuthUsers(admin), email)
  if (existing) {
    const { data: profile, error } = await admin.from('profiles').select('id').eq('id', existing.id).maybeSingle()
    if (error) throw supabaseFailure(error)
    if (profile) {
      throw createError({ statusCode: 409, statusMessage: USER_ADMIN_ERROR.ALREADY_AUTHORIZED, data: { code: USER_ADMIN_ERROR.ALREADY_AUTHORIZED } })
    }
  }

  let userId = existing?.id ?? null
  let outcome = INVITE_OUTCOME.RESTORED
  if (!existing || getAuthUserStatus(existing) === USER_STATUS.INVITED) {
    const redirectTo = new URL(INVITE_ACCEPT_PATH, getRequestURL(event, { xForwardedHost: true, xForwardedProto: true })).toString()
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo })
    if (error) throw supabaseFailure(error)
    userId = data?.user?.id ?? null
    outcome = INVITE_OUTCOME.INVITED
  }
  if (!isUserId(userId)) {
    throw createError({ statusCode: 502, statusMessage: USER_ADMIN_ERROR.SUPABASE_ERROR, data: { code: USER_ADMIN_ERROR.SUPABASE_ERROR } })
  }

  const { error: insertError } = await admin.from('profiles').insert({ id: userId })
  // 23505: ya tenía fila (otra pestaña la ha creado entretanto).
  if (insertError && insertError.code !== '23505') {
    const code = outcome === INVITE_OUTCOME.INVITED ? USER_ADMIN_ERROR.INVITED_WITHOUT_ACCESS : USER_ADMIN_ERROR.SUPABASE_ERROR
    throw createError({ statusCode: 502, statusMessage: code, data: { code } })
  }

  return { outcome, user: { id: userId, email } }
})
