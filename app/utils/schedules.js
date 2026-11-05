// Lógica pura de los horarios del personal (sin dependencias de Nuxt ni de
// Supabase) para poder probarla con pruebas unitarias. Ver DATA_MODEL.md,
// «Horarios del personal», y SPEC.md, 3.9.
//
// Formato de los turnos (el mismo que guarda la base de datos):
//   - un día: [{ start: 'HH:MM', end: 'HH:MM' }, …] (como mucho 3; [] = descanso
//     o día libre). Si end es anterior o igual a start, el turno acaba al día
//     siguiente y cuenta entero en el día en que empieza;
//   - una semana: { '1': [turnos], …, '7': [turnos] } (día ISO, 1 = lunes). Un
//     día que falta es descanso.
//
// Las horas previstas son horas REALES en Europe/Madrid: se convierte cada
// inicio y fin a un instante y se restan.
//   - Hora inexistente (cambio al horario de verano, último domingo de marzo,
//     de 02:00 a 02:59): no se corrige; el turno queda con un error y no suma.
//   - Hora repetida (cambio al horario de invierno, último domingo de octubre,
//     de 02:00 a 02:59): se toma su PRIMERA aparición, todavía en horario de
//     verano (UTC+2), tanto en el inicio como en el fin.
//
// Prioridad para una empleada y un día (la misma que private.planned_shifts):
//   1. después de su último día de trabajo → baja;
//   2. versión vigente de tipo «end» → sin horario: periodo de baja anterior
//      o, si la empleada sigue activa y no hay una versión posterior, horario
//      cerrado (ver TERMINATED_REASON);
//   3. ausencia → sin turnos;
//   4. cambio de ese día → sus turnos (o día libre);
//   5. versión vigente de tipo «schedule» → turnos de ese día de la semana;
//   6. sin versión → sin horario.

import { getEmployeeFullName, sortEmployees } from './employees.js'
import { getIsoWeekday } from './orders.js'
import {
  SHOP_TIME_ZONE,
  addDaysToDate,
  filterOvertimeEntries,
  getPeriodRange,
  getTodayDate,
  isValidDate,
  sumDurationMinutes,
  OVERTIME_PERIOD,
} from './overtime.js'

export const MAX_SHIFTS_PER_DAY = 3
export const MINUTES_PER_DAY = 1440
// Días ISO de la semana (1 = lunes … 7 = domingo).
const WEEKDAY_NUMBERS = Object.freeze([1, 2, 3, 4, 5, 6, 7])

export const SCHEDULE_KIND = Object.freeze({
  SCHEDULE: 'schedule',
  END: 'end',
})

export const ABSENCE_TYPES = Object.freeze([
  { value: 'vacation', label: 'Vacaciones' },
  { value: 'leave', label: 'Permiso' },
  { value: 'other', label: 'Otro' },
])

/** Estado de una empleada en un día. */
export const DAY_STATUS = Object.freeze({
  // Turnos del horario habitual.
  REGULAR: 'regular',
  // Horario habitual sin turnos ese día de la semana.
  REST: 'rest',
  // Cambio de ese día con turnos.
  OVERRIDE: 'override',
  // Cambio de ese día sin turnos (día libre).
  DAY_OFF: 'day_off',
  // Vacaciones, permiso u otra ausencia.
  ABSENCE: 'absence',
  // Sin planificación posible: después del último día de trabajo, en un
  // periodo de baja anterior o con el horario cerrado (ver TERMINATED_REASON).
  TERMINATED: 'terminated',
  // Sin horario registrado (antes de la primera versión).
  NO_SCHEDULE: 'no_schedule',
})

