import { describe, expect, it } from 'vitest'
import {
  EMPLOYEE_COLUMNS,
  EMPLOYEE_FIELD_LIMITS,
  EMPLOYEE_STATUS_FILTER,
  countEmployees,
  filterEmployees,
  getEmployeeErrorFeedback,
  getEmployeeFieldErrors,
  getEmployeeFullName,
  getEmployeeInitials,
  hasEmployeeChanges,
  matchesEmployeeSearch,
  normalizeEmployeeInput,
  normalizeSearchText,
  sortEmployees,
  upsertEmployee,
  validateEmployeeInput,
} from '../../app/utils/employees.js'
import { DB_ERROR_KIND } from '../../app/utils/database-errors.js'
import { AUTHZ_STATUS, getAccessDecision } from '../../app/utils/authorization.js'

// Datos ficticios con la forma de public.employees.
const employee = (id, first_name, last_name, extra = {}) => ({
  id,
  first_name,
  last_name,
  role: null,
  notes: null,
  is_active: true,
  created_at: '2026-10-28T10:00:00Z',
  updated_at: '2026-10-28T10:00:00Z',
  ...extra,
})

const ana = employee('e1', 'Ana', 'López Gil', { role: 'Dependienta' })
const lucia = employee('e2', 'Lucía', 'Núñez', { is_active: false })
const marta = employee('e3', 'marta', 'Ortega')
const alvaro = employee('e4', 'Álvaro', 'Pérez')
const list = [marta, lucia, ana, alvaro]

describe('columnas', () => {
  it('solo usa las columnas reales de public.employees', () => {
    expect(EMPLOYEE_COLUMNS.split(',').map(c => c.trim())).toEqual(
      ['id', 'first_name', 'last_name', 'role', 'notes', 'is_active', 'created_at', 'updated_at'],
    )
  })
})

describe('normalizeEmployeeInput', () => {
  it('recorta espacios y une los espacios repetidos de nombre, apellidos y puesto', () => {
    expect(normalizeEmployeeInput({
      first_name: '  Ana  María ',
      last_name: '\tLópez\nGil ',
      role: '  Dependienta ',
      notes: '  Turno de mañana.\nPrefiere sábados. ',
    })).toEqual({
      first_name: 'Ana María',
      last_name: 'López Gil',
      role: 'Dependienta',
      notes: 'Turno de mañana.\nPrefiere sábados.',
    })
  })

  it('los opcionales vacíos se guardan como null (no se inventan valores)', () => {
    expect(normalizeEmployeeInput({ first_name: 'Ana', last_name: 'López', role: '   ', notes: '' }))
      .toEqual({ first_name: 'Ana', last_name: 'López', role: null, notes: null })
    expect(normalizeEmployeeInput({ first_name: 'Ana', last_name: 'López' }))
      .toEqual({ first_name: 'Ana', last_name: 'López', role: null, notes: null })
  })

  it('no envía columnas que no son editables desde el formulario', () => {
    const data = normalizeEmployeeInput({ first_name: 'A', last_name: 'B', is_active: false, id: 'x', created_at: 'y' })
    expect(Object.keys(data)).toEqual(['first_name', 'last_name', 'role', 'notes'])
  })
})

describe('validateEmployeeInput', () => {
  it('acepta nombre y apellidos con contenido', () => {
    expect(validateEmployeeInput({ first_name: 'Ana', last_name: 'López' })).toEqual([])
  })

  it('exige nombre y apellidos', () => {
    expect(validateEmployeeInput({})).toEqual([
      { name: 'first_name', message: 'Escribe el nombre.' },
      { name: 'last_name', message: 'Escribe los apellidos.' },
    ])
  })

  it.each([
    ['vacío', ''],
    ['solo espacios', '    '],
    ['tabuladores y saltos de línea', '\t\n  '],
    ['espacio de no separación', '  '],
    ['espacio ideográfico', '　'],
  ])('rechaza un nombre %s', (_, value) => {
    expect(validateEmployeeInput({ first_name: value, last_name: 'López' }))
      .toEqual([{ name: 'first_name', message: 'Escribe el nombre.' }])
    expect(validateEmployeeInput({ first_name: 'Ana', last_name: value }))
      .toEqual([{ name: 'last_name', message: 'Escribe los apellidos.' }])
  })

  it('los campos opcionales no son obligatorios', () => {
    expect(validateEmployeeInput({ first_name: 'Ana', last_name: 'López', role: '', notes: '  ' })).toEqual([])
  })

  it('limita la longitud de los campos', () => {
    const long = n => 'a'.repeat(n)
    expect(validateEmployeeInput({ first_name: long(EMPLOYEE_FIELD_LIMITS.first_name), last_name: 'B' })).toEqual([])
    expect(validateEmployeeInput({
      first_name: long(81), last_name: long(81), role: long(81), notes: long(1001),
    }).map(e => e.name)).toEqual(['first_name', 'last_name', 'role', 'notes'])
  })
})

