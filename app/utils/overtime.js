// Lógica pura del registro de horas extra (sin dependencias de Nuxt ni de
// Supabase) para poder probarla con pruebas unitarias: duraciones, fechas,
// validación del formulario, filtros, totales, orden y mensajes de error.
//
// Reglas (SPEC.md 3.7 y migración 20261028125000):
// - La duración se guarda como minutos enteros: de 1 a 1440 por registro.
// - work_date es una fecha sin hora (YYYY-MM-DD).
// - Puede haber varios registros de la misma persona el mismo día.

import { DB_ERROR_KIND, classifyDatabaseError } from './database-errors.js'
import { getEmployeeFullName, sortEmployees } from './employees.js'

// Columnas reales de public.overtime_entries y, embebida mediante la clave
// foránea employee_id → employees.id, la ficha del empleado.
export const OVERTIME_COLUMNS = 'id, employee_id, work_date, duration_minutes, reason, notes, created_at, updated_at, employee:employees(id, first_name, last_name, role, is_active)'

export const OVERTIME_LIMITS = Object.freeze({
  minMinutes: 1,
  maxMinutes: 1440,
  reason: 200,
  notes: 1000,
})

// Zona horaria de la tienda: decide qué día es «hoy».
export const SHOP_TIME_ZONE = 'Europe/Madrid'

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const DIGITS_PATTERN = /^\d+$/

// ---------------------------------------------------------------- Duraciones

/** 90 → { hours: 1, minutes: 30 }. Solo para enteros no negativos. */
export function splitMinutes(totalMinutes) {
  const total = Math.max(0, Math.trunc(Number(totalMinutes) || 0))
  return { hours: Math.floor(total / 60), minutes: total % 60 }
}

/**
 * Texto legible de una duración en minutos enteros: «1 h 30 min», «2 h»,
 * «45 min», «0 h». Los totales no se convierten a días: 1530 → «25 h 30 min».
 */
export function formatDuration(totalMinutes) {
  const { hours, minutes } = splitMinutes(totalMinutes)
  if (hours && minutes) return `${hours} h ${minutes} min`
  if (hours) return `${hours} h`
  if (!minutes) return '0 h'
  return `${minutes} min`
}

/** Versión para lectores de pantalla: «1 hora y 30 minutos». */
export function formatDurationLong(totalMinutes) {
  const { hours, minutes } = splitMinutes(totalMinutes)
  const h = hours === 1 ? '1 hora' : `${hours} horas`
  const m = minutes === 1 ? '1 minuto' : `${minutes} minutos`
  if (hours && minutes) return `${h} y ${m}`
  if (hours) return h
  if (!minutes) return '0 horas'
  return m
}

/**
 * Convierte horas y minutos introducidos en el formulario a minutos enteros.
 * Solo se aceptan números enteros sin signo (ni decimales ni comas): así no
 * hay conversiones ambiguas como «1,5» o «1.30».
 *
 * @returns {{ minutes: number | null, errors: { name: string, message: string }[] }}
 *   Como mucho un error, con el nombre de campo `duration` (el grupo de
 *   horas y minutos del formulario).
 */
export function parseDurationParts({ hours, minutes } = {}) {
  const h = String(hours ?? '').trim()
  const m = String(minutes ?? '').trim()
  const errors = []

  if (h === '' && m === '') {
    return { minutes: null, errors: [{ name: 'duration', message: 'Indica la duración.' }] }
  }
  if (h !== '' && !DIGITS_PATTERN.test(h)) {
    errors.push({ name: 'duration', message: 'Escribe un número entero de horas.' })
  }
  else if (m !== '' && !DIGITS_PATTERN.test(m)) {
    errors.push({ name: 'duration', message: 'Escribe un número entero de minutos.' })
  }
  if (errors.length) return { minutes: null, errors }

  const hoursValue = h === '' ? 0 : Number(h)
  const minutesValue = m === '' ? 0 : Number(m)

  if (minutesValue > 59) {
    return { minutes: null, errors: [{ name: 'duration', message: 'Los minutos van de 0 a 59.' }] }
  }

  const total = hoursValue * 60 + minutesValue
  if (total < OVERTIME_LIMITS.minMinutes) {
    return { minutes: null, errors: [{ name: 'duration', message: 'La duración mínima es 1 minuto.' }] }
  }
  if (total > OVERTIME_LIMITS.maxMinutes) {
    return { minutes: null, errors: [{ name: 'duration', message: 'La duración máxima es 24 horas por registro.' }] }
  }

  return { minutes: total, errors: [] }
}

