import { describe, expect, it } from 'vitest'
import {
  AUTHZ_STATUS,
  CACHEABLE_STATUSES,
  DENIED_PATH,
  classifyProfileResponse,
  getAccessDecision,
} from '../../app/utils/authorization.js'

const USER_ID = 'aaaaaaaa-0000-4000-8000-000000000001'

// Respuestas con la forma que devuelve postgrest-js (supabase-js) para
// supabase.from('profiles').select('id').eq('id', USER_ID).maybeSingle()
const responses = {
  authorized: { data: { id: USER_ID }, error: null, status: 200 },
  noRow: { data: null, error: null, status: 200 },
  jwtExpired: { data: null, error: { code: 'PGRST303', message: 'JWT expired' }, status: 401 },
  anonFallback: { data: null, error: { code: '42501', message: 'permission denied for table profiles' }, status: 401 },
  network: { data: null, error: { code: '', message: 'TypeError: fetch failed', details: '', hint: '' }, status: 0 },
  serverError: { data: null, error: { code: '', message: 'Service Unavailable' }, status: 503 },
  missingTable: { data: null, error: { code: 'PGRST205', message: 'Could not find the table \'public.profiles\' in the schema cache' }, status: 404 },
  missingGrant: { data: null, error: { code: '42501', message: 'permission denied for table profiles' }, status: 403 },
}

describe('classifyProfileResponse', () => {
  it('autorizada: hay fila en profiles con el UUID de la sesión', () => {
    expect(classifyProfileResponse(responses.authorized, USER_ID)).toBe(AUTHZ_STATUS.AUTHORIZED)
  })

  it('no autorizada: la consulta funciona pero no devuelve fila', () => {
    expect(classifyProfileResponse(responses.noRow, USER_ID)).toBe(AUTHZ_STATUS.UNAUTHORIZED)
  })

  it('no autorizada: una fila de otra cuenta no autoriza', () => {
    const otherRow = { data: { id: 'bbbbbbbb-0000-4000-8000-000000000002' }, error: null, status: 200 }
    expect(classifyProfileResponse(otherRow, USER_ID)).toBe(AUTHZ_STATUS.UNAUTHORIZED)
  })

  it('sesión caducada: PostgREST rechaza el JWT (401 / PGRST303)', () => {
    expect(classifyProfileResponse(responses.jwtExpired, USER_ID)).toBe(AUTHZ_STATUS.EXPIRED)
  })

  it('sesión caducada: la petición llega como anónima (401 permission denied)', () => {
    expect(classifyProfileResponse(responses.anonFallback, USER_ID)).toBe(AUTHZ_STATUS.EXPIRED)
  })

  it('sesión caducada: no hay UUID de usuaria', () => {
    expect(classifyProfileResponse(responses.authorized, null)).toBe(AUTHZ_STATUS.EXPIRED)
  })

  it('error de conexión: fetch falla (status 0) y NO se confunde con «no autorizada»', () => {
    const result = classifyProfileResponse(responses.network, USER_ID)
    expect(result).toBe(AUTHZ_STATUS.CHECK_FAILED)
    expect(result).not.toBe(AUTHZ_STATUS.UNAUTHORIZED)
  })

  it('error de conexión: excepción de red capturada por el composable', () => {
    const thrown = { data: null, error: new TypeError('Failed to fetch'), status: 0 }
    expect(classifyProfileResponse(thrown, USER_ID)).toBe(AUTHZ_STATUS.CHECK_FAILED)
  })

  it('error de conexión: Supabase responde con 5xx', () => {
    expect(classifyProfileResponse(responses.serverError, USER_ID)).toBe(AUTHZ_STATUS.CHECK_FAILED)
  })

  it('configuración: la tabla profiles no existe (migración sin aplicar)', () => {
    expect(classifyProfileResponse(responses.missingTable, USER_ID)).toBe(AUTHZ_STATUS.SETUP_ERROR)
  })

  it('configuración: authenticated sin permiso de lectura (403)', () => {
    expect(classifyProfileResponse(responses.missingGrant, USER_ID)).toBe(AUTHZ_STATUS.SETUP_ERROR)
  })

  it('respuesta vacía o inesperada: nunca autoriza', () => {
    expect(classifyProfileResponse(undefined, USER_ID)).toBe(AUTHZ_STATUS.UNAUTHORIZED)
    expect(classifyProfileResponse({ data: 'x' }, USER_ID)).toBe(AUTHZ_STATUS.UNAUTHORIZED)
    expect(classifyProfileResponse({ data: [{ id: USER_ID }] }, USER_ID)).toBe(AUTHZ_STATUS.UNAUTHORIZED)
  })

  it('solo se guardan en caché los resultados definitivos, nunca los errores', () => {
    expect(CACHEABLE_STATUSES).toEqual([AUTHZ_STATUS.AUTHORIZED, AUTHZ_STATUS.UNAUTHORIZED])
  })
})