describe('hasEmployeeChanges', () => {
  it('detecta cambios reales tras normalizar', () => {
    expect(hasEmployeeChanges(ana, { first_name: ' Ana ', last_name: 'López  Gil', role: 'Dependienta', notes: '' })).toBe(false)
    expect(hasEmployeeChanges(ana, { first_name: 'Ana', last_name: 'López Gil', role: '', notes: '' })).toBe(true)
    expect(hasEmployeeChanges(ana, { first_name: 'Anna', last_name: 'López Gil', role: 'Dependienta' })).toBe(true)
  })

  it('sin ficha (alta), siempre hay cambios', () => {
    expect(hasEmployeeChanges(null, {})).toBe(true)
  })
})

describe('nombre e iniciales', () => {
  it('nombre completo', () => {
    expect(getEmployeeFullName(ana)).toBe('Ana López Gil')
  })

  it('iniciales en mayúsculas, también con tildes', () => {
    expect(getEmployeeInitials(alvaro)).toBe('ÁP')
    expect(getEmployeeInitials(marta)).toBe('MO')
  })
})

describe('búsqueda', () => {
  it('ignora mayúsculas, tildes y espacios repetidos', () => {
    expect(normalizeSearchText('  Lucía   NÚÑEZ ')).toBe('lucia nunez')
    expect(matchesEmployeeSearch(lucia, 'lucia')).toBe(true)
    expect(matchesEmployeeSearch(lucia, 'NUNEZ')).toBe(true)
    expect(matchesEmployeeSearch(alvaro, 'alvaro')).toBe(true)
  })

  it('busca en nombre y apellidos, palabras en cualquier orden', () => {
    expect(matchesEmployeeSearch(ana, 'lopez ana')).toBe(true)
    expect(matchesEmployeeSearch(ana, 'gil')).toBe(true)
    expect(matchesEmployeeSearch(ana, 'an lo')).toBe(true)
    expect(matchesEmployeeSearch(ana, 'ana marta')).toBe(false)
  })

  it('no busca en el puesto ni en las observaciones', () => {
    expect(matchesEmployeeSearch(ana, 'dependienta')).toBe(false)
  })

  it('una búsqueda vacía lo muestra todo', () => {
    expect(matchesEmployeeSearch(ana, '   ')).toBe(true)
  })
})

describe('filtros y recuentos', () => {
  it('por defecto muestra solo los activos', () => {
    expect(filterEmployees(list).map(e => e.id)).toEqual(['e3', 'e1', 'e4'])
  })

  it('inactivos y todos', () => {
    expect(filterEmployees(list, { status: EMPLOYEE_STATUS_FILTER.INACTIVE }).map(e => e.id)).toEqual(['e2'])
    expect(filterEmployees(list, { status: EMPLOYEE_STATUS_FILTER.ALL })).toHaveLength(4)
  })

  it('combina estado y búsqueda', () => {
    expect(filterEmployees(list, { status: EMPLOYEE_STATUS_FILTER.ACTIVE, query: 'lucia' })).toEqual([])
    expect(filterEmployees(list, { status: EMPLOYEE_STATUS_FILTER.ALL, query: 'lucia' })).toEqual([lucia])
  })

  it('recuentos a partir de los datos', () => {
    expect(countEmployees(list)).toEqual({ active: 3, inactive: 1, all: 4 })
    expect(countEmployees([])).toEqual({ active: 0, inactive: 0, all: 0 })
    expect(countEmployees(null)).toEqual({ active: 0, inactive: 0, all: 0 })
  })
})

describe('orden', () => {
  it('alfabético en español por nombre y apellidos, sin distinguir tildes ni mayúsculas', () => {
    const sorted = sortEmployees([
      marta,
      employee('e5', 'Ana', 'Abad'),
      lucia,
      alvaro,
      ana,
    ])
    expect(sorted.map(getEmployeeFullName)).toEqual([
      'Álvaro Pérez',
      'Ana Abad',
      'Ana López Gil',
      'Lucía Núñez',
      'marta Ortega',
    ])
  })

  it('no modifica la lista original', () => {
    const original = [marta, ana]
    sortEmployees(original)
    expect(original).toEqual([marta, ana])
  })

  it('upsertEmployee sustituye la ficha editada y mantiene el orden', () => {
    const edited = { ...ana, first_name: 'Zoe' }
    const result = upsertEmployee(sortEmployees(list), edited)
    expect(result).toHaveLength(4)
    expect(result.at(-1)).toEqual(edited)
  })

  it('upsertEmployee añade una ficha nueva en su posición', () => {
    const nueva = employee('e9', 'Berta', 'Sanz')
    expect(upsertEmployee(sortEmployees(list), nueva).map(e => e.id)).toEqual(['e4', 'e1', 'e9', 'e2', 'e3'])
  })
})

