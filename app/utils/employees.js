// Lógica pura de la gestión de empleados (sin dependencias de Nuxt ni de
// Supabase) para poder probarla con pruebas unitarias: validación del
// formulario, búsqueda, filtros, recuentos, orden y mensajes de error.
//
// Recordatorio: la validación de la interfaz es una ayuda. La base de datos
// tiene sus propias restricciones (nombre y apellidos no vacíos) y la RLS es
// la que protege los datos.

import { DB_ERROR_KIND, classifyDatabaseError } from './database-errors.js'

// Columnas reales de public.employees (migración 20261028125000).
export const EMPLOYEE_COLUMNS = 'id, first_name, last_name, role, notes, is_active, created_at, updated_at'

export const EMPLOYEE_STATUS_FILTER = Object.freeze({
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  ALL: 'all',
})

// Límites de la interfaz para evitar textos desproporcionados. La base de
// datos no los impone.
export const EMPLOYEE_FIELD_LIMITS = Object.freeze({
  first_name: 80,
  last_name: 80,
  role: 80,
  notes: 1000,
})

const REQUIRED_MESSAGES = {
  first_name: 'Escribe el nombre.',
  last_name: 'Escribe los apellidos.',
}

const BLANK_MESSAGES = {
  first_name: 'El nombre no puede estar vacío ni contener solo espacios.',
  last_name: 'Los apellidos no pueden estar vacíos ni contener solo espacios.',
}

// Restricciones CHECK de la migración → campo del formulario.
const CONSTRAINT_FIELDS = {
  employees_first_name_not_blank: 'first_name',
  employees_last_name_not_blank: 'last_name',
}

const collator = new Intl.Collator('es', { sensitivity: 'base', numeric: true })

/** Texto sin espacios sobrantes; null si queda vacío. */
function cleanOptional(value) {
  const text = String(value ?? '').trim()
  return text === '' ? null : text
}

