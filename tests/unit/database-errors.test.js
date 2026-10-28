import { describe, expect, it } from 'vitest'
import { DB_ERROR_KIND, classifyDatabaseError } from '../../app/utils/database-errors.js'

// Respuestas con la forma que devuelve postgrest-js (supabase-js).
describe('classifyDatabaseError', () => {
  it('sin error → null', () => {
    expect(classifyDatabaseError({ data: [], error: null, status: 200 })).toBeNull()
    expect(classifyDatabaseError()).toBeNull()
  })

  it.each([
    ['fallo de red (status 0)', { error: { message: 'TypeError: fetch failed' }, status: 0 }, DB_ERROR_KIND.NETWORK],
    ['fallo de red (excepción sin status)', { error: new TypeError('Failed to fetch') }, DB_ERROR_KIND.NETWORK],
    ['JWT caducado', { error: { code: 'PGRST303', message: 'JWT expired' }, status: 401 }, DB_ERROR_KIND.EXPIRED],
    ['401 sin código', { error: { message: 'Unauthorized' }, status: 401 }, DB_ERROR_KIND.EXPIRED],
    ['RLS al insertar', { error: { code: '42501', message: 'new row violates row-level security policy' }, status: 403 }, DB_ERROR_KIND.PERMISSION],
    ['sin privilegio', { error: { code: '42501', message: 'permission denied for table employees' }, status: 403 }, DB_ERROR_KIND.PERMISSION],
    ['tabla inexistente (PostgREST)', { error: { code: 'PGRST205', message: 'Could not find the table' }, status: 404 }, DB_ERROR_KIND.MISSING],
    ['tabla inexistente (PostgreSQL)', { error: { code: '42P01', message: 'relation does not exist' }, status: 404 }, DB_ERROR_KIND.MISSING],
    ['.single() sin filas', { error: { code: 'PGRST116', message: 'Cannot coerce' }, status: 406 }, DB_ERROR_KIND.NOT_FOUND],
    ['restricción CHECK', { error: { code: '23514', message: 'violates check constraint' }, status: 400 }, DB_ERROR_KIND.VALIDATION],
    ['NOT NULL', { error: { code: '23502', message: 'null value' }, status: 400 }, DB_ERROR_KIND.VALIDATION],
    ['tipo inválido', { error: { code: '22P02', message: 'invalid input syntax' }, status: 400 }, DB_ERROR_KIND.VALIDATION],
    ['5xx', { error: { message: 'Service Unavailable' }, status: 503 }, DB_ERROR_KIND.UNKNOWN],
    ['código desconocido', { error: { code: 'XX000', message: 'internal' }, status: 500 }, DB_ERROR_KIND.UNKNOWN],
  ])('%s', (_, response, kind) => {
    expect(classifyDatabaseError(response)).toBe(kind)
  })
})