/** Por qué un día está en DAY_STATUS.TERMINATED. */
export const TERMINATED_REASON = Object.freeze({
  // Después de su último día de trabajo (está de baja).
  AFTER_LAST_DAY: 'after_last_day',
  // Versión «end» de un periodo de baja: la empleada está de baja, o lo estuvo
  // y después tuvo un horario nuevo.
  LEAVE_PERIOD: 'leave_period',
  // Versión «end» sin ninguna versión posterior y la empleada sigue activa
  // (por ejemplo, reactivada sin copiar su horario): horario cerrado, no baja.
  CLOSED_SCHEDULE: 'closed_schedule',
})

/** Origen de un turno: habitual o excepción. */
export const SHIFT_ORIGIN = Object.freeze({
  REGULAR: 'regular',
  OVERRIDE: 'override',
})

/** Errores de validación de turnos (los mismos casos que rechaza la base de datos). */
export const SHIFT_ERROR = Object.freeze({
  NOT_A_LIST: 'not_a_list',
  TOO_MANY: 'too_many',
  INVALID_TIME: 'invalid_time',
  SAME_START_END: 'same_start_end',
  OVERLAP: 'overlap',
  NEXT_DAY_OVERLAP: 'next_day_overlap',
  NOT_A_WEEK: 'not_a_week',
  INVALID_WEEKDAY: 'invalid_weekday',
  // Al calcular horas reales: la hora no existe ese día (cambio de hora).
  NONEXISTENT_TIME: 'nonexistent_time',
})

/** Tipos de conflicto entre turnos ya resueltos en fechas concretas. */
export const CONFLICT_TYPE = Object.freeze({
  SAME_DAY: 'same_day',
  NEXT_DAY: 'next_day',
})

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/

// ------------------------------------------------------------------ Horas

/** Minutos desde las 00:00 de una hora «HH:MM» (00:00 a 23:59), o null. */
export function parseShiftTime(value) {
  const match = typeof value === 'string' ? TIME_PATTERN.exec(value) : null
  return match ? Number(match[1]) * 60 + Number(match[2]) : null
}

/** «HH:MM» a partir de minutos desde las 00:00 (0 a 1439). */
export function formatShiftTime(minutes) {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes >= MINUTES_PER_DAY) return ''
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

/** true si el turno acaba al día siguiente (fin anterior o igual al inicio). */
export function isOvernightShift(shift) {
  const start = parseShiftTime(shift?.start)
  const end = parseShiftTime(shift?.end)
  return start !== null && end !== null && end <= start
}

/**
 * Duración nominal (de reloj, sin cambios de hora) de un turno, en minutos.
 * Sirve para el total semanal del horario habitual, que no está ligado a
 * fechas concretas. null si el turno no es válido.
 */
export function getShiftNominalMinutes(shift) {
  const start = parseShiftTime(shift?.start)
  const end = parseShiftTime(shift?.end)
  if (start === null || end === null || start === end) return null
  return end > start ? end - start : end + MINUTES_PER_DAY - start
}

/** Ordena los turnos de un día por hora de inicio. */
export function sortShifts(shifts) {
  return [...(Array.isArray(shifts) ? shifts : [])].sort((a, b) =>
    (parseShiftTime(a?.start) ?? 0) - (parseShiftTime(b?.start) ?? 0),
  )
}

// ------------------------------------------------------------- Validación

function shiftInterval(shift) {
  const start = parseShiftTime(shift.start)
  const end = parseShiftTime(shift.end)
  return { start, end: end <= start ? end + MINUTES_PER_DAY : end }
}

function isWellFormedShift(shift) {
  return shift !== null
    && typeof shift === 'object'
    && !Array.isArray(shift)
    && Object.keys(shift).length === 2
    && parseShiftTime(shift.start) !== null
    && parseShiftTime(shift.end) !== null
}

/**
 * Valida los turnos de un día, con las mismas reglas que
 * private.is_valid_day_shifts.
 *
 * @returns {{ valid: boolean, errors: { code: string, index?: number, other?: number }[] }}
 */
