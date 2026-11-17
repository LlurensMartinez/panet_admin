// Comprobaciones comunes de las rutas de gestión de usuarios
// (server/api/admin/…). Todo se ejecuta en el servidor:
//
//   - la sesión se valida con Supabase (claims del JWT, no solo la cookie);
//   - la cuenta de administración principal se identifica por su UUID en
//     NUXT_PANET_ADMIN_USER_ID (variable privada, nunca NUXT_PUBLIC_). Nadie
//     puede convertirse en administración modificando su perfil: public.profiles
//     no guarda ningún rol y las usuarias no pueden escribir en ella;
//   - la clave secreta de Supabase (NUXT_SUPABASE_SECRET_KEY) solo se usa aquí,
//     a través de serverSupabaseServiceRole, y nunca llega al navegador;
//   - las peticiones que modifican datos deben venir de la propia app.
import { createError, getRequestHeader, getRequestHost } from 'h3'
import { serverSupabaseClient, serverSupabaseServiceRole } from '#supabase/server'

function fail(statusCode, code) {
  return createError({ statusCode, statusMessage: code, data: { code } })
}

/** UUID de la cuenta de administración principal, o null si no está configurada. */
export function getAdminUserId(event) {
  const value = String(useRuntimeConfig(event).panetAdminUserId ?? '').trim().toLowerCase()
  return isUserId(value) ? value : null
}

/**
 * UUID de la cuenta con sesión, validada por Supabase. null si no hay sesión
 * o no es válida. Lanza 503 si Supabase no responde.
 */
export async function getSessionUserId(event) {
  const client = await serverSupabaseClient(event)
  const { data, error } = await client.auth.getClaims()
  if (error) {
    if (classifyAuthAdminError(error).code === USER_ADMIN_ERROR.SUPABASE_UNAVAILABLE) throw fail(503, USER_ADMIN_ERROR.SUPABASE_UNAVAILABLE)
    return null
  }
  const sub = data?.claims?.sub
  return isUserId(sub) ? sub.toLowerCase() : null
}

function getOriginHost(origin) {
  try {
    return new URL(origin).host
  }
  catch {
    return null
  }
}

/**
 * Las peticiones que modifican datos solo se aceptan desde la propia app
 * (protección adicional frente a peticiones de otros sitios).
 */
export function assertSameOrigin(event) {
  const site = getRequestHeader(event, 'sec-fetch-site')
  if (site && site !== 'same-origin' && site !== 'none') throw fail(403, USER_ADMIN_ERROR.CROSS_SITE)
  const origin = getRequestHeader(event, 'origin')
  if (origin && getOriginHost(origin) !== getRequestHost(event, { xForwardedHost: true })) {
    throw fail(403, USER_ADMIN_ERROR.CROSS_SITE)
  }
}

/** Cliente de Supabase con la clave secreta (solo servidor). */
export function getAdminClient(event) {
  try {
    return serverSupabaseServiceRole(event)
  }
  catch {
    throw fail(503, USER_ADMIN_ERROR.NOT_CONFIGURED)
  }
}

/** Convierte un error de Supabase (base de datos o Auth) en una respuesta. */
export function supabaseFailure(error) {
  const { statusCode, code } = classifyAuthAdminError(error)
  return fail(statusCode, code)
}

/**
 * Exige que la petición sea de la cuenta de administración principal y que
 * esa cuenta siga autorizada (fila en public.profiles). Se llama al principio
 * de cada operación administrativa.
 *
 * @returns {Promise<{ userId: string, admin: import('@supabase/supabase-js').SupabaseClient }>}
 */
export async function requireAdmin(event, { mutation = false } = {}) {
  if (mutation) assertSameOrigin(event)
  const userId = await getSessionUserId(event)
  if (!userId) throw fail(401, USER_ADMIN_ERROR.NO_SESSION)
  const adminId = getAdminUserId(event)
  if (!adminId) throw fail(503, USER_ADMIN_ERROR.NOT_CONFIGURED)
  if (userId !== adminId) throw fail(403, USER_ADMIN_ERROR.FORBIDDEN)

  const admin = getAdminClient(event)
  const { data, error } = await admin.from('profiles').select('id').eq('id', userId).maybeSingle()
  if (error) throw supabaseFailure(error)
  if (!data) throw fail(403, USER_ADMIN_ERROR.FORBIDDEN)
  return { userId, admin }
}

/** Todas las cuentas de Supabase Auth (paginadas; son pocas). */
export async function listAuthUsers(admin) {
  const users = []
  const perPage = 1000
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage })
    if (error) throw supabaseFailure(error)
    users.push(...(data?.users ?? []))
    if ((data?.users ?? []).length < perPage) break
  }
  return users
}
