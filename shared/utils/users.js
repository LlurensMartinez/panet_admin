// Gestión de usuarios (/usuarios): lógica pura compartida por la página y las
// rutas de servidor (server/api/admin/…). Sin dependencias de Nuxt ni de
// Supabase.
//
// Solo hay dos tipos de cuenta: la de administración principal (identificada en
// el servidor por NUXT_PANET_ADMIN_USER_ID) y las normales. Una
// cuenta tiene acceso a la app si tiene fila en public.profiles (igual que
// hasta ahora: private.is_authorized()).

/** Situación de una cuenta autorizada en Supabase Auth. */
export const USER_STATUS = Object.freeze({
  // Ha aceptado la invitación (o se creó con contraseña desde el panel).
  ACTIVE: 'active',
  // Invitada: todavía no ha abierto el enlace ni elegido su contraseña.
  INVITED: 'invited',
  // No se ha encontrado la cuenta en Supabase Auth.
  UNKNOWN: 'unknown',
})

/** Resultado de una invitación. */
export const INVITE_OUTCOME = Object.freeze({
  // Se ha enviado el correo de invitación.
  INVITED: 'invited',
  // La cuenta ya existía (y había aceptado): se le devuelve el acceso sin correo.
  RESTORED: 'restored',
})

/** Ruta pública donde la persona invitada elige su contraseña. */
export const INVITE_ACCEPT_PATH = '/bienvenida'

export const PASSWORD_MIN_LENGTH = 8
const EMAIL_MAX_LENGTH = 254
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const USER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** true si es un UUID (identificador de una cuenta de Supabase Auth). */
export function isUserId(value) {
  return typeof value === 'string' && USER_ID_PATTERN.test(value)
}

/** Correo sin espacios y en minúsculas (Supabase Auth no distingue mayúsculas). */
export function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase()
}

/** Mensaje de error del correo de una invitación, o null si es válido. */
export function validateInviteEmail(value) {
  const email = normalizeEmail(value)
  if (!email) return 'Introduce el correo electrónico.'
  if (email.length > EMAIL_MAX_LENGTH || !EMAIL_PATTERN.test(email)) return 'El correo electrónico no tiene un formato válido.'
  return null
}

/** Mensajes de error de la nueva contraseña (al aceptar una invitación). */
export function validateNewPassword(password, repeat) {
  const errors = []
  const value = String(password ?? '')
  if (!value) errors.push({ name: 'password', message: 'Elige una contraseña.' })
  else if (value.length < PASSWORD_MIN_LENGTH) errors.push({ name: 'password', message: `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.` })
  if (value && String(repeat ?? '') !== value) errors.push({ name: 'repeat', message: 'Las contraseñas no coinciden.' })
  return errors
}

/** Situación de una cuenta de Supabase Auth (USER_STATUS). */
export function getAuthUserStatus(authUser) {
  if (!authUser) return USER_STATUS.UNKNOWN
  if (authUser.email_confirmed_at || authUser.confirmed_at || authUser.last_sign_in_at) return USER_STATUS.ACTIVE
  return USER_STATUS.INVITED
}

/**
 * Lista de cuentas autorizadas para la página: solo los datos necesarios
 * (correo, situación y fechas), nunca metadatos ni tokens. La cuenta de
 * administración principal va primero; después, por correo.
 *
 * @param {object} params
 * @param {{ id: string, created_at?: string }[]} params.profiles filas de public.profiles
 * @param {object[]} params.authUsers usuarios de Supabase Auth (auth.admin.listUsers)
 * @param {string | null} params.adminId cuenta de administración principal
 */
export function buildAuthorizedUsers({ profiles = [], authUsers = [], adminId = null }) {
  const byId = new Map(authUsers.map(user => [user.id, user]))
  return profiles
    .map((profile) => {
      const authUser = byId.get(profile.id) ?? null
      return {
        id: profile.id,
        email: authUser?.email ?? '',
        status: getAuthUserStatus(authUser),
        isAdmin: profile.id === adminId,
        invitedAt: authUser?.invited_at ?? null,
        lastSignInAt: authUser?.last_sign_in_at ?? null,
        addedAt: profile.created_at ?? null,
      }
    })
    .sort((a, b) => (a.isAdmin !== b.isAdmin ? (a.isAdmin ? -1 : 1) : a.email.localeCompare(b.email, 'es')))
}