/** Una sola línea, sin espacios repetidos. */
function cleanName(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

/**
 * Prepara los valores del formulario para enviarlos a Supabase. Los campos
 * opcionales vacíos se guardan como null (no se inventan valores).
 */
export function normalizeEmployeeInput(values = {}) {
  return {
    first_name: cleanName(values.first_name),
    last_name: cleanName(values.last_name),
    role: cleanOptional(cleanName(values.role)),
    notes: cleanOptional(values.notes),
  }
}

/**
 * Errores de validación con el formato de UForm: [{ name, message }].
 * Se valida sobre los valores ya normalizados: un campo con solo espacios
 * (incluidos tabuladores, saltos de línea o espacios de no separación)
 * cuenta como vacío.
 */
export function validateEmployeeInput(values = {}) {
  const data = normalizeEmployeeInput(values)
  const errors = []

  for (const field of ['first_name', 'last_name']) {
    if (!data[field]) errors.push({ name: field, message: REQUIRED_MESSAGES[field] })
  }

  for (const [field, max] of Object.entries(EMPLOYEE_FIELD_LIMITS)) {
    const length = Array.from(data[field] ?? '').length
    if (length > max && !errors.some(e => e.name === field)) {
      errors.push({ name: field, message: `Máximo ${max} caracteres.` })
    }
  }

  return errors
}

/** true si los datos normalizados difieren de la ficha guardada. */
export function hasEmployeeChanges(employee, values) {
  if (!employee) return true
  const data = normalizeEmployeeInput(values)
  return ['first_name', 'last_name', 'role', 'notes']
    .some(field => (employee[field] ?? null) !== data[field])
}

export function getEmployeeFullName(employee) {
  return [employee?.first_name, employee?.last_name].filter(Boolean).join(' ')
}

export function getEmployeeInitials(employee) {
  const first = Array.from(String(employee?.first_name ?? '').trim())[0] ?? ''
  const last = Array.from(String(employee?.last_name ?? '').trim())[0] ?? ''
  return `${first}${last}`.toLocaleUpperCase('es')
}

/** Minúsculas, sin tildes ni espacios repetidos: «Lucía  Núñez» → «lucia nunez». */
export function normalizeSearchText(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('es')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Busca en nombre y apellidos. Cada palabra de la búsqueda debe aparecer
 * (en cualquier orden): «lopez ana» encuentra a «Ana López».
 */
export function matchesEmployeeSearch(employee, query) {
  const terms = normalizeSearchText(query).split(' ').filter(Boolean)
  if (terms.length === 0) return true
  const haystack = normalizeSearchText(getEmployeeFullName(employee))
  return terms.every(term => haystack.includes(term))
}

export function matchesEmployeeStatus(employee, status) {
  if (status === EMPLOYEE_STATUS_FILTER.ACTIVE) return employee.is_active === true
  if (status === EMPLOYEE_STATUS_FILTER.INACTIVE) return employee.is_active === false
  return true
}

export function filterEmployees(employees, { status = EMPLOYEE_STATUS_FILTER.ACTIVE, query = '' } = {}) {
  return (employees ?? []).filter(employee =>
    matchesEmployeeStatus(employee, status) && matchesEmployeeSearch(employee, query),
  )
}

export function countEmployees(employees) {
  const list = employees ?? []
  const active = list.filter(e => e.is_active === true).length
  return { active, inactive: list.length - active, all: list.length }
}

/** Orden alfabético en español por nombre y apellidos (ignora tildes y mayúsculas). */
export function sortEmployees(employees) {
  return [...(employees ?? [])].sort((a, b) =>
    collator.compare(a.first_name ?? '', b.first_name ?? '')
    || collator.compare(a.last_name ?? '', b.last_name ?? '')
    || String(a.id).localeCompare(String(b.id)),
  )
}

/** Sustituye (o añade) una ficha y devuelve la lista ordenada. */
export function upsertEmployee(employees, employee) {
  const others = (employees ?? []).filter(e => e.id !== employee.id)
  return sortEmployees([...others, employee])
}

/**
 * Errores de campo a partir de un error de restricción de la base de datos.
 * @returns {{ name: string, message: string }[]}
 */
export function getEmployeeFieldErrors(error) {
  const message = String(error?.message ?? '')

  if (error?.code === '23514') {
    const constraint = Object.keys(CONSTRAINT_FIELDS).find(name => message.includes(name))
    if (constraint) {
      const field = CONSTRAINT_FIELDS[constraint]
      return [{ name: field, message: BLANK_MESSAGES[field] }]
    }
  }

  if (error?.code === '23502') {
    const field = Object.keys(REQUIRED_MESSAGES).find(name => message.includes(`"${name}"`))
    if (field) return [{ name: field, message: REQUIRED_MESSAGES[field] }]
  }

  return []
}

const MESSAGES = {
  load: {
    [DB_ERROR_KIND.NETWORK]: 'Comprueba la conexión a Internet y vuelve a intentarlo.',
    [DB_ERROR_KIND.UNKNOWN]: 'El servidor no ha respondido como se esperaba. Vuelve a intentarlo en unos minutos.',
  },
  save: {
    [DB_ERROR_KIND.NETWORK]: 'No se han podido guardar los cambios. Comprueba la conexión a Internet y vuelve a intentarlo.',
    [DB_ERROR_KIND.UNKNOWN]: 'No se han podido guardar los cambios. Vuelve a intentarlo.',
  },
  status: {
    [DB_ERROR_KIND.NETWORK]: 'No se ha podido cambiar el estado. Comprueba la conexión a Internet y vuelve a intentarlo.',
    [DB_ERROR_KIND.UNKNOWN]: 'No se ha podido cambiar el estado. Vuelve a intentarlo.',
  },
}

const COMMON_MESSAGES = {
  [DB_ERROR_KIND.EXPIRED]: 'Tu sesión ha caducado. Vuelve a iniciar sesión para continuar.',
  [DB_ERROR_KIND.PERMISSION]: 'Esta cuenta no tiene permiso para gestionar empleados.',
  [DB_ERROR_KIND.MISSING]: 'La base de datos aún no está preparada para gestionar empleados: falta aplicar su migración (SUPABASE_SETUP.md, sección 9).',
  [DB_ERROR_KIND.NOT_FOUND]: 'No se ha encontrado este empleado. Recarga la lista para ver los datos actuales.',
  [DB_ERROR_KIND.VALIDATION]: 'Revisa los datos del formulario.',
}

/**
 * Mensaje para la persona usuaria (nunca el mensaje técnico original) y, si
 * se puede, los errores de cada campo.
 *
 * @param {{ error?: any, status?: number }} response
 * @param {'load' | 'save' | 'status'} action
 */
export function getEmployeeErrorFeedback(response, action = 'save') {
  const kind = classifyDatabaseError(response) ?? DB_ERROR_KIND.UNKNOWN
  const fields = kind === DB_ERROR_KIND.VALIDATION ? getEmployeeFieldErrors(response?.error) : []
  const message = COMMON_MESSAGES[kind]
    ?? MESSAGES[action]?.[kind]
    ?? MESSAGES[action]?.[DB_ERROR_KIND.UNKNOWN]
    ?? MESSAGES.save[DB_ERROR_KIND.UNKNOWN]

  return { kind, message, fields }
}
