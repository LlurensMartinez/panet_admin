// Lógica pura de autorización (sin dependencias de Nuxt) para poder probarla
// con pruebas unitarias. La usan el composable useAuthorization y el
// middleware de rutas.
//
// Recordatorio: esto controla la INTERFAZ. La protección real de los datos
// la hacen las políticas RLS de Supabase (private.is_authorized()).

export const AUTHZ_STATUS = Object.freeze({
  // La cuenta tiene fila en public.profiles.
  AUTHORIZED: 'authorized',
  // Sesión válida, pero la cuenta no está en public.profiles.
  UNAUTHORIZED: 'unauthorized',
  // Supabase rechaza el token de la sesión (caducado o revocado).
  EXPIRED: 'expired',
  // No existe la tabla o faltan permisos: la migración no está aplicada o
  // la configuración no es la esperada.
  SETUP_ERROR: 'setup_error',
  // No se ha podido comprobar (sin conexión, Supabase no responde, error 5xx…).
  CHECK_FAILED: 'check_failed',
})

export const DENIED_PATH = '/acceso-denegado'

// Resultados que se pueden reutilizar en las navegaciones siguientes. Los
// errores nunca se guardan: se vuelven a comprobar en cada navegación.
export const CACHEABLE_STATUSES = Object.freeze([
  AUTHZ_STATUS.AUTHORIZED,
  AUTHZ_STATUS.UNAUTHORIZED,
])

// Códigos de PostgREST para un JWT ausente, mal formado o caducado.
const JWT_ERROR_CODES = new Set(['PGRST300', 'PGRST301', 'PGRST302', 'PGRST303'])
// Tabla o esquema inexistente (migración sin aplicar).
const MISSING_RELATION_CODES = new Set(['PGRST205', 'PGRST106', '42P01', '3F000'])

/**
 * Clasifica la respuesta de
 * `supabase.from('profiles').select('id').eq('id', userId).maybeSingle()`.
 *
 * Ante cualquier caso no reconocido, el resultado NO es «autorizada»
 * (se deniega el acceso por defecto).
 *
 * @param {{ data?: any, error?: any, status?: number }} response
 * @param {string | null | undefined} userId UUID de la sesión (`sub` del JWT)
 * @returns {string} Uno de los valores de AUTHZ_STATUS
 */
export function classifyProfileResponse(response, userId) {
  const { data = null, error = null, status } = response ?? {}

  if (!userId) {
    return AUTHZ_STATUS.EXPIRED
  }

  if (error) {
    const code = String(error.code ?? '')

    // Error de red: postgrest-js devuelve status 0 cuando fetch falla.
    if (status === 0 || isNetworkError(error)) {
      return AUTHZ_STATUS.CHECK_FAILED
    }

    if (status === 401 || JWT_ERROR_CODES.has(code)) {
      return AUTHZ_STATUS.EXPIRED
    }

    if (MISSING_RELATION_CODES.has(code) || status === 404) {
      return AUTHZ_STATUS.SETUP_ERROR
    }

    // Una cuenta autenticada siempre tiene permiso de lectura sobre
    // profiles: un 42501 indica permisos mal configurados.
    if (code === '42501' || status === 403) {
      return AUTHZ_STATUS.SETUP_ERROR
    }

    return AUTHZ_STATUS.CHECK_FAILED
  }

  if (data && typeof data === 'object' && data.id === userId) {
    return AUTHZ_STATUS.AUTHORIZED
  }

  // Sin fila (data === null): la cuenta existe pero no está autorizada.
  return AUTHZ_STATUS.UNAUTHORIZED
}

function isNetworkError(error) {
  const text = `${error?.name ?? ''} ${error?.message ?? ''}`
  return /TypeError|FetchError|fetch failed|Failed to fetch|NetworkError|Load failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|AbortError/i.test(text)
}

/**
 * Decide qué hacer con una ruta privada según el estado de autorización.
 * No se llama para /login (pública) ni cuando no hay sesión.
 *
 * Garantías contra bucles:
 *  - autorizada   → nunca se la envía a /acceso-denegado;
 *  - no autorizada → /acceso-denegado se permite siempre;
 *  - errores       → no hay redirección: se muestra la página de error.
 *
 * @param {string} path Ruta solicitada
 * @param {string | null | undefined} status Valor de AUTHZ_STATUS
 * @returns {{ action: 'allow' } | { action: 'redirect', to: string } | { action: 'expired' } | { action: 'error', reason: 'setup' | 'connection' }}
 */
export function getAccessDecision(path, status) {
  switch (status) {
    case AUTHZ_STATUS.AUTHORIZED:
      return path === DENIED_PATH ? { action: 'redirect', to: '/' } : { action: 'allow' }
    case AUTHZ_STATUS.UNAUTHORIZED:
      return path === DENIED_PATH ? { action: 'allow' } : { action: 'redirect', to: DENIED_PATH }
    case AUTHZ_STATUS.EXPIRED:
      return { action: 'expired' }
    case AUTHZ_STATUS.SETUP_ERROR:
      return { action: 'error', reason: 'setup' }
    default:
      return { action: 'error', reason: 'connection' }
  }
}
