// Lógica pura de la gestión de festivos (sin dependencias de Nuxt ni de
// Supabase) para poder probarla con pruebas unitarias: validación, ámbitos,
// años, agrupación por meses, orden y mensajes de error.
//
// Los festivos solo sirven para avisar: nunca mueven ni cancelan pedidos.

import { DB_ERROR_KIND, classifyDatabaseError } from './database-errors.js'
import { getTodayDate, isValidDate } from './overtime.js'

// Columnas reales de public.holidays (migración 20261028221500).
export const HOLIDAY_COLUMNS = 'id, holiday_date, name, scope, notes, created_at, updated_at'

export const HOLIDAY_SCOPES = Object.freeze([
  Object.freeze({ value: 'national', label: 'Nacional' }),
  Object.freeze({ value: 'regional', label: 'Autonómico' }),
  Object.freeze({ value: 'local', label: 'Local' }),
])

const SCOPE_LABELS = new Map(HOLIDAY_SCOPES.map(scope => [scope.value, scope.label]))

// Límites de la interfaz. La base de datos no los impone.
export const HOLIDAY_FIELD_LIMITS = Object.freeze({
  name: 100,
  notes: 500,
})

// Años que se pueden consultar y configurar desde la interfaz.
export const HOLIDAY_MIN_YEAR = 2000
export const HOLIDAY_MAX_YEAR = 2100

const REQUIRED_MESSAGES = {
  holiday_date: 'Elige la fecha del festivo.',
  name: 'Escribe el nombre del festivo.',
  scope: 'Elige el ámbito del festivo.',
}

const DUPLICATE_MESSAGE = 'Ya hay un festivo configurado ese día.'

// Restricciones de la migración → campo del formulario y mensaje.
const CONSTRAINT_ERRORS = {
  holidays_holiday_date_unique: { name: 'holiday_date', message: DUPLICATE_MESSAGE },
  holidays_name_not_blank: { name: 'name', message: 'El nombre no puede estar vacío ni contener solo espacios.' },
  holidays_scope_valid: { name: 'scope', message: REQUIRED_MESSAGES.scope },
}

const fullDateFormatter = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
const dayMonthFormatter = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
const weekdayFormatter = new Intl.DateTimeFormat('es-ES', { weekday: 'short', timeZone: 'UTC' })
const monthFormatter = new Intl.DateTimeFormat('es-ES', { month: 'long', timeZone: 'UTC' })

function toUtcDate(value) {
  return new Date(`${value}T00:00:00Z`)
}

// ---------------------------------------------------------------- Fechas

export function getScopeLabel(scope) {
  return SCOPE_LABELS.get(scope) ?? ''
}

/** Año (número) de una fecha YYYY-MM-DD, o null. */
export function getYearOfDate(value) {
  return isValidDate(value) ? Number(String(value).slice(0, 4)) : null
}

export function getCurrentYear(today = getTodayDate()) {
  return getYearOfDate(today)
}

/** Año dentro del rango navegable. */
export function clampHolidayYear(year) {
  const value = Math.trunc(Number(year))
  if (!Number.isFinite(value)) return getCurrentYear()
  return Math.min(HOLIDAY_MAX_YEAR, Math.max(HOLIDAY_MIN_YEAR, value))
}

/** «jueves, 8 de diciembre de 2026». */
export function formatHolidayDate(value) {
  return isValidDate(value) ? fullDateFormatter.format(toUtcDate(value)) : ''
}

/** Sin el año (el listado ya está agrupado por año): «martes, 8 de diciembre». */
export function formatHolidayDayMonth(value) {
  return isValidDate(value) ? dayMonthFormatter.format(toUtcDate(value)) : ''
}

/** Partes para la etiqueta de fecha del listado: { day: '8', weekday: 'jue' }. */
export function getHolidayDateParts(value) {
  if (!isValidDate(value)) return { day: '', weekday: '' }
  const date = toUtcDate(value)
  return {
    day: String(date.getUTCDate()),
    weekday: weekdayFormatter.format(date).replace('.', ''),
  }
}

// ------------------------------------------------------------- Listado

/** Orden por fecha. */
export function sortHolidays(holidays) {
  return [...(holidays ?? [])].sort((a, b) =>
    String(a.holiday_date).localeCompare(String(b.holiday_date))
    || String(a.id).localeCompare(String(b.id)),
  )
}

export function filterHolidaysByYear(holidays, year) {
  const prefix = `${year}-`
  return sortHolidays((holidays ?? []).filter(h => String(h.holiday_date).startsWith(prefix)))
}

/**
 * Festivos agrupados por mes, en orden:
 * [{ key: '2026-12', label: 'diciembre', holidays: [...] }].
 */
export function groupHolidaysByMonth(holidays) {
  const groups = new Map()
  for (const holiday of sortHolidays(holidays)) {
    const key = String(holiday.holiday_date).slice(0, 7)
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        label: monthFormatter.format(toUtcDate(`${key}-01`)),
        holidays: [],
      })
    }
    groups.get(key).holidays.push(holiday)
  }
  return [...groups.values()]
}

/** Festivo configurado en esa fecha, o null. */
export function findHolidayByDate(holidays, date, excludeId = null) {
  return (holidays ?? []).find(h => h.holiday_date === date && h.id !== excludeId) ?? null
}

export function upsertHoliday(holidays, holiday) {
  const others = (holidays ?? []).filter(h => h.id !== holiday.id)
  return sortHolidays([...others, holiday])
}

export function removeHoliday(holidays, id) {
  return (holidays ?? []).filter(h => h.id !== id)
}