export function validateDayShifts(shifts) {
  if (!Array.isArray(shifts)) return { valid: false, errors: [{ code: SHIFT_ERROR.NOT_A_LIST }] }
  const errors = []
  if (shifts.length > MAX_SHIFTS_PER_DAY) errors.push({ code: SHIFT_ERROR.TOO_MANY })

  shifts.forEach((shift, index) => {
    if (!isWellFormedShift(shift)) errors.push({ code: SHIFT_ERROR.INVALID_TIME, index })
    else if (shift.start === shift.end) errors.push({ code: SHIFT_ERROR.SAME_START_END, index })
  })
  if (errors.length > 0) return { valid: false, errors }

  for (let i = 0; i < shifts.length; i++) {
    for (let j = i + 1; j < shifts.length; j++) {
      const a = shiftInterval(shifts[i])
      const b = shiftInterval(shifts[j])
      if (a.start < b.end && b.start < a.end) errors.push({ code: SHIFT_ERROR.OVERLAP, index: i, other: j })
    }
  }
  return { valid: errors.length === 0, errors }
}

/**
 * true si un turno nocturno del primer día se solapa con algún turno del día
 * siguiente. Acabar a las 06:00 y empezar a las 06:00 no es solapamiento.
 * Igual que private.shifts_spill_conflict. Supone turnos válidos.
 */
export function shiftsSpillConflict(previousShifts, nextShifts) {
  const spillEnds = (previousShifts ?? [])
    .filter(isOvernightShift)
    .map(shift => parseShiftTime(shift.end))
  if (spillEnds.length === 0) return false
  const nextStarts = (nextShifts ?? [])
    .map(shift => parseShiftTime(shift?.start))
    .filter(value => value !== null)
  if (nextStarts.length === 0) return false
  return Math.max(...spillEnds) > Math.min(...nextStarts)
}

/** Turnos de un día de la semana (1-7) de una semana; [] si no tiene. */
export function getWeekdayShifts(week, weekday) {
  const shifts = week?.[String(weekday)]
  return Array.isArray(shifts) ? shifts : []
}

/**
 * Valida una semana del horario habitual, con las mismas reglas que
 * private.is_valid_week_shifts: cada día válido y ningún turno nocturno que
 * pise el día siguiente, incluido el domingo con el lunes (la semana se
 * repite).
 *
 * @returns {{ valid: boolean, errors: { code: string, weekday?: number, nextWeekday?: number, index?: number, other?: number }[] }}
 */
export function validateWeekShifts(week) {
  if (week === null || typeof week !== 'object' || Array.isArray(week)) {
    return { valid: false, errors: [{ code: SHIFT_ERROR.NOT_A_WEEK }] }
  }
  const errors = []
  for (const key of Object.keys(week)) {
    if (!/^[1-7]$/.test(key)) {
      errors.push({ code: SHIFT_ERROR.INVALID_WEEKDAY, weekday: key })
      continue
    }
    for (const error of validateDayShifts(week[key]).errors) errors.push({ ...error, weekday: Number(key) })
  }
  if (errors.length > 0) return { valid: false, errors }

  for (const weekday of WEEKDAY_NUMBERS) {
    const nextWeekday = weekday % 7 + 1
    if (shiftsSpillConflict(getWeekdayShifts(week, weekday), getWeekdayShifts(week, nextWeekday))) {
      errors.push({ code: SHIFT_ERROR.NEXT_DAY_OVERLAP, weekday, nextWeekday })
    }
  }
  return { valid: errors.length === 0, errors }
}

/** Total semanal nominal del horario habitual, en minutos (sin cambios de hora). */
export function getWeekTemplateMinutes(week) {
  return WEEKDAY_NUMBERS.reduce((total, weekday) =>
    total + getWeekdayShifts(week, weekday).reduce((sum, shift) => sum + (getShiftNominalMinutes(shift) ?? 0), 0), 0)
}

// ---------------------------------------------------------------- Fechas

