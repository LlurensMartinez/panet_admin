// Lógica pura de la ficha de una empleada (/empleados/[id]): su estado y su
// horario habitual (vigente hoy, último aplicable si está de baja e historial
// de versiones). Sin dependencias de Nuxt ni de Supabase.
//
// Solo consulta: la ficha no edita horarios. Reutiliza las reglas de
// app/utils/schedules.js (una versión rige hasta el día antes de la siguiente;
// las de tipo «end» significan «sin horario desde esa fecha»).

import { formatDuration, getTodayDate } from './overtime.js'
import { formatLeaveDate } from './employee-leave.js'
import {
  SCHEDULE_KIND,
  getShiftNominalMinutes,
  getVersionForDate,
  getVersionPeriods,
  getWeekTemplateMinutes,
  getWeekdayShifts,
  isOvernightShift,
  sortShifts,
} from './schedules.js'
import { WEEKDAYS } from './suppliers.js'

/** Situación del horario habitual en la ficha. */
export const PROFILE_SCHEDULE_STATE = Object.freeze({
  // Activa y con un horario semanal vigente hoy.
  CURRENT: 'current',
  // Activa y sin horario hoy (nunca ha tenido o empieza más adelante).
  NONE: 'none',
  // Activa, pero su horario se cerró (por ejemplo, tras volver sin copiarlo).
  CLOSED: 'closed',
  // De baja o desactivada: se muestra su último horario aplicable.
  LAST_APPLICABLE: 'last_applicable',
  // De baja o desactivada y nunca tuvo horario.
  NEVER: 'never',
})

/** Estado de una versión respecto a hoy. */
export const VERSION_STATUS = Object.freeze({
  CURRENT: 'current',
  PAST: 'past',
  FUTURE: 'future',
})

const isWeekly = version => (version?.kind ?? SCHEDULE_KIND.SCHEDULE) === SCHEDULE_KIND.SCHEDULE

// ------------------------------------------------------------------ Estado

/**
 * Estado de la empleada para la ficha.
 *
 * @param {{ is_active?: boolean }} employee
 * @param {string | null} lastWorkingDate
 * @returns {{ active: boolean, label: string, detail: string }}
 */
export function getEmployeeStatusInfo(employee, lastWorkingDate = null) {
  if (employee?.is_active) return { active: true, label: 'En activo', detail: 'Aparece en la planificación y en el registro de horas extra.' }
  if (lastWorkingDate) {
    return { active: false, label: 'De baja', detail: `Último día de trabajo: ${formatLeaveDate(lastWorkingDate)}.` }
  }
  return { active: false, label: 'De baja', detail: 'No consta su último día de trabajo.' }
}

// ---------------------------------------------------------------- Semana

/**
 * Filas de lunes a domingo de una semana del horario habitual, con la
 * duración nominal de cada día (de reloj; las horas reales de cada fecha las
 * calcula el calendario).
 */
export function getWeekRows(week) {
  return WEEKDAYS.map(({ value, label, short, abbr }) => {
    const shifts = sortShifts(getWeekdayShifts(week, value)).map(shift => ({
      start: shift.start,
      end: shift.end,
      overnight: isOvernightShift(shift),
    }))
    return {
      weekday: value,
      label: label.charAt(0).toLocaleUpperCase('es') + label.slice(1),
      short,
      abbr,
      shifts,
      rest: shifts.length === 0,
      minutes: shifts.reduce((total, shift) => total + (getShiftNominalMinutes(shift) ?? 0), 0),
    }
  })
}

function describeShifts(shifts) {
  return shifts.map(shift => `${shift.start}–${shift.end}`).join(', ')
}

/**
 * Resumen compacto de una semana, agrupando días seguidos con los mismos
 * turnos: «L–V 07:00–14:00 · S 07:00–13:00». Sin turnos: «Descanso toda la
 * semana».
 */