// ------------------------------------------------------------- Formulario

/** Texto sin espacios sobrantes; null si queda vacío. */
function cleanOptional(value) {
  const text = String(value ?? '').trim()
  return text === '' ? null : text
}

export function normalizeHolidayInput(values = {}) {
  return {
    holiday_date: String(values.holiday_date ?? '').trim(),
    name: String(values.name ?? '').replace(/\s+/g, ' ').trim(),
    scope: String(values.scope ?? ''),
    notes: cleanOptional(values.notes),
  }
}

export function toHolidayFormValues(holiday = null, { defaultScope = 'national' } = {}) {
  return {
    holiday_date: holiday?.holiday_date ?? '',
    name: holiday?.name ?? '',
    scope: holiday?.scope ?? defaultScope,
    notes: holiday?.notes ?? '',
  }
}

/**
 * Errores de validación con el formato de UForm: [{ name, message }].
 * `holidays` (opcional) es la lista cargada, para avisar si la fecha ya
 * tiene un festivo; `currentId` es el festivo que se edita.
 */
export function validateHolidayInput(values = {}, { holidays = [], currentId = null } = {}) {
  const data = normalizeHolidayInput(values)
  const errors = []

  if (!data.holiday_date) {
    errors.push({ name: 'holiday_date', message: REQUIRED_MESSAGES.holiday_date })
  }
  else if (!isValidDate(data.holiday_date)) {
    errors.push({ name: 'holiday_date', message: 'La fecha no es válida.' })
  }
  else {
    const year = getYearOfDate(data.holiday_date)
    if (year < HOLIDAY_MIN_YEAR || year > HOLIDAY_MAX_YEAR) {
      errors.push({ name: 'holiday_date', message: `Elige una fecha entre ${HOLIDAY_MIN_YEAR} y ${HOLIDAY_MAX_YEAR}.` })
    }
    else {
      const existing = findHolidayByDate(holidays, data.holiday_date, currentId)
      if (existing) {
        errors.push({ name: 'holiday_date', message: `Ya hay un festivo ese día: «${existing.name}».` })
      }
    }
  }

  if (!data.name) {
    errors.push({ name: 'name', message: REQUIRED_MESSAGES.name })
  }
  else if (Array.from(data.name).length > HOLIDAY_FIELD_LIMITS.name) {
    errors.push({ name: 'name', message: `Máximo ${HOLIDAY_FIELD_LIMITS.name} caracteres.` })
  }

  if (!SCOPE_LABELS.has(data.scope)) {
    errors.push({ name: 'scope', message: REQUIRED_MESSAGES.scope })
  }

  if (data.notes && Array.from(data.notes).length > HOLIDAY_FIELD_LIMITS.notes) {
    errors.push({ name: 'notes', message: `Máximo ${HOLIDAY_FIELD_LIMITS.notes} caracteres.` })
  }

  return errors
}

export function hasHolidayChanges(holiday, values) {
  if (!holiday) return true
  const data = normalizeHolidayInput(values)
  return ['holiday_date', 'name', 'scope', 'notes']
    .some(field => (holiday[field] ?? null) !== data[field])
}

// -------------------------------------------------------------- Errores

/**
 * Errores de campo a partir de un error de restricción de la base de datos.
 * @returns {{ name: string, message: string }[]}
 */
export function getHolidayFieldErrors(error) {
  const message = String(error?.message ?? '')

  if (['23514', '23505'].includes(error?.code)) {
    const constraint = Object.keys(CONSTRAINT_ERRORS).find(name => message.includes(name))
    if (constraint) return [{ ...CONSTRAINT_ERRORS[constraint] }]
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
  delete: {
    [DB_ERROR_KIND.NETWORK]: 'No se ha podido eliminar el festivo. Comprueba la conexión a Internet y vuelve a intentarlo.',
    [DB_ERROR_KIND.UNKNOWN]: 'No se ha podido eliminar el festivo. Vuelve a intentarlo.',
  },
}

const COMMON_MESSAGES = {
  [DB_ERROR_KIND.EXPIRED]: 'Tu sesión ha caducado. Vuelve a iniciar sesión para continuar.',
  [DB_ERROR_KIND.PERMISSION]: 'Esta cuenta no tiene permiso para gestionar festivos.',
  [DB_ERROR_KIND.MISSING]: 'La base de datos aún no está preparada para gestionar festivos: falta aplicar su migración (SUPABASE_SETUP.md, sección 10).',
  [DB_ERROR_KIND.NOT_FOUND]: 'No se ha encontrado este festivo. Puede que ya se haya eliminado: recarga la lista.',
  [DB_ERROR_KIND.VALIDATION]: 'Revisa los datos del formulario.',
}

/**
 * @param {{ error?: any, status?: number }} response
 * @param {'load' | 'save' | 'delete'} action
 */
export function getHolidayErrorFeedback(response, action = 'save') {
  const kind = classifyDatabaseError(response) ?? DB_ERROR_KIND.UNKNOWN
  const fields = kind === DB_ERROR_KIND.VALIDATION ? getHolidayFieldErrors(response?.error) : []
  const duplicate = fields.some(field => field.message === DUPLICATE_MESSAGE)
  const message = duplicate
    ? DUPLICATE_MESSAGE
    : COMMON_MESSAGES[kind]
      ?? MESSAGES[action]?.[kind]
      ?? MESSAGES[action]?.[DB_ERROR_KIND.UNKNOWN]
      ?? MESSAGES.save[DB_ERROR_KIND.UNKNOWN]

  return { kind, message, fields }
}