describe('getAccessDecision', () => {
  it('autorizada: accede a las páginas privadas', () => {
    expect(getAccessDecision('/', AUTHZ_STATUS.AUTHORIZED)).toEqual({ action: 'allow' })
    expect(getAccessDecision('/pedidos', AUTHZ_STATUS.AUTHORIZED)).toEqual({ action: 'allow' })
  })

  it('autorizada: si abre la página de acceso denegado, vuelve al inicio', () => {
    expect(getAccessDecision(DENIED_PATH, AUTHZ_STATUS.AUTHORIZED)).toEqual({ action: 'redirect', to: '/' })
  })

  it('no autorizada: cualquier página privada lleva a acceso denegado', () => {
    expect(getAccessDecision('/', AUTHZ_STATUS.UNAUTHORIZED)).toEqual({ action: 'redirect', to: DENIED_PATH })
    expect(getAccessDecision('/horas-extra', AUTHZ_STATUS.UNAUTHORIZED)).toEqual({ action: 'redirect', to: DENIED_PATH })
  })

  it('no autorizada: la página de acceso denegado se muestra (sin bucle)', () => {
    expect(getAccessDecision(DENIED_PATH, AUTHZ_STATUS.UNAUTHORIZED)).toEqual({ action: 'allow' })
  })

  it('sesión caducada: se cierra la sesión', () => {
    expect(getAccessDecision('/', AUTHZ_STATUS.EXPIRED)).toEqual({ action: 'expired' })
    expect(getAccessDecision(DENIED_PATH, AUTHZ_STATUS.EXPIRED)).toEqual({ action: 'expired' })
  })

  it('error de conexión: se muestra un error, sin redirigir y sin permitir el acceso', () => {
    expect(getAccessDecision('/', AUTHZ_STATUS.CHECK_FAILED)).toEqual({ action: 'error', reason: 'connection' })
    expect(getAccessDecision(DENIED_PATH, AUTHZ_STATUS.CHECK_FAILED)).toEqual({ action: 'error', reason: 'connection' })
  })

  it('configuración incompleta: se muestra un error de preparación', () => {
    expect(getAccessDecision('/', AUTHZ_STATUS.SETUP_ERROR)).toEqual({ action: 'error', reason: 'setup' })
  })

  it('estado desconocido: se deniega por defecto', () => {
    expect(getAccessDecision('/', undefined)).toEqual({ action: 'error', reason: 'connection' })
    expect(getAccessDecision('/', 'otra-cosa')).toEqual({ action: 'error', reason: 'connection' })
  })

  it('ninguna combinación produce un bucle de redirección', () => {
    const paths = ['/', '/pedidos', DENIED_PATH]
    for (const status of [...Object.values(AUTHZ_STATUS), undefined]) {
      for (const path of paths) {
        const first = getAccessDecision(path, status)
        if (first.action !== 'redirect') continue
        // El destino de una redirección, con el mismo estado, no vuelve a redirigir.
        expect(getAccessDecision(first.to, status).action).not.toBe('redirect')
      }
    }
  })
})