export function summarizeWeek(week) {
  const rows = getWeekRows(week)
  const groups = []
  for (const row of rows) {
    if (row.rest) continue
    const text = describeShifts(row.shifts)
    const last = groups.at(-1)
    if (last && last.text === text && last.to.weekday === row.weekday - 1) last.to = row
    else groups.push({ from: row, to: row, text })
  }
  if (groups.length === 0) return 'Descanso toda la semana'
  return groups
    .map(group => `${group.from.short}${group.to !== group.from ? `–${group.to.short}` : ''} ${group.text}`)
    .join(' · ')
}

/** «41 h a la semana». */
export function describeWeeklyTotal(week) {
  return `${formatDuration(getWeekTemplateMinutes(week))} a la semana`
}

// ------------------------------------------------------------- Periodos

/** «Desde el 2 nov 2026», «Del 1 sep 2026 al 31 oct 2026». */
export function describePeriod({ from, to }) {
  return to ? `Del ${formatLeaveDate(from)} al ${formatLeaveDate(to)}` : `Desde el ${formatLeaveDate(from)}`
}

function getVersionStatus(period, today) {
  if (period.from > today) return VERSION_STATUS.FUTURE
  if (period.to && period.to < today) return VERSION_STATUS.PAST
  return VERSION_STATUS.CURRENT
}

/**
 * Historial de versiones del horario, de la más reciente a la más antigua,
 * con su periodo de vigencia y si es pasada, vigente o futura.
 */
export function getScheduleHistory(versions, today = getTodayDate()) {
  return getVersionPeriods(versions)
    .map(period => ({
      ...period,
      id: period.version.id ?? period.from,
      status: getVersionStatus(period, today),
      weekly: isWeekly(period.version),
    }))
    .reverse()
}

/**
 * Horario habitual que muestra la ficha.
 *
 *   - Activa: el horario vigente hoy; o, si no tiene, por qué (sin horario o
 *     cerrado) y, si lo hay, el próximo que empezará.
 *   - De baja o desactivada: el último horario semanal aplicable (el que
 *     regía en su último día de trabajo, o el último anterior), con sus
 *     fechas de vigencia. No se presenta como horario actual.
 *
 * @returns {{
 *   state: string, version: object | null, period: { from: string, to: string | null } | null,
 *   upcoming: object | null, closedFrom: string | null
 * }}
 */
export function getProfileSchedule({ employee, lastWorkingDate = null, versions = [], today = getTodayDate() }) {
  const periods = getVersionPeriods(versions)
  const periodOf = version => periods.find(period => period.version === version) ?? null
  const nextWeekly = from => periods.find(period => period.from > from && isWeekly(period.version))?.version ?? null
  const result = { version: null, period: null, upcoming: null, closedFrom: null }

  if (!employee?.is_active) {
    // Su último día de trabajo, o hoy si se desactivó sin fecha.
    const reference = lastWorkingDate ?? today
    const applicable = periods.filter(period => isWeekly(period.version) && period.from <= reference).at(-1)
    if (!applicable) return { ...result, state: PROFILE_SCHEDULE_STATE.NEVER }
    // Si sigue abierto, se cierra en su último día de trabajo.
    const to = applicable.to && (!lastWorkingDate || applicable.to < lastWorkingDate) ? applicable.to : lastWorkingDate
    return {
      ...result,
      state: PROFILE_SCHEDULE_STATE.LAST_APPLICABLE,
      version: applicable.version,
      period: { from: applicable.from, to },
    }
  }

  const current = getVersionForDate(versions, today)
  if (current && isWeekly(current)) {
    const period = periodOf(current)
    return { ...result, state: PROFILE_SCHEDULE_STATE.CURRENT, version: current, period: { from: period.from, to: period.to }, upcoming: period.to ? nextWeekly(period.from) : null }
  }
  if (current) {
    return { ...result, state: PROFILE_SCHEDULE_STATE.CLOSED, closedFrom: current.valid_from, upcoming: nextWeekly(current.valid_from) }
  }
  return { ...result, state: PROFILE_SCHEDULE_STATE.NONE, upcoming: nextWeekly('0000-00-00') }
}