/** Lunes de la semana (lunes-domingo) que contiene la fecha. */
export function getWeekStart(date) {
  return getPeriodRange(OVERTIME_PERIOD.WEEK, date)?.from ?? null
}

/** Las 7 fechas de la semana que empieza en `weekStart` (o que contiene la fecha). */
export function getWeekDates(date) {
  const monday = getWeekStart(date)
  return monday ? WEEKDAY_NUMBERS.map(offset => addDaysToDate(monday, offset - 1)) : []
}

/** Fechas de `from` a `to`, ambas incluidas. */
export function listDates(from, to) {
  if (!isValidDate(from) || !isValidDate(to) || from > to) return []
  const dates = []
  for (let date = from; date <= to; date = addDaysToDate(date, 1)) dates.push(date)
  return dates
}

/** «28/03/2027» a partir de «2027-03-28». */
function formatNumericDate(date) {
  const [year, month, day] = String(date ?? '').split('-')
  return year && month && day ? `${day}/${month}/${year}` : ''
}

// ------------------------------------------------- Zona horaria (Madrid)

const offsetFormatters = new Map()

function getOffsetFormatter(timeZone) {
  if (!offsetFormatters.has(timeZone)) {
    offsetFormatters.set(timeZone, new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }))
  }
  return offsetFormatters.get(timeZone)
}

/** Diferencia en minutos entre la hora local de la zona y UTC en un instante (Madrid: 60 o 120). */
export function getTimeZoneOffsetMinutes(instantMs, timeZone = SHOP_TIME_ZONE) {
  const parts = {}
  for (const part of getOffsetFormatter(timeZone).formatToParts(new Date(instantMs))) parts[part.type] = part.value
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour) % 24, Number(parts.minute), Number(parts.second))
  return Math.round((asUtc - Math.floor(instantMs / 1000) * 1000) / 60000)
}

/**
 * Instante (milisegundos UTC) de una fecha y hora locales de la zona.
 *   - Hora inexistente (el reloj se adelanta): `{ instant: null, nonexistent: true }`.
 *   - Hora repetida (el reloj se atrasa): la PRIMERA aparición (el instante
 *     más temprano), con `ambiguous: true`.
 *
 * @param {string} date YYYY-MM-DD
 * @param {number} minutes minutos desde las 00:00 (0 a 1439)
 * @returns {{ instant: number | null, nonexistent: boolean, ambiguous: boolean }}
 */
export function localTimeToInstant(date, minutes, timeZone = SHOP_TIME_ZONE) {
  const [year, month, day] = date.split('-').map(Number)
  const wall = Date.UTC(year, month - 1, day, 0, minutes)
  // Los desplazamientos posibles son los que tiene la zona alrededor de esa
  // hora (un día antes y un día después cubren cualquier cambio de hora).
  const offsets = new Set([-86400000, 0, 86400000].map(delta => getTimeZoneOffsetMinutes(wall + delta, timeZone)))
  const candidates = [...offsets]
    .map(offset => wall - offset * 60000)
    .filter(instant => instant + getTimeZoneOffsetMinutes(instant, timeZone) * 60000 === wall)
    .sort((a, b) => a - b)
  if (candidates.length === 0) return { instant: null, nonexistent: true, ambiguous: false }
  return { instant: candidates[0], nonexistent: false, ambiguous: candidates.length > 1 }
}

/**
 * Horas reales de un turno que empieza en `date`, en minutos. El fin de un
 * turno nocturno es del día siguiente. Si el inicio o el fin no existen por el
 * cambio de hora, `minutes` es null y `error` lo explica.
 *
 * @returns {{
 *   start: string, end: string, overnight: boolean, minutes: number | null,
 *   startsAt: number | null, endsAt: number | null, ambiguous: boolean,
 *   error: { code: string, date: string, time: string } | null
 * }}
 */
