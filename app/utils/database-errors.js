// Clasificación de los errores que devuelve el cliente de Supabase
// (PostgREST) al leer o escribir en las tablas de negocio. Lógica pura, sin
// dependencias de Nuxt, para poder probarla con pruebas unitarias.
//
// Las pantallas usan el tipo de error para mostrar un mensaje comprensible;
// nunca muestran el mensaje técnico original.

export const DB_ERROR_KIND = Object.freeze({
  // Sin conexión o Supabase no responde.
  NETWORK: 'network',
  // Supabase rechaza el token de la sesión (caducado o revocado).
  EXPIRED: 'expired',
  // RLS o falta de privilegios: la cuenta no puede hacer esa operación.
  PERMISSION: 'permission',
  // La tabla no existe: falta aplicar la migración.
  MISSING: 'missing',
  // Una restricción de la base de datos ha rechazado los datos.
  VALIDATION: 'validation',
  // La fila no existe o no es visible para la cuenta.
  NOT_FOUND: 'not_found',
  // Cualquier otro caso (errores 5xx, respuestas inesperadas…).
  UNKNOWN: 'unknown',
})

const NETWORK_ERROR_PATTERN = /fetch failed|failed to fetch|networkerror|network request failed|load failed|econnrefused|econnreset|socket hang up/i
const JWT_ERROR_CODES = new Set(['PGRST300', 'PGRST301', 'PGRST302', 'PGRST303'])
const MISSING_RELATION_CODES = new Set(['PGRST205', 'PGRST106', '42P01', '3F000'])
// check_violation, not_null_violation, invalid_text_representation,
// string_data_right_truncation, unique_violation, foreign_key_violation
const VALIDATION_CODES = new Set(['23514', '23502', '22P02', '22001', '23505', '23503'])

/**
 * @param {{ error?: any, status?: number }} response Respuesta de supabase-js
 *   (o `{ error, status: 0 }` si la petición lanzó una excepción).
 * @returns {string | null} Un valor de DB_ERROR_KIND, o null si no hay error.
 */
export function classifyDatabaseError({ error, status } = {}) {
  if (!error) return null

  const code = String(error.code ?? '')
  const message = String(error.message ?? error ?? '')

  if (status === 0 || (!code && NETWORK_ERROR_PATTERN.test(message))) {
    return DB_ERROR_KIND.NETWORK
  }
  if (status === 401 || JWT_ERROR_CODES.has(code)) return DB_ERROR_KIND.EXPIRED
  if (MISSING_RELATION_CODES.has(code)) return DB_ERROR_KIND.MISSING
  // .single() sin filas: la fila no existe o RLS no la deja ver.
  if (code === 'PGRST116') return DB_ERROR_KIND.NOT_FOUND
  if (code === '42501' || status === 403) return DB_ERROR_KIND.PERMISSION
  if (VALIDATION_CODES.has(code)) return DB_ERROR_KIND.VALIDATION
  if (status === 404) return DB_ERROR_KIND.MISSING

  return DB_ERROR_KIND.UNKNOWN
}
