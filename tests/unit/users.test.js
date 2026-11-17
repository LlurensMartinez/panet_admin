import { describe, expect, it } from 'vitest'
import {
  USER_ADMIN_ERROR,
  USER_STATUS,
  buildAuthorizedUsers,
  classifyAuthAdminError,
  findAuthUserByEmail,
  getAuthUserStatus,
  getInviteLinkErrorMessage,
  getPasswordUpdateErrorMessage,
  getUserAdminErrorMessage,
  isUserId,
  normalizeEmail,
  validateInviteEmail,
  validateNewPassword,
} from '../../shared/utils/users.js'

const ADMIN = 'aaaaaaaa-0000-4000-8000-000000000001'
const ANA = 'cccccccc-0000-4000-8000-000000000003'
const BEA = 'dddddddd-0000-4000-8000-000000000004'

describe('correo y contraseña', () => {
  it('normalizeEmail: sin espacios y en minúsculas', () => {
    expect(normalizeEmail('  Ana.Lopez@Ejemplo.ES ')).toBe('ana.lopez@ejemplo.es')
    expect(normalizeEmail(null)).toBe('')
  })

  it('validateInviteEmail', () => {
    expect(validateInviteEmail('ana@ejemplo.es')).toBeNull()
    expect(validateInviteEmail(' ANA@ejemplo.es ')).toBeNull()
    expect(validateInviteEmail('')).toBe('Introduce el correo electrónico.')
    for (const value of ['ana', 'ana@', 'ana@ejemplo', 'ana @ejemplo.es', `${'a'.repeat(250)}@e.es`]) {
      expect(validateInviteEmail(value)).toBe('El correo electrónico no tiene un formato válido.')
    }
  })

  it('validateNewPassword', () => {
    expect(validateNewPassword('', '')).toEqual([{ name: 'password', message: 'Elige una contraseña.' }])
    expect(validateNewPassword('corta', 'corta')).toEqual([{ name: 'password', message: 'La contraseña debe tener al menos 8 caracteres.' }])
    expect(validateNewPassword('larga-suficiente', 'otra')).toEqual([{ name: 'repeat', message: 'Las contraseñas no coinciden.' }])
    expect(validateNewPassword('larga-suficiente', 'larga-suficiente')).toEqual([])
  })

  it('isUserId', () => {
    expect(isUserId(ADMIN)).toBe(true)
    expect(isUserId('no-es-un-uuid')).toBe(false)
    expect(isUserId(null)).toBe(false)
  })
})

describe('lista de usuarios', () => {
  const authUsers = [
    { id: ADMIN, email: 'encargada@ejemplo.es', email_confirmed_at: '2026-10-28T10:00:00Z', last_sign_in_at: '2026-11-05T08:00:00Z', app_metadata: { provider: 'email' }, user_metadata: { secreto: 'x' } },
    { id: ANA, email: 'ana@ejemplo.es', invited_at: '2026-11-04T10:00:00Z', email_confirmed_at: null },
    { id: BEA, email: 'bea@ejemplo.es', invited_at: '2026-10-01T10:00:00Z', email_confirmed_at: '2026-10-02T10:00:00Z' },
    { id: 'eeeeeeee-0000-4000-8000-000000000005', email: 'sin-acceso@ejemplo.es', email_confirmed_at: '2026-10-02T10:00:00Z' },
  ]

  it('getAuthUserStatus: invitada pendiente, activa o sin datos', () => {
    expect(getAuthUserStatus(authUsers[1])).toBe(USER_STATUS.INVITED)
    expect(getAuthUserStatus(authUsers[2])).toBe(USER_STATUS.ACTIVE)
    expect(getAuthUserStatus({ id: 'x', last_sign_in_at: '2026-11-01T00:00:00Z' })).toBe(USER_STATUS.ACTIVE)
    expect(getAuthUserStatus(null)).toBe(USER_STATUS.UNKNOWN)
  })

  it('buildAuthorizedUsers: solo las cuentas con fila en profiles, administración primero y sin metadatos', () => {
    const profiles = [{ id: BEA, created_at: '2026-10-01T10:00:00Z' }, { id: ANA }, { id: ADMIN }]
    const users = buildAuthorizedUsers({ profiles, authUsers, adminId: ADMIN })
    expect(users.map(u => u.email)).toEqual(['encargada@ejemplo.es', 'ana@ejemplo.es', 'bea@ejemplo.es'])
    expect(users[0]).toEqual({ id: ADMIN, email: 'encargada@ejemplo.es', status: USER_STATUS.ACTIVE, isAdmin: true, invitedAt: null, lastSignInAt: '2026-11-05T08:00:00Z', addedAt: null })
    expect(users[1]).toMatchObject({ status: USER_STATUS.INVITED, isAdmin: false, invitedAt: '2026-11-04T10:00:00Z' })
    expect(JSON.stringify(users)).not.toContain('secreto')
    expect(users.some(u => u.email === 'sin-acceso@ejemplo.es')).toBe(false)
  })

  it('buildAuthorizedUsers: perfil sin cuenta de Auth', () => {
    expect(buildAuthorizedUsers({ profiles: [{ id: ANA }], authUsers: [], adminId: null })[0]).toMatchObject({ email: '', status: USER_STATUS.UNKNOWN, isAdmin: false })
  })

  it('findAuthUserByEmail sin distinguir mayúsculas', () => {
    expect(findAuthUserByEmail(authUsers, ' ANA@Ejemplo.es')?.id).toBe(ANA)
    expect(findAuthUserByEmail(authUsers, 'nadie@ejemplo.es')).toBeNull()
  })
})