export function getShiftDuration(date, shift, timeZone = SHOP_TIME_ZONE) {
  const startMinutes = parseShiftTime(shift?.start)
  const endMinutes = parseShiftTime(shift?.end)
  const base = { start: shift?.start ?? '', end: shift?.end ?? '', overnight: false, minutes: null, startsAt: null, endsAt: null, ambiguous: false }
  if (!isValidDate(date) || startMinutes === null || endMinutes === null || startMinutes === endMinutes) {
    return { ...base, error: { code: SHIFT_ERROR.INVALID_TIME, date, time: '' } }
  }

  const overnight = endMinutes < startMinutes
  const endDate = overnight ? addDaysToDate(date, 1) : date
  const startLocal = localTimeToInstant(date, startMinutes, timeZone)
  const endLocal = localTimeToInstant(endDate, endMinutes, timeZone)
  const result = { ...base, overnight, ambiguous: startLocal.ambiguous || endLocal.ambiguous }

  if (startLocal.nonexistent) {
    return { ...result, error: { code: SHIFT_ERROR.NONEXISTENT_TIME, date, time: shift.start } }
  }
  if (endLocal.nonexistent) {
    return { ...result, startsAt: startLocal.instant, error: { code: SHIFT_ERROR.NONEXISTENT_TIME, date: endDate, time: shift.end } }
  }
  return {
    ...result,
    startsAt: startLocal.instant,
    endsAt: endLocal.instant,
    minutes: Math.round((endLocal.instant - startLocal.instant) / 60000),
    error: null,
  }
}

/** Mensaje comprensible para un error de un turno ya calculado. */
export function describeShiftError(error) {
  if (!error) return ''
  if (error.code === SHIFT_ERROR.NONEXISTENT_TIME) {
    return `La hora ${error.time} no existe el ${formatNumericDate(error.date)} por el cambio al horario de verano. Modifica el turno.`
  }
  return 'El turno no tiene un formato válido.'
}

// ------------------------------------------------ Versiones del horario

/** Versiones ordenadas por fecha de inicio. */
export function sortScheduleVersions(versions) {
  return [...(versions ?? [])].sort((a, b) => (a.valid_from < b.valid_from ? -1 : a.valid_from > b.valid_from ? 1 : 0))
}

/** Versión vigente en una fecha: la de valid_from más reciente igual o anterior. null si no hay. */
export function getVersionForDate(versions, date) {
  let current = null
  for (const version of versions ?? []) {
    if (version.valid_from <= date && (!current || version.valid_from > current.valid_from)) current = version
  }
  return current
}

/**
 * Periodos de vigencia de las versiones: cada una rige hasta el día antes de
 * la siguiente (`to` = null en la última).
 *
 * @returns {{ version: object, from: string, to: string | null, kind: string }[]}
 */
export function getVersionPeriods(versions) {
  const sorted = sortScheduleVersions(versions)
  return sorted.map((version, index) => ({
    version,
    kind: version.kind ?? SCHEDULE_KIND.SCHEDULE,
    from: version.valid_from,
    to: index + 1 < sorted.length ? addDaysToDate(sorted[index + 1].valid_from, -1) : null,
  }))
}

// --------------------------------------------- Horario de un día concreto

function forEmployee(list, employeeId) {
  return (list ?? []).filter(item => !employeeId || !item.employee_id || item.employee_id === employeeId)
}

/** Ausencia que cubre una fecha (ambos extremos incluidos), o null. */
export function findAbsenceForDate(absences, date) {
  return (absences ?? []).find(absence => absence.start_date <= date && date <= absence.end_date) ?? null
}

/** Cambio de un día para una fecha, o null. */
export function findOverrideForDate(overrides, date) {
  return (overrides ?? []).find(override => override.work_date === date) ?? null
}

function buildShifts(date, shifts, origin, timeZone) {
  return sortShifts(shifts).map(shift => ({ ...getShiftDuration(date, shift, timeZone), origin }))
}