/** Busca una cuenta de Supabase Auth por correo (sin distinguir mayúsculas). */
export function findAuthUserByEmail(authUsers, email) {
  const target = normalizeEmail(email)
  return (authUsers ?? []).find(user => normalizeEmail(user.email) === target) ?? null
}

// ---------------------------------------------------------------- Errores

/** Códigos de error que devuelven las rutas /api/admin/… (en `data.code`). */
export const USER_ADMIN_ERROR = Object.freeze({
  NO_SESSION: 'no_session',
  FORBIDDEN: 'forbidden',
  CROSS_SITE: 'cross_site',
  NOT_CONFIGURED: 'admin_not_configured',
  INVALID_EMAIL: 'invalid_email',
  ALREADY_AUTHORIZED: 'already_authorized',
  RATE_LIMITED: 'rate_limited',
  INVALID_USER: 'invalid_user',
  CANNOT_REVOKE_SELF: 'cannot_revoke_self',
  NOT_FOUND: 'not_found',
  INVITED_WITHOUT_ACCESS: 'invited_without_access',
  SUPABASE_UNAVAILABLE: 'supabase_unavailable',
  SUPABASE_ERROR: 'supabase_error',
})

const ERROR_MESSAGES = {
  [USER_ADMIN_ERROR.NO_SESSION]: 'Tu sesión ha caducado. Vuelve a iniciar sesión para continuar.',
  [USER_ADMIN_ERROR.FORBIDDEN]: 'Solo la cuenta de administración principal puede gestionar usuarios.',
  [USER_ADMIN_ERROR.CROSS_SITE]: 'La petición no se ha hecho desde Panet Admin.',
  [USER_ADMIN_ERROR.NOT_CONFIGURED]: 'La gestión de usuarios no está configurada en el servidor (SUPABASE_SETUP.md, sección 15).',
  [USER_ADMIN_ERROR.INVALID_EMAIL]: 'El correo electrónico no tiene un formato válido.',
  [USER_ADMIN_ERROR.ALREADY_AUTHORIZED]: 'Esta persona ya tiene acceso a Panet Admin.',
  [USER_ADMIN_ERROR.RATE_LIMITED]: 'Se han enviado demasiados correos seguidos. Espera un rato y vuelve a intentarlo.',
  [USER_ADMIN_ERROR.INVALID_USER]: 'El usuario no es válido. Recarga la lista.',
  [USER_ADMIN_ERROR.CANNOT_REVOKE_SELF]: 'No puedes quitar el acceso a tu propia cuenta.',
  [USER_ADMIN_ERROR.NOT_FOUND]: 'Este usuario ya no tiene acceso. Recarga la lista.',
  [USER_ADMIN_ERROR.INVITED_WITHOUT_ACCESS]: 'Se ha enviado la invitación, pero no se ha podido dar acceso. Vuelve a invitar a esta persona.',
  [USER_ADMIN_ERROR.SUPABASE_UNAVAILABLE]: 'No se ha podido conectar con Supabase. Vuelve a intentarlo en unos minutos.',
  [USER_ADMIN_ERROR.SUPABASE_ERROR]: 'Supabase ha devuelto un error. Vuelve a intentarlo en unos minutos.',
}

/**
 * Mensaje comprensible para un error de las rutas de gestión de usuarios
 * (respuesta de $fetch), nunca el mensaje técnico.
 *
 * @param {any} error error de $fetch (FetchError)
 * @param {'load' | 'invite' | 'revoke'} action
 */
