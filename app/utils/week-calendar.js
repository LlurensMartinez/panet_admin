// Lógica de presentación del calendario semanal de horarios (/horarios), sin
// dependencias de Nuxt ni de Supabase. Las reglas de negocio (versiones,
// prioridades, bajas, horas reales, totales y conflictos) están en
// app/utils/schedules.js; aquí solo se decide cómo se muestra cada cosa.

import { DB_ERROR_KIND } from './database-errors.js'
import { formatDuration, getTodayDate, isValidDate, addDaysToDate } from './overtime.js'
import { getAbsenceTypeLabel } from './employee-leave.js'
import { DAY_STATUS, describeShiftError, getWeekStart } from './schedules.js'
import { WEEKDAYS } from './suppliers.js'
import { findHolidayByDate } from './holidays.js'

/** Columnas de las empleadas en el calendario (incluye la fecha de baja). */
export const WEEK_PLAN_EMPLOYEE_COLUMNS = 'id, first_name, last_name, role, is_active, last_working_date'

/** Parámetro de la URL con el lunes de la semana (?semana=2026-11-02). */
export const WEEK_QUERY_KEY = 'semana'

/** Aspecto de una celda del calendario. */
export const CELL_TONE = Object.freeze({
  REGULAR: 'regular',
  EXCEPTION: 'exception',
  REST: 'rest',
  ABSENCE: 'absence',
  TERMINATED: 'terminated',
  EMPTY: 'empty',
})

// ---------------------------------------------------------------- Semanas

/** Lunes de la semana pedida en la URL, o el de la semana actual si no es válida. */
export function resolveWeekParam(value, today = getTodayDate()) {
  const text = Array.isArray(value) ? value[0] : value
  return isValidDate(text) ? getWeekStart(text) : getWeekStart(today)
}

/** Lunes de la semana anterior (-1) o siguiente (+1). */
export function shiftWeekStart(weekStart, step) {
  return addDaysToDate(weekStart, 7 * step)
}

const dayFormatter = new Intl.DateTimeFormat('es-ES', { day: 'numeric', timeZone: 'UTC' })
const dayMonthFormatter = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const fullFormatter = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
const longDayFormatter = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
const asDate = date => new Date(`${date}T00:00:00Z`)

/** «2–8 nov 2026», «30 nov – 6 dic 2026», «28 dic 2026 – 3 ene 2027». */
export function describeWeekRange(weekStart) {
  if (!isValidDate(weekStart)) return ''
  const end = addDaysToDate(weekStart, 6)
  if (weekStart.slice(0, 7) === end.slice(0, 7)) return `${dayFormatter.format(asDate(weekStart))}–${fullFormatter.format(asDate(end))}`
  if (weekStart.slice(0, 4) === end.slice(0, 4)) return `${dayMonthFormatter.format(asDate(weekStart))} – ${fullFormatter.format(asDate(end))}`
  return `${fullFormatter.format(asDate(weekStart))} – ${fullFormatter.format(asDate(end))}`
}

/** «Esta semana», «La semana pasada», «La semana que viene» o ''. */
export function describeWeekRelation(weekStart, today = getTodayDate()) {
  const current = getWeekStart(today)
  if (weekStart === current) return 'Esta semana'
  if (weekStart === shiftWeekStart(current, -1)) return 'La semana pasada'
  if (weekStart === shiftWeekStart(current, 1)) return 'La semana que viene'
  return ''
}

/** «jueves, 5 de noviembre». */
export function formatLongDay(date) {
  return isValidDate(date) ? longDayFormatter.format(asDate(date)) : ''
}

/**
 * Cabeceras de los 7 días: día de la semana, número, si es hoy y el festivo
 * (solo informativo: no cambia las horas previstas).
 */
export function getDayHeaders(dates, { today = getTodayDate(), holidays = [] } = {}) {
  return (dates ?? []).map((date, index) => {
    const weekday = WEEKDAYS[index]
    return {
      date,
      weekday: weekday.value,
      short: weekday.short,
      abbr: weekday.abbr,
      label: weekday.label,
      dayNumber: Number(date.slice(8, 10)),
      isToday: date === today,
      holiday: findHolidayByDate(holidays, date),
    }
  })
}