/**
 * Horario previsto de una empleada en una fecha, con la prioridad descrita al
 * principio del archivo.
 *
 * @param {object} params
 * @param {{ id?: string, is_active?: boolean, last_working_date?: string | null }} params.employee
 * @param {object[]} [params.versions] filas de employee_schedules
 * @param {object[]} [params.overrides] filas de employee_day_overrides
 * @param {object[]} [params.absences] filas de employee_absences
 * @param {string} params.date YYYY-MM-DD
 */
export function resolveEmployeeDay({ employee, versions = [], overrides = [], absences = [], date, timeZone = SHOP_TIME_ZONE }) {
  const employeeId = employee?.id
  const employeeVersions = forEmployee(versions, employeeId)
  const version = getVersionForDate(employeeVersions, date)
  const day = {
    date,
    weekday: getIsoWeekday(date),
    status: DAY_STATUS.NO_SCHEDULE,
    terminatedReason: null,
    version,
    override: null,
    absence: null,
    shifts: [],
    minutes: 0,
    errors: [],
  }

  if (employee?.last_working_date && date > employee.last_working_date) {
    return { ...day, status: DAY_STATUS.TERMINATED, terminatedReason: TERMINATED_REASON.AFTER_LAST_DAY }
  }
  if (version?.kind === SCHEDULE_KIND.END) {
    const isActive = employee?.is_active === true && !employee?.last_working_date
    const hasLaterVersion = employeeVersions.some(other => other.valid_from > version.valid_from)
    const terminatedReason = isActive && !hasLaterVersion ? TERMINATED_REASON.CLOSED_SCHEDULE : TERMINATED_REASON.LEAVE_PERIOD
    return { ...day, status: DAY_STATUS.TERMINATED, terminatedReason }
  }

  const absence = findAbsenceForDate(forEmployee(absences, employeeId), date)
  if (absence) return { ...day, status: DAY_STATUS.ABSENCE, absence }

  let shifts
  const override = findOverrideForDate(forEmployee(overrides, employeeId), date)
  if (override) {
    shifts = buildShifts(date, override.shifts, SHIFT_ORIGIN.OVERRIDE, timeZone)
    day.override = override
    day.status = shifts.length > 0 ? DAY_STATUS.OVERRIDE : DAY_STATUS.DAY_OFF
  }
  else if (version) {
    shifts = buildShifts(date, getWeekdayShifts(version.week, day.weekday), SHIFT_ORIGIN.REGULAR, timeZone)
    day.status = shifts.length > 0 ? DAY_STATUS.REGULAR : DAY_STATUS.REST
  }
  else {
    return day
  }

  return {
    ...day,
    shifts,
    minutes: shifts.reduce((total, shift) => total + (shift.minutes ?? 0), 0),
    errors: shifts.filter(shift => shift.error).map(shift => shift.error),
  }
}

// ------------------------------------------------------------ Conflictos

function rawShifts(day) {
  return (day?.shifts ?? []).map(({ start, end }) => ({ start, end }))
}

/**
 * Conflictos entre los turnos ya resueltos de días consecutivos de una
 * empleada (ordenados por fecha): solapamientos dentro del día y turnos
 * nocturnos que pisan el día siguiente. Detecta también los que la base de
 * datos no puede impedir (los que aparecen por un cambio hecho en otro sitio).
 *
 * @returns {{ type: string, date: string, nextDate?: string }[]}
 */
export function findShiftConflicts(days) {
  const conflicts = []
  const list = days ?? []
  list.forEach((day, index) => {
    const shifts = rawShifts(day)
    if (validateDayShifts(shifts).errors.some(error => error.code === SHIFT_ERROR.OVERLAP)) {
      conflicts.push({ type: CONFLICT_TYPE.SAME_DAY, date: day.date })
    }
    const next = list[index + 1]
    if (next && next.date === addDaysToDate(day.date, 1) && shiftsSpillConflict(shifts, rawShifts(next))) {
      conflicts.push({ type: CONFLICT_TYPE.NEXT_DAY, date: day.date, nextDate: next.date })
    }
  })
  return conflicts
}