// -------------------------------------------------------------------- Fechas

/** Fecha de hoy (YYYY-MM-DD) en la zona horaria de la tienda. */
export function getTodayDate(now = new Date(), timeZone = SHOP_TIME_ZONE) {
  // en-CA da el formato ISO (2026-10-28).
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

/** true si es una fecha de calendario real en formato YYYY-MM-DD. */
export function isValidDate(value) {
  if (!DATE_PATTERN.test(String(value ?? ''))) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

const dateFormatters = {
  short: new Intl.DateTimeFormat('es-ES', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }),
  long: new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }),
  compact: new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }),
}

/**
 * Fecha de trabajo legible. Se interpreta como fecha de calendario (UTC a
 * medianoche) para que la zona horaria del navegador no la desplace un día.
 * Estilos: short («lun, 27 oct 2026»), long («lunes, 27 de octubre de 2026»),
 * compact («27 oct 2026»).
 */
export function formatWorkDate(value, style = 'short') {
  if (!isValidDate(value)) return ''
  return dateFormatters[style].format(new Date(`${value}T00:00:00Z`))
}

// ------------------------------------------------------- Formulario y datos

function cleanOptional(value) {
  const text = String(value ?? '').trim()
  return text === '' ? null : text
}

/**
 * Valida el formulario. `allowedEmployeeIds` son los empleados que se pueden
 * elegir (activos y, al editar, el empleado ya asociado al registro).
 *
 * @returns {{ name: string, message: string }[]} Formato de UForm.
 */
export function validateOvertimeInput(values = {}, { allowedEmployeeIds = null, today = getTodayDate() } = {}) {
  const errors = []

  if (!values.employee_id) {
    errors.push({ name: 'employee_id', message: 'Elige un empleado.' })
  }
  else if (allowedEmployeeIds && !allowedEmployeeIds.includes(values.employee_id)) {
    errors.push({ name: 'employee_id', message: 'Elige un empleado activo.' })
  }

  const date = String(values.work_date ?? '').trim()
  if (!date) {
    errors.push({ name: 'work_date', message: 'Indica la fecha.' })
  }
  else if (!isValidDate(date)) {
    errors.push({ name: 'work_date', message: 'La fecha no es válida.' })
  }
  else if (date > today) {
    errors.push({ name: 'work_date', message: 'La fecha no puede ser posterior a hoy.' })
  }

  errors.push(...parseDurationParts({ hours: values.hours, minutes: values.minutes }).errors)

  if (Array.from(String(values.reason ?? '').trim()).length > OVERTIME_LIMITS.reason) {
    errors.push({ name: 'reason', message: `Máximo ${OVERTIME_LIMITS.reason} caracteres.` })
  }
  if (Array.from(String(values.notes ?? '').trim()).length > OVERTIME_LIMITS.notes) {
    errors.push({ name: 'notes', message: `Máximo ${OVERTIME_LIMITS.notes} caracteres.` })
  }

  return errors
}

/**
 * Datos para Supabase a partir de un formulario ya validado. Los opcionales
 * vacíos se guardan como null (no se inventan valores).
 */
export function normalizeOvertimeInput(values = {}) {
  return {
    employee_id: values.employee_id,
    work_date: String(values.work_date ?? '').trim(),
    duration_minutes: parseDurationParts({ hours: values.hours, minutes: values.minutes }).minutes,
    reason: cleanOptional(String(values.reason ?? '').replace(/\s+/g, ' ')),
    notes: cleanOptional(values.notes),
  }
}

/** Valores del formulario a partir de un registro (o vacíos para un alta). */
export function toOvertimeFormValues(entry, { today = getTodayDate() } = {}) {
  if (!entry) {
    return { employee_id: undefined, work_date: today, hours: '', minutes: '', reason: '', notes: '' }
  }
  const { hours, minutes } = splitMinutes(entry.duration_minutes)
  return {
    employee_id: entry.employee_id,
    work_date: entry.work_date,
    hours: String(hours),
    minutes: String(minutes),
    reason: entry.reason ?? '',
    notes: entry.notes ?? '',
  }
}