describe('errores', () => {
  it('classifyAuthAdminError', () => {
    expect(classifyAuthAdminError({ code: 'email_exists', status: 422 })).toEqual({ statusCode: 409, code: USER_ADMIN_ERROR.ALREADY_AUTHORIZED })
    expect(classifyAuthAdminError({ code: 'over_email_send_rate_limit', status: 429 })).toEqual({ statusCode: 429, code: USER_ADMIN_ERROR.RATE_LIMITED })
    expect(classifyAuthAdminError({ code: 'email_address_invalid', status: 400 }).code).toBe(USER_ADMIN_ERROR.INVALID_EMAIL)
    expect(classifyAuthAdminError({ name: 'AuthRetryableFetchError', status: 0, message: 'fetch failed' })).toEqual({ statusCode: 503, code: USER_ADMIN_ERROR.SUPABASE_UNAVAILABLE })
    expect(classifyAuthAdminError({ message: 'TypeError: fetch failed', code: '' }).code).toBe(USER_ADMIN_ERROR.SUPABASE_UNAVAILABLE)
    expect(classifyAuthAdminError({ code: 'not_admin', status: 403 }).code).toBe(USER_ADMIN_ERROR.NOT_CONFIGURED)
    expect(classifyAuthAdminError({ code: '42501', message: 'permission denied' })).toEqual({ statusCode: 502, code: USER_ADMIN_ERROR.SUPABASE_ERROR })
    expect(classifyAuthAdminError({ code: 'unexpected_failure', status: 500 }).code).toBe(USER_ADMIN_ERROR.SUPABASE_ERROR)
    expect(classifyAuthAdminError({ name: 'AuthRetryableFetchError', status: 503, message: 'Service Unavailable' })).toEqual({ statusCode: 502, code: USER_ADMIN_ERROR.SUPABASE_ERROR })
  })

  it('getUserAdminErrorMessage: por código, por estado y sin conexión', () => {
    const err = (code, statusCode) => ({ statusCode, data: { statusCode, data: { code } } })
    expect(getUserAdminErrorMessage(err('already_authorized', 409), 'invite')).toBe('Esta persona ya tiene acceso a Panet Admin.')
    expect(getUserAdminErrorMessage(err('cannot_revoke_self', 400), 'revoke')).toBe('No puedes quitar el acceso a tu propia cuenta.')
    expect(getUserAdminErrorMessage(err('forbidden', 403))).toBe('Solo la cuenta de administración principal puede gestionar usuarios.')
    expect(getUserAdminErrorMessage({ statusCode: 401 })).toMatch(/sesión ha caducado/)
    expect(getUserAdminErrorMessage(new TypeError('Failed to fetch'), 'invite')).toMatch(/Comprueba la conexión/)
    expect(getUserAdminErrorMessage({ statusCode: 500 }, 'invite')).toBe('No se ha podido enviar la invitación. Vuelve a intentarlo.')
  })

  it('getPasswordUpdateErrorMessage y getInviteLinkErrorMessage', () => {
    expect(getPasswordUpdateErrorMessage({ code: 'weak_password' })).toMatch(/demasiado débil/)
    expect(getPasswordUpdateErrorMessage({ code: 'session_not_found' })).toMatch(/caducado/)
    expect(getPasswordUpdateErrorMessage({ name: 'AuthRetryableFetchError', status: 0 })).toMatch(/conexión/)
    expect(getInviteLinkErrorMessage({ error: 'access_denied', error_code: 'otp_expired' })).toMatch(/ha caducado o ya se ha usado/)
    expect(getInviteLinkErrorMessage({ error: 'server_error' })).toMatch(/No se ha podido abrir la invitación/)
    expect(getInviteLinkErrorMessage({})).toMatch(/abre el enlace del correo/)
  })
})