// ---------------------------------------------- Semana de una empleada

const PLANNED_STATUSES = new Set([DAY_STATUS.REGULAR, DAY_STATUS.REST, DAY_STATUS.OVERRIDE, DAY_STATUS.DAY_OFF, DAY_STATUS.ABSENCE])

/**
 * Semana (lunes-domingo) de una empleada: los 7 días resueltos, su total de
 * horas reales y los conflictos. Los conflictos incluyen el domingo anterior
 * con el lunes y el domingo con el lunes siguiente.
 */
export function buildEmployeeWeek({ employee, versions = [], overrides = [], absences = [], date, timeZone = SHOP_TIME_ZONE }) {
  const dates = getWeekDates(date)
  if (dates.length === 0) return null
  const resolve = day => resolveEmployeeDay({ employee, versions, overrides, absences, date: day, timeZone })
  const before = resolve(addDaysToDate(dates[0], -1))
  const days = dates.map(resolve)
  const after = resolve(addDaysToDate(dates[6], 1))

  const conflicts = findShiftConflicts([before, ...days, after])
    .filter(conflict => dates.includes(conflict.date) || dates.includes(conflict.nextDate))
  const conflictDates = new Set(conflicts.flatMap(conflict => [conflict.date, conflict.nextDate]).filter(Boolean))

  return {
    employeeId: employee?.id ?? null,
    weekStart: dates[0],
    days: days.map(day => ({ ...day, hasConflict: conflictDates.has(day.date) })),
    totalMinutes: days.reduce((total, day) => total + day.minutes, 0),
    conflicts,
    errorCount: days.reduce((total, day) => total + day.errors.length, 0),
    hasPlanning: days.some(day => PLANNED_STATUSES.has(day.status)),
  }
}

/**
 * true si la empleada debe aparecer en la semana del calendario:
 *   - si esa semana tiene algún horario, cambio o ausencia; o
 *   - si está activa (sin fecha de baja) y la semana es la actual o una futura,
 *     para poder crearle el horario.
 * Nunca aparece en semanas que empiezan después de su último día de trabajo.
 * Una empleada desactivada sin fecha de baja (antes del módulo de horarios)
 * no aparece en semanas que empiezan después de hoy.
 */
export function isEmployeeVisibleInWeek(employee, week, { today = getTodayDate() } = {}) {
  if (!week) return false
  if (employee?.last_working_date && week.weekStart > employee.last_working_date) return false
  if (employee?.is_active === false && !employee?.last_working_date && week.weekStart > today) return false
  if (week.hasPlanning) return true
  return employee?.is_active === true && !employee?.last_working_date && week.weekStart >= getWeekStart(today)
}

// ----------------------------------------------------- Semana de la plantilla

function groupByEmployee(list) {
  const groups = new Map()
  for (const item of list ?? []) {
    if (!groups.has(item.employee_id)) groups.set(item.employee_id, [])
    groups.get(item.employee_id).push(item)
  }
  return groups
}

/**
 * Plan de una semana para toda la plantilla: una fila por empleada visible
 * (ordenadas por nombre), totales por día, por empleada y de la plantilla.
 *
 * @returns {{
 *   weekStart: string, dates: string[], rows: object[],
 *   dayTotals: number[], totalMinutes: number, conflictCount: number, errorCount: number
 * }}
 */