describe('errores de Supabase', () => {
  it('restricción de nombre vacío → error en el campo nombre', () => {
    const error = { code: '23514', message: 'new row for relation "employees" violates check constraint "employees_first_name_not_blank"' }
    expect(getEmployeeFieldErrors(error)).toEqual([
      { name: 'first_name', message: 'El nombre no puede estar vacío ni contener solo espacios.' },
    ])
  })

  it('restricción de apellidos vacíos → error en el campo apellidos', () => {
    const error = { code: '23514', message: 'new row for relation "employees" violates check constraint "employees_last_name_not_blank"' }
    expect(getEmployeeFieldErrors(error)[0].name).toBe('last_name')
  })

  it('valor nulo → error en el campo correspondiente', () => {
    const error = { code: '23502', message: 'null value in column "last_name" of relation "employees" violates not-null constraint' }
    expect(getEmployeeFieldErrors(error)).toEqual([{ name: 'last_name', message: 'Escribe los apellidos.' }])
  })

  it('validación: mensaje general y errores de campo', () => {
    const feedback = getEmployeeErrorFeedback({
      error: { code: '23514', message: 'violates check constraint "employees_first_name_not_blank"' },
      status: 400,
    }, 'save')
    expect(feedback.kind).toBe(DB_ERROR_KIND.VALIDATION)
    expect(feedback.message).toBe('Revisa los datos del formulario.')
    expect(feedback.fields).toHaveLength(1)
  })

  it.each([
    ['sin conexión', { error: { message: 'TypeError: Failed to fetch' }, status: 0 }, DB_ERROR_KIND.NETWORK, /conexión a Internet/],
    ['sesión caducada', { error: { code: 'PGRST303', message: 'JWT expired' }, status: 401 }, DB_ERROR_KIND.EXPIRED, /sesión ha caducado/],
    ['RLS (no autorizada)', { error: { code: '42501', message: 'new row violates row-level security policy for table "employees"' }, status: 403 }, DB_ERROR_KIND.PERMISSION, /no tiene permiso/],
    ['tabla inexistente', { error: { code: 'PGRST205', message: 'Could not find the table' }, status: 404 }, DB_ERROR_KIND.MISSING, /migración/],
    ['fila no encontrada', { error: { code: 'PGRST116', message: 'Cannot coerce the result to a single JSON object' }, status: 406 }, DB_ERROR_KIND.NOT_FOUND, /No se ha encontrado/],
    ['error del servidor', { error: { message: 'Service Unavailable' }, status: 503 }, DB_ERROR_KIND.UNKNOWN, /Vuelve a intentarlo/],
  ])('%s', (_, response, kind, pattern) => {
    const feedback = getEmployeeErrorFeedback(response, 'save')
    expect(feedback.kind).toBe(kind)
    expect(feedback.message).toMatch(pattern)
    expect(feedback.fields).toEqual([])
  })

  it('nunca muestra el mensaje técnico original', () => {
    const response = { error: { code: 'XX000', message: 'internal error: secret detail at line 42' }, status: 500 }
    for (const action of ['load', 'save', 'status']) {
      expect(getEmployeeErrorFeedback(response, action).message).not.toMatch(/secret|XX000|line 42/)
    }
  })

  it('el mensaje depende de la acción', () => {
    const network = { error: { message: 'fetch failed' }, status: 0 }
    expect(getEmployeeErrorFeedback(network, 'load').message).toBe('Comprueba la conexión a Internet y vuelve a intentarlo.')
    expect(getEmployeeErrorFeedback(network, 'save').message).toMatch(/guardar los cambios/)
    expect(getEmployeeErrorFeedback(network, 'status').message).toMatch(/cambiar el estado/)
  })
})

describe('protección de la página /empleados', () => {
  it('solo la cuenta autorizada accede', () => {
    expect(getAccessDecision('/empleados', AUTHZ_STATUS.AUTHORIZED)).toEqual({ action: 'allow' })
  })

  it('una cuenta no autorizada va a acceso denegado', () => {
    expect(getAccessDecision('/empleados', AUTHZ_STATUS.UNAUTHORIZED)).toEqual({ action: 'redirect', to: '/acceso-denegado' })
  })

  it('sesión caducada o error: nunca se permite el acceso', () => {
    expect(getAccessDecision('/empleados', AUTHZ_STATUS.EXPIRED).action).toBe('expired')
    expect(getAccessDecision('/empleados', AUTHZ_STATUS.CHECK_FAILED).action).toBe('error')
    expect(getAccessDecision('/empleados', AUTHZ_STATUS.SETUP_ERROR).action).toBe('error')
    expect(getAccessDecision('/empleados', undefined).action).not.toBe('allow')
  })
})