/** Día que se muestra al abrir la vista diaria: hoy si está en la semana; si no, el lunes. */
export function getDefaultSelectedDate(dates, today = getTodayDate()) {
  return (dates ?? []).includes(today) ? today : (dates?.[0] ?? null)
}

// ---------------------------------------------------------------- Celdas

/**
 * Cómo se muestra el día de una empleada (resultado de resolveEmployeeDay en
 * buildWeekPlan): turnos, etiqueta y si es una excepción al horario habitual.
 *
 * @returns {{
 *   tone: string, label: string | null, badge: string | null, isException: boolean,
 *   shifts: { key: string, text: string, overnight: boolean, error: string | null }[],
 *   minutes: number, duration: string, hasConflict: boolean, errors: string[]
 * }}
 */
export function getDayCellView(day) {
  const shifts = (day?.shifts ?? []).map((shift, index) => ({
    key: `${index}-${shift.start}-${shift.end}`,
    text: `${shift.start}–${shift.end}`,
    overnight: Boolean(shift.overnight),
    error: shift.error ? describeShiftError(shift.error) : null,
  }))
  const base = {
    shifts,
    minutes: day?.minutes ?? 0,
    duration: day?.minutes ? formatDuration(day.minutes) : '',
    hasConflict: Boolean(day?.hasConflict),
    errors: shifts.filter(shift => shift.error).map(shift => shift.error),
    label: null,
    badge: null,
    isException: false,
  }

  switch (day?.status) {
    case DAY_STATUS.REGULAR:
      return { ...base, tone: CELL_TONE.REGULAR }
    case DAY_STATUS.OVERRIDE:
      return { ...base, tone: CELL_TONE.EXCEPTION, badge: 'Cambio', isException: true }
    case DAY_STATUS.DAY_OFF:
      return { ...base, tone: CELL_TONE.EXCEPTION, label: 'Libre', badge: 'Cambio', isException: true }
    case DAY_STATUS.REST:
      return { ...base, tone: CELL_TONE.REST, label: 'Descanso' }
    case DAY_STATUS.ABSENCE:
      return { ...base, tone: CELL_TONE.ABSENCE, label: getAbsenceTypeLabel(day.absence?.absence_type), isException: true }
    case DAY_STATUS.TERMINATED:
      return { ...base, tone: CELL_TONE.TERMINATED, label: 'Baja' }
    default:
      return { ...base, tone: CELL_TONE.EMPTY, label: 'Sin horario' }
  }
}

/** Texto accesible de una celda: «Lunes 2: 07:00–14:00 · 7 h». */
export function describeDayCell(header, view) {
  const what = view.shifts.length
    ? view.shifts.map(shift => `${shift.text}${shift.overnight ? ' (acaba al día siguiente)' : ''}`).join(', ')
    : view.label
  const parts = [
    what,
    view.badge ? view.badge.toLocaleLowerCase('es') : null,
    view.duration || null,
    view.hasConflict ? 'turnos solapados' : null,
    view.errors.length ? 'hora no válida' : null,
  ].filter(Boolean)
  const day = header.label.charAt(0).toLocaleUpperCase('es') + header.label.slice(1)
  return `${day} ${header.dayNumber}: ${parts.join(' · ')}`
}

/** «41 h», «0 h». */
export function formatPlanMinutes(minutes) {
  return formatDuration(minutes ?? 0)
}

// ---------------------------------------------------------------- Errores

const LOAD_MESSAGES = {
  [DB_ERROR_KIND.NETWORK]: 'Comprueba la conexión a Internet y vuelve a intentarlo.',
  [DB_ERROR_KIND.EXPIRED]: 'Tu sesión ha caducado. Vuelve a iniciar sesión para continuar.',
  [DB_ERROR_KIND.PERMISSION]: 'Esta cuenta no tiene permiso para consultar los horarios.',
}

/** Mensaje de error al cargar el calendario (nunca el mensaje técnico). */
export function getWeekPlanLoadMessage(feedback) {
  return LOAD_MESSAGES[feedback?.kind] ?? 'El servidor no ha respondido como se esperaba. Vuelve a intentarlo en unos minutos.'
}