export function buildWeekPlan({ employees = [], versions = [], overrides = [], absences = [], date, today = getTodayDate(), timeZone = SHOP_TIME_ZONE }) {
  const dates = getWeekDates(date)
  const versionsBy = groupByEmployee(versions)
  const overridesBy = groupByEmployee(overrides)
  const absencesBy = groupByEmployee(absences)

  const rows = sortEmployees(employees)
    .map((employee) => {
      const week = buildEmployeeWeek({
        employee,
        versions: versionsBy.get(employee.id) ?? [],
        overrides: overridesBy.get(employee.id) ?? [],
        absences: absencesBy.get(employee.id) ?? [],
        date,
        timeZone,
      })
      return week && isEmployeeVisibleInWeek(employee, week, { today })
        ? { ...week, employee, name: getEmployeeFullName(employee) }
        : null
    })
    .filter(Boolean)

  const dayTotals = dates.map((_, index) => rows.reduce((total, row) => total + row.days[index].minutes, 0))
  return {
    weekStart: dates[0] ?? null,
    dates,
    rows,
    dayTotals,
    totalMinutes: dayTotals.reduce((total, minutes) => total + minutes, 0),
    conflictCount: rows.reduce((total, row) => total + row.conflicts.length, 0),
    errorCount: rows.reduce((total, row) => total + row.errorCount, 0),
  }
}

// --------------------------------------------- Totales de un periodo

/**
 * Horas previstas (reales) de cada empleada entre dos fechas, ambas
 * incluidas. Un turno cuenta en el día en que empieza, así que el nocturno del
 * último día del periodo cuenta entero en el periodo.
 *
 * @returns {Map<string, { minutes: number, errorCount: number }>}
 */
export function summarizePlannedMinutes({ employees = [], versions = [], overrides = [], absences = [], from, to, timeZone = SHOP_TIME_ZONE }) {
  const dates = listDates(from, to)
  const versionsBy = groupByEmployee(versions)
  const overridesBy = groupByEmployee(overrides)
  const absencesBy = groupByEmployee(absences)
  const totals = new Map()

  for (const employee of employees ?? []) {
    let minutes = 0
    let errorCount = 0
    for (const date of dates) {
      const day = resolveEmployeeDay({
        employee,
        versions: versionsBy.get(employee.id) ?? [],
        overrides: overridesBy.get(employee.id) ?? [],
        absences: absencesBy.get(employee.id) ?? [],
        date,
        timeZone,
      })
      minutes += day.minutes
      errorCount += day.errors.length
    }
    totals.set(employee.id, { minutes, errorCount })
  }
  return totals
}

/**
 * Preparado para más adelante (todavía no se muestra): horas previstas frente
 * a horas extra registradas, por empleada, en un periodo. No infiere ni
 * modifica horas extra: solo pone una cifra junto a la otra.
 *
 * Incluye a las empleadas activas y a cualquiera con horas previstas o
 * registros de horas extra en el periodo.
 */
export function buildPlannedVsOvertime({ employees = [], versions = [], overrides = [], absences = [], overtimeEntries = [], from, to, timeZone = SHOP_TIME_ZONE }) {
  const planned = summarizePlannedMinutes({ employees, versions, overrides, absences, from, to, timeZone })
  const entries = filterOvertimeEntries(overtimeEntries, { from, to })
  const overtimeBy = groupByEmployee(entries)

  const rows = sortEmployees(employees)
    .map((employee) => {
      const own = overtimeBy.get(employee.id) ?? []
      return {
        employeeId: employee.id,
        employee,
        name: getEmployeeFullName(employee),
        plannedMinutes: planned.get(employee.id)?.minutes ?? 0,
        plannedErrorCount: planned.get(employee.id)?.errorCount ?? 0,
        overtimeMinutes: sumDurationMinutes(own),
        overtimeCount: own.length,
      }
    })
    .filter(row => row.employee.is_active === true || row.plannedMinutes > 0 || row.overtimeCount > 0)

  return {
    from,
    to,
    rows,
    plannedMinutes: rows.reduce((total, row) => total + row.plannedMinutes, 0),
    overtimeMinutes: rows.reduce((total, row) => total + row.overtimeMinutes, 0),
  }
}