export function getUserAdminErrorMessage(error, action = 'load') {
  const code = error?.data?.data?.code ?? error?.data?.code ?? null
  if (code && ERROR_MESSAGES[code]) return ERROR_MESSAGES[code]
  const status = error?.statusCode ?? error?.status ?? error?.response?.status ?? 0
  if (!status) return 'No se ha podido conectar con el servidor. Comprueba la conexión a Internet y vuelve a intentarlo.'
  if (status === 401) return ERROR_MESSAGES[USER_ADMIN_ERROR.NO_SESSION]
  if (status === 403) return ERROR_MESSAGES[USER_ADMIN_ERROR.FORBIDDEN]
  return {
    load: 'No se ha podido cargar la lista de usuarios. Vuelve a intentarlo.',
    invite: 'No se ha podido enviar la invitación. Vuelve a intentarlo.',
    revoke: 'No se ha podido quitar el acceso. Vuelve a intentarlo.',
  }[action] ?? 'Se ha producido un error. Vuelve a intentarlo.'
}

/**
 * Clasifica un error de Supabase Auth (API administrativa) en un código de
 * USER_ADMIN_ERROR y un estado HTTP para la respuesta del servidor.
 *
 * @returns {{ statusCode: number, code: string }}
 */
export function classifyAuthAdminError(error) {
  const code = String(error?.code ?? error?.error_code ?? '')
  const status = Number(error?.status ?? 0)
  const name = String(error?.name ?? '')
  // Errores 5xx de Supabase (auth-js los marca como reintentables).
  if (status >= 500) return { statusCode: 502, code: USER_ADMIN_ERROR.SUPABASE_ERROR }
  if (name === 'AuthRetryableFetchError' || /fetch failed|ECONNREFUSED|ECONNRESET|socket hang up/i.test(String(error?.message ?? '')) || (status === 0 && !code)) {
    return { statusCode: 503, code: USER_ADMIN_ERROR.SUPABASE_UNAVAILABLE }
  }
  if (code === 'email_exists' || code === 'user_already_exists') return { statusCode: 409, code: USER_ADMIN_ERROR.ALREADY_AUTHORIZED }
  if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit' || status === 429) return { statusCode: 429, code: USER_ADMIN_ERROR.RATE_LIMITED }
  if (code === 'email_address_invalid' || code === 'validation_failed' || code === 'email_address_not_authorized') {
    return { statusCode: 422, code: USER_ADMIN_ERROR.INVALID_EMAIL }
  }
  if (status === 401 || status === 403 || code === 'not_admin' || code === 'bad_jwt') return { statusCode: 503, code: USER_ADMIN_ERROR.NOT_CONFIGURED }
  return { statusCode: 502, code: USER_ADMIN_ERROR.SUPABASE_ERROR }
}

/** Mensaje para un error al elegir la contraseña (supabase.auth.updateUser). */
export function getPasswordUpdateErrorMessage(error) {
  const code = String(error?.code ?? '')
  if (code === 'weak_password') return 'La contraseña es demasiado débil. Usa una más larga o con más variedad de caracteres.'
  if (code === 'same_password') return 'La nueva contraseña debe ser distinta de la anterior.'
  if (code === 'session_not_found' || code === 'session_expired' || error?.status === 401) {
    return 'El enlace de invitación ha caducado. Pide una nueva invitación.'
  }
  if (error?.name === 'AuthRetryableFetchError' || error?.status === 0) {
    return 'No se ha podido conectar con el servidor. Comprueba la conexión a Internet y vuelve a intentarlo.'
  }
  return 'No se ha podido guardar la contraseña. Vuelve a intentarlo.'
}

/** Mensaje para un enlace de invitación con error (parámetros del fragmento #…). */
export function getInviteLinkErrorMessage(params) {
  const code = String(params?.error_code ?? '')
  if (code === 'otp_expired') return 'El enlace de invitación ha caducado o ya se ha usado. Pide una nueva invitación a quien administra Panet Admin.'
  if (params?.error || code) return 'No se ha podido abrir la invitación. Pide una nueva invitación a quien administra Panet Admin.'
  return 'Para entrar por primera vez, abre el enlace del correo de invitación. Si ya tienes contraseña, inicia sesión.'
}