/** true si el formulario cambia algún dato del registro guardado. */
export function hasOvertimeChanges(entry, values) {
  if (!entry) return true
  const data = normalizeOvertimeInput(values)
  return ['employee_id', 'work_date', 'duration_minutes', 'reason', 'notes']
    .some(field => (entry[field] ?? null) !== data[field])
}

// ------------------------------------------------------ Periodos de calendario
// Los usa el resumen por empleado (semanas y meses). El listado de registros
// se filtra solo con «Desde» y «Hasta».

export const OVERTIME_PERIOD = Object.freeze({
  TODAY: 'today',
  WEEK: 'week',
  MONTH: 'month',
  YEAR: 'year',
})

/** Suma días a una fecha YYYY-MM-DD (aritmética de calendario, en UTC). */
export function addDaysToDate(date, days) {
  const value = new Date(`${date}T00:00:00Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

/**
 * Fechas de un periodo de calendario a partir de un día (YYYY-MM-DD en la zona
 * horaria de la tienda, ver getTodayDate). Todo se calcula sobre fechas de
 * calendario, sin horas, así que no hay cambios de día por zona horaria ni
 * por el cambio de horario de verano.
 *
 * - Día: solo ese día.
 * - Semana: de lunes a domingo.
 * - Mes: del día 1 al último día del mes natural.
 * - Año: del 1 de enero al 31 de diciembre.
 *
 * @returns {{ from: string, to: string } | null} null si el periodo no es válido
 */
export function getPeriodRange(period, today = getTodayDate()) {
  if (!isValidDate(today)) return null
  const [year, month] = today.split('-').map(Number)
  const yyyy = String(year).padStart(4, '0')
  const mm = String(month).padStart(2, '0')

  switch (period) {
    case OVERTIME_PERIOD.TODAY:
      return { from: today, to: today }
    case OVERTIME_PERIOD.WEEK: {
      // getUTCDay: 0 = domingo … 6 = sábado → días desde el lunes.
      const daysSinceMonday = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7
      const monday = addDaysToDate(today, -daysSinceMonday)
      return { from: monday, to: addDaysToDate(monday, 6) }
    }
    case OVERTIME_PERIOD.MONTH: {
      // Día 0 del mes siguiente = último día de este mes (años bisiestos incluidos).
      const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
      return { from: `${yyyy}-${mm}-01`, to: `${yyyy}-${mm}-${String(lastDay).padStart(2, '0')}` }
    }
    case OVERTIME_PERIOD.YEAR:
      return { from: `${yyyy}-01-01`, to: `${yyyy}-12-31` }
    default:
      return null
  }
}

// ------------------------------------------------- Resumen por empleado
// El resumen tiene su propio periodo (una semana o un mes concretos, con
// navegación anterior/siguiente) y no depende de los filtros del listado.

export const OVERTIME_SUMMARY_VIEWS = Object.freeze([
  { value: OVERTIME_PERIOD.WEEK, label: 'Semanal' },
  { value: OVERTIME_PERIOD.MONTH, label: 'Mensual' },
])

/** Semana (lunes a domingo) o mes natural que contiene `anchor`. Reutiliza getPeriodRange. */
export function getSummaryRange(view, anchor) {
  if (view !== OVERTIME_PERIOD.WEEK && view !== OVERTIME_PERIOD.MONTH) return null
  return getPeriodRange(view, anchor)
}

/**
 * Fecha de referencia de la semana o el mes anterior (`step` = -1) o
 * siguiente (`step` = 1). En la vista mensual devuelve el día 1 del mes, para
 * que no haya desbordes del tipo «31 de febrero».
 */
export function shiftSummaryAnchor(view, anchor, step) {
  if (!isValidDate(anchor)) return anchor
  if (view === OVERTIME_PERIOD.WEEK) return addDaysToDate(anchor, 7 * step)
  const [year, month] = anchor.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1 + step, 1)).toISOString().slice(0, 10)
}

const monthYearFormatter = new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const dayMonthFormatter = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', timeZone: 'UTC' })

/**
 * Encabezado del periodo del resumen: «Semana del 7 al 13 sept 2026»,
 * «Semana del 26 oct al 1 nov 2026», «Semana del 28 dic 2026 al 3 ene 2027»
 * u «Octubre de 2026».
 */
export function formatSummaryTitle(view, range) {
  if (!range) return ''
  if (view === OVERTIME_PERIOD.MONTH) {
    const text = monthYearFormatter.format(new Date(`${range.from}T00:00:00Z`))
    return text.charAt(0).toLocaleUpperCase('es') + text.slice(1)
  }
  const fromDate = new Date(`${range.from}T00:00:00Z`)
  let start = formatWorkDate(range.from, 'compact')
  if (range.from.slice(0, 7) === range.to.slice(0, 7)) start = String(fromDate.getUTCDate())
  else if (range.from.slice(0, 4) === range.to.slice(0, 4)) start = dayMonthFormatter.format(fromDate)
  return `Semana del ${start} al ${formatWorkDate(range.to, 'compact')}`
}

/**
 * Horas extra agrupadas por empleado en un periodo (fechas de trabajo, ambos
 * extremos incluidos; reutiliza filterOvertimeEntries).
 *
 * - Se suman los minutos enteros de cada registro, sin redondear.
 * - Aparecen todos los empleados activos (también con 0 min) y los inactivos
 *   que tienen registros en el periodo: su historial sigue contando.
 * - Orden alfabético por nombre y apellidos, como en Empleados.
 *
 * @param {object[]} entries registros (con la ficha embebida en `employee`)
 * @param {object[]} employees fichas de empleados (useEmployees)
 * @param {{ from: string, to: string }} range
 */
export function summarizeOvertimeByEmployee(entries, employees, range) {
  const inPeriod = range ? filterOvertimeEntries(entries, range) : []
  const totals = new Map()

  for (const entry of inPeriod) {
    const current = totals.get(entry.employee_id) ?? { minutes: 0, count: 0, employee: entry.employee ?? null }
    current.minutes += Number.isInteger(entry.duration_minutes) ? entry.duration_minutes : 0
    current.count += 1
    totals.set(entry.employee_id, current)
  }

  const byId = new Map((employees ?? []).map(employee => [employee.id, employee]))
  const ids = new Set([
    ...(employees ?? []).filter(employee => employee.is_active).map(employee => employee.id),
    ...totals.keys(),
  ])

  const rows = sortEmployees([...ids].map((id) => {
    const employee = byId.get(id) ?? totals.get(id)?.employee ?? null
    return {
      id,
      employee,
      first_name: employee?.first_name ?? '',
      last_name: employee?.last_name ?? '',
      name: employee ? getEmployeeFullName(employee) : 'Empleado no disponible',
      isActive: employee?.is_active !== false,
      minutes: totals.get(id)?.minutes ?? 0,
      count: totals.get(id)?.count ?? 0,
    }
  }))

  return {
    rows,
    totalMinutes: sumDurationMinutes(inPeriod),
    entryCount: inPeriod.length,
    employeesWithEntries: totals.size,
  }
}

// ------------------------------------------------ Mensaje para compartir

const longDayMonthFormatter = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long', timeZone: 'UTC' })

/**
 * Periodo del mensaje con el mes escrito entero:
 * «Semana del 26 de octubre al 1 de noviembre de 2026 (de lunes a domingo)»,
 * «Semana del 7 al 13 de septiembre de 2026 (de lunes a domingo)»,
 * «Mes de octubre de 2026».
 */
export function formatSharePeriod(view, range) {
  if (!range) return ''
  if (view === OVERTIME_PERIOD.MONTH) {
    return `Mes de ${monthYearFormatter.format(new Date(`${range.from}T00:00:00Z`))}`
  }
  const from = new Date(`${range.from}T00:00:00Z`)
  const to = new Date(`${range.to}T00:00:00Z`)
  const toText = `${longDayMonthFormatter.format(to)} de ${range.to.slice(0, 4)}`
  let fromText = `${longDayMonthFormatter.format(from)} de ${range.from.slice(0, 4)}`
  if (range.from.slice(0, 7) === range.to.slice(0, 7)) fromText = String(from.getUTCDate())
  else if (range.from.slice(0, 4) === range.to.slice(0, 4)) fromText = longDayMonthFormatter.format(from)
  return `Semana del ${fromText} al ${toText} (de lunes a domingo)`
}

/**
 * Texto para enviar al responsable de zona (WhatsApp, correo…), a partir del
 * resultado de summarizeOvertimeByEmployee: mismas filas, mismo orden y los
 * mismos minutos enteros que se ven en pantalla.
 *
 * - Solo los empleados con registros en el periodo (los que están a 0 no salen).
 * - Los inactivos con registros se mantienen y se marcan «(inactivo)».
 * - Total general al final.
 *
 * @returns {string | null} null si el periodo no tiene registros: no se
 *   genera un mensaje vacío.
 */
export function buildOvertimeShareText(view, range, summary) {
  if (!range || !summary?.entryCount) return null

  const lines = summary.rows
    .filter(row => row.count > 0)
    .map(row => `- ${row.name}${row.isActive ? '' : ' (inactivo)'}: ${formatDuration(row.minutes)}`)

  return [
    'Resumen de horas extra',
    formatSharePeriod(view, range),
    '',
    ...lines,
    '',
    `Total ${view === OVERTIME_PERIOD.MONTH ? 'del mes' : 'de la semana'}: ${formatDuration(summary.totalMinutes)}`,
  ].join('\n')
}

// ------------------------------------------------ Filtros, totales y orden

/**
 * Filtra por empleado y por periodo. Los límites son fechas de trabajo e
 * incluyen ambos extremos: del 1 al 31 incluye los registros del día 31.
 * Un límite vacío no filtra.
 */
export function filterOvertimeEntries(entries, { employeeId = null, from = '', to = '' } = {}) {
  return (entries ?? []).filter(entry =>
    (!employeeId || entry.employee_id === employeeId)
    && (!from || entry.work_date >= from)
    && (!to || entry.work_date <= to),
  )
}

/** Comprueba el periodo de los filtros. @returns {string | null} mensaje de error */
export function validateDateRange({ from = '', to = '' } = {}) {
  if (from && !isValidDate(from)) return 'La fecha «Desde» no es válida.'
  if (to && !isValidDate(to)) return 'La fecha «Hasta» no es válida.'
  if (from && to && from > to) return 'La fecha «Desde» es posterior a «Hasta».'
  return null
}

/**
 * Descripción del alcance de los filtros, para el resumen:
 * «Todos los empleados, todas las fechas», «Ana López, del 1 oct 2026 al
 * 31 oct 2026», «Todos los empleados, desde el 1 oct 2026»…
 */
export function describeOvertimeFilters({ employeeName = '', from = '', to = '' } = {}) {
  const who = employeeName || 'Todos los empleados'
  const fromText = isValidDate(from) ? formatWorkDate(from, 'compact') : ''
  const toText = isValidDate(to) ? formatWorkDate(to, 'compact') : ''
  let when = 'todas las fechas'
  if (fromText && toText) when = from === to ? `el ${fromText}` : `del ${fromText} al ${toText}`
  else if (fromText) when = `desde el ${fromText}`
  else if (toText) when = `hasta el ${toText}`
  return `${who}, ${when}`
}

/** Suma de minutos enteros (sin redondear cada registro). */
export function sumDurationMinutes(entries) {
  return (entries ?? []).reduce((total, entry) => total + (Number.isInteger(entry.duration_minutes) ? entry.duration_minutes : 0), 0)
}

/**
 * Orden del listado: fecha de trabajo descendente; dentro del mismo día, el
 * registro creado más tarde primero; y el id como desempate estable.
 */
export function compareOvertimeEntries(a, b) {
  if (a.work_date !== b.work_date) return a.work_date < b.work_date ? 1 : -1
  if (a.created_at !== b.created_at) return String(a.created_at) < String(b.created_at) ? 1 : -1
  return String(a.id).localeCompare(String(b.id))
}

export function sortOvertimeEntries(entries) {
  return [...(entries ?? [])].sort(compareOvertimeEntries)
}

export function upsertOvertimeEntry(entries, entry) {
  return sortOvertimeEntries([...(entries ?? []).filter(e => e.id !== entry.id), entry])
}

export function removeOvertimeEntry(entries, id) {
  return (entries ?? []).filter(e => e.id !== id)
}

/** Nombre del empleado de un registro (la ficha llega embebida). */
export function getEntryEmployeeName(entry) {
  const employee = entry?.employee
  if (!employee) return 'Empleado no disponible'
  return [employee.first_name, employee.last_name].filter(Boolean).join(' ')
}

// ------------------------------------------------------------------ Errores

const CONSTRAINT_FIELDS = {
  overtime_entries_duration_minutes_range: { name: 'duration', message: 'La duración debe estar entre 1 minuto y 24 horas.' },
  overtime_entries_employee_id_fkey: { name: 'employee_id', message: 'Ese empleado ya no existe. Elige otro.' },
}

/** Errores de campo a partir de un error de restricción de la base de datos. */
export function getOvertimeFieldErrors(error) {
  const message = String(error?.message ?? '')
  const constraint = Object.keys(CONSTRAINT_FIELDS).find(name => message.includes(name))
  if (constraint) return [CONSTRAINT_FIELDS[constraint]]

  if (error?.code === '23503') return [CONSTRAINT_FIELDS.overtime_entries_employee_id_fkey]
  if (error?.code === '22P02' && /integer/.test(message)) {
    return [{ name: 'duration', message: 'La duración debe ser un número entero de minutos.' }]
  }
  if (error?.code === '22007' || error?.code === '22008') {
    return [{ name: 'work_date', message: 'La fecha no es válida.' }]
  }
  if (error?.code === '23502') {
    if (message.includes('"work_date"')) return [{ name: 'work_date', message: 'Indica la fecha.' }]
    if (message.includes('"duration_minutes"')) return [{ name: 'duration', message: 'Indica la duración.' }]
    if (message.includes('"employee_id"')) return [{ name: 'employee_id', message: 'Elige un empleado.' }]
  }
  return []
}

const MESSAGES = {
  load: {
    [DB_ERROR_KIND.NETWORK]: 'Comprueba la conexión a Internet y vuelve a intentarlo.',
    [DB_ERROR_KIND.UNKNOWN]: 'El servidor no ha respondido como se esperaba. Vuelve a intentarlo en unos minutos.',
  },
  save: {
    [DB_ERROR_KIND.NETWORK]: 'No se ha podido guardar el registro. Comprueba la conexión a Internet y vuelve a intentarlo.',
    [DB_ERROR_KIND.UNKNOWN]: 'No se ha podido guardar el registro. Vuelve a intentarlo.',
  },
  delete: {
    [DB_ERROR_KIND.NETWORK]: 'No se ha podido eliminar el registro. Comprueba la conexión a Internet y vuelve a intentarlo.',
    [DB_ERROR_KIND.UNKNOWN]: 'No se ha podido eliminar el registro. Vuelve a intentarlo.',
  },
}

const COMMON_MESSAGES = {
  [DB_ERROR_KIND.EXPIRED]: 'Tu sesión ha caducado. Vuelve a iniciar sesión para continuar.',
  [DB_ERROR_KIND.PERMISSION]: 'Esta cuenta no tiene permiso para gestionar las horas extra.',
  [DB_ERROR_KIND.MISSING]: 'La base de datos aún no está preparada para registrar horas extra: falta aplicar su migración (SUPABASE_SETUP.md, sección 9).',
  [DB_ERROR_KIND.NOT_FOUND]: 'No se ha encontrado este registro. Puede que ya se haya eliminado: recarga la lista.',
  [DB_ERROR_KIND.VALIDATION]: 'Revisa los datos del formulario.',
}

/**
 * Mensaje comprensible (nunca el técnico) y errores de campo, si los hay.
 * @param {{ error?: any, status?: number }} response
 * @param {'load' | 'save' | 'delete'} action
 */
export function getOvertimeErrorFeedback(response, action = 'save') {
  const kind = classifyDatabaseError(response) ?? DB_ERROR_KIND.UNKNOWN
  const fields = kind === DB_ERROR_KIND.VALIDATION ? getOvertimeFieldErrors(response?.error) : []
  const message = COMMON_MESSAGES[kind]
    ?? MESSAGES[action]?.[kind]
    ?? MESSAGES[action]?.[DB_ERROR_KIND.UNKNOWN]
    ?? MESSAGES.save[DB_ERROR_KIND.UNKNOWN]
  return { kind, message, fields }
}
