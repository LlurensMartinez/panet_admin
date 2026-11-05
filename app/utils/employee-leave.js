// Lógica pura de la baja y la reactivación de empleadas con fecha (sin
// dependencias de Nuxt ni de Supabase) para poder probarla con pruebas
// unitarias. Ver SPEC.md (3.6) y DATA_MODEL.md («Baja y reactivación»).
//
// La vista previa de la baja aplica las MISMAS condiciones que
// public.deactivate_employee():
//   - se elimina solo la planificación posterior a hoy (versiones del horario,
//     cambios de un día y ausencias que empiezan después de hoy);
//   - las ausencias en curso se acortan hasta hoy;
//   - si tenía horario, se cierra desde el día siguiente al último día;
//   - nunca se tocan horarios vigentes o pasados ni horas extra.
//
// Las empleadas sin ninguna planificación se siguen desactivando y activando
// con una sola actualización de `employees`, como antes del módulo de
// horarios (la base de datos lo permite y es igual de atómico).

import { DB_ERROR_KIND, classifyDatabaseError } from './database-errors.js'
import { addDaysToDate, formatDuration, formatWorkDate, getTodayDate, isValidDate } from './overtime.js'
import { ABSENCE_TYPES, SCHEDULE_KIND, getVersionForDate, getWeekStart, getWeekTemplateMinutes, sortScheduleVersions } from './schedules.js'

export const LEAVE_EMPLOYEE_COLUMNS = 'id, is_active, last_working_date'
export const LEAVE_SCHEDULE_COLUMNS = 'id, employee_id, valid_from, kind, week'
export const LEAVE_OVERRIDE_COLUMNS = 'id, employee_id, work_date, shifts'
export const LEAVE_ABSENCE_COLUMNS = 'id, employee_id, absence_type, start_date, end_date'

/** Qué hará la reactivación con el horario. */
export const REACTIVATION_OUTCOME = Object.freeze({
  // Vuelve el día en que se cerraba su horario y el cierre no ha empezado:
  // se quita el cierre y sigue su horario anterior.
  RESTORE: 'restore',
  // Se copia su último horario habitual desde la fecha de vuelta.
  COPY: 'copy',
  // Queda sin horario hasta que se le configure uno.
  NONE: 'none',
  // Su horario no estaba cerrado: sigue igual.
  CONTINUES: 'continues',
})

// ------------------------------------------------------------------ Textos

/** «27 oct 2026». */
export function formatLeaveDate(date) {
  return formatWorkDate(date, 'compact')
}

export function getAbsenceTypeLabel(type) {
  return ABSENCE_TYPES.find(item => item.value === type)?.label ?? 'Ausencia'
}

/** «Libre» o «07:00–14:00 · 17:00–20:00». */
export function describeDayShifts(shifts) {
  const list = Array.isArray(shifts) ? shifts : []
  return list.length === 0 ? 'Libre' : list.map(shift => `${shift.start}–${shift.end}`).join(' · ')
}

/** «del 3 nov 2026 al 15 nov 2026» o «el 3 nov 2026». */
export function describeDateRange(from, to) {
  return from === to ? `el ${formatLeaveDate(from)}` : `del ${formatLeaveDate(from)} al ${formatLeaveDate(to)}`
}

// -------------------------------------------------------- Planificación

/** true si la empleada tiene alguna versión de horario, cambio de un día o ausencia. */
export function hasPlanning({ versions = [], overrides = [], absences = [] } = {}) {
  return versions.length > 0 || overrides.length > 0 || absences.length > 0
}

/** true si tiene algún horario semanal (versión de tipo «schedule»). */
export function hasWeeklySchedule(versions) {
  return (versions ?? []).some(version => (version.kind ?? SCHEDULE_KIND.SCHEDULE) === SCHEDULE_KIND.SCHEDULE)
}

/** Último horario semanal registrado (la versión «schedule» más reciente), o null. */
export function getLastWeeklySchedule(versions) {
  return sortScheduleVersions(versions)
    .filter(version => (version.kind ?? SCHEDULE_KIND.SCHEDULE) === SCHEDULE_KIND.SCHEDULE)
    .at(-1) ?? null
}

// ---------------------------------------------------------------- Baja

/**
 * Comprueba el último día de trabajo. Mismas reglas que
 * public.deactivate_employee(): no puede ser posterior a hoy, ni anterior a un
 * horario que ya haya empezado (porque ese horario es historial y no se borra).
 *
 * @returns {string | null} mensaje de error
 */
export function validateLastWorkingDate({ lastWorkingDate, versions = [], today = getTodayDate() }) {
  if (!isValidDate(lastWorkingDate)) return 'Indica una fecha válida.'
  if (lastWorkingDate > today) return 'El último día de trabajo no puede ser posterior a hoy.'
  const blocking = sortScheduleVersions(versions)
    .find(version => version.valid_from > lastWorkingDate && version.valid_from <= today)
  if (blocking) {
    return `Tiene un horario que empezó el ${formatLeaveDate(blocking.valid_from)}, después de esa fecha. Elige el ${formatLeaveDate(blocking.valid_from)} o un día posterior.`
  }
  return null
}

/**
 * Vista previa de la baja: qué se eliminará, qué se acorta y qué se conserva.
 *
 * @param {object} params
 * @param {object[]} params.versions versiones del horario de la empleada
 * @param {object[]} params.overrides cambios de un día de la empleada
 * @param {object[]} params.absences ausencias de la empleada
 * @param {string} params.lastWorkingDate último día de trabajo (incluido)
 * @param {string} [params.today] hoy en Europe/Madrid
 */
export function buildDeactivationPreview({ versions = [], overrides = [], absences = [], lastWorkingDate, today = getTodayDate() }) {
  const error = validateLastWorkingDate({ lastWorkingDate, versions, today })
  const sortedVersions = sortScheduleVersions(versions)
  const byDate = key => (a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0)

  const removedVersions = sortedVersions.filter(version => version.valid_from > today)
  const removedOverrides = overrides.filter(item => item.work_date > today).sort(byDate('work_date'))
  const removedAbsences = absences.filter(item => item.start_date > today).sort(byDate('start_date'))
  const shortenedAbsences = absences
    .filter(item => item.start_date <= today && item.end_date > today)
    .sort(byDate('start_date'))
    .map(absence => ({ absence, newEndDate: today }))

  // Se conserva todo lo demás. Lo que cae entre el día siguiente al último
  // día y hoy se conserva pero ya no cuenta (es posterior a la baja).
  const keptVersions = sortedVersions.filter(version => version.valid_from <= today)
  const keptOverrides = overrides.filter(item => item.work_date <= today)
  const keptAbsences = absences.filter(item => item.start_date <= today)
  const valid = !error
  const ignoredOverrides = valid ? keptOverrides.filter(item => item.work_date > lastWorkingDate).length : 0
  const ignoredAbsences = valid ? keptAbsences.filter(item => item.start_date > lastWorkingDate).length : 0
  const ignoredAfterLastDay = ignoredOverrides + ignoredAbsences

  // Horario que regía al día siguiente del último día, sin las versiones que
  // se eliminan: si es semanal, se cierra.
  const nextDay = valid ? addDaysToDate(lastWorkingDate, 1) : null
  const current = valid ? getVersionForDate(keptVersions, nextDay) : null
  const closesScheduleFrom = current && (current.kind ?? SCHEDULE_KIND.SCHEDULE) === SCHEDULE_KIND.SCHEDULE ? nextDay : null

  return {
    error,
    lastWorkingDate,
    today,
    hasPlanning: hasPlanning({ versions, overrides, absences }),
    removed: { versions: removedVersions, overrides: removedOverrides, absences: removedAbsences },
    removedCount: removedVersions.length + removedOverrides.length + removedAbsences.length,
    shortened: shortenedAbsences,
    kept: {
      versions: keptVersions.length,
      overrides: keptOverrides.length,
      absences: keptAbsences.length,
      ignoredAfterLastDay,
    },
    closesScheduleFrom,
  }
}

/** Resumen de una baja ya hecha (respuesta de public.deactivate_employee). */
export function describeDeactivationResult(result) {
  if (!result) return 'Su ficha y su historial se conservan en «Inactivos».'
  const removed = (result.deleted_schedules ?? 0) + (result.deleted_day_changes ?? 0) + (result.deleted_absences ?? 0)
  const parts = [`Último día: ${formatLeaveDate(result.last_working_date)}.`]
  if (removed > 0) parts.push(removed === 1 ? 'Se ha eliminado 1 elemento de su planificación futura.' : `Se han eliminado ${removed} elementos de su planificación futura.`)
  if (result.shortened_absences > 0) parts.push(result.shortened_absences === 1 ? 'Se ha acortado 1 ausencia.' : `Se han acortado ${result.shortened_absences} ausencias.`)
  parts.push('Su historial se conserva.')
  return parts.join(' ')
}

// -------------------------------------------------------- Reactivación

/**
 * Fecha de vuelta propuesta: el lunes que viene, o el día siguiente al último
 * día de trabajo si es más tarde.
 */
export function getDefaultReturnDate({ lastWorkingDate = null, today = getTodayDate() } = {}) {
  const nextMonday = addDaysToDate(getWeekStart(today), 7)
  const dayAfter = lastWorkingDate ? addDaysToDate(lastWorkingDate, 1) : null
  return dayAfter && dayAfter > nextMonday ? dayAfter : nextMonday
}

/**
 * Qué hará la reactivación, con las mismas reglas que
 * public.reactivate_employee() y los triggers de employee_schedules.
 *
 * @returns {{
 *   error: string | null, outcome: string | null, schedule: object | null,
 *   weeklyMinutes: number, returnDate: string
 * }}
 */
export function buildReactivationPlan({ versions = [], lastWorkingDate = null, returnDate, copySchedule = true, today = getTodayDate() }) {
  const schedule = getLastWeeklySchedule(versions)
  const base = { returnDate, schedule, weeklyMinutes: schedule ? getWeekTemplateMinutes(schedule.week) : 0, outcome: null }

  if (!isValidDate(returnDate)) return { ...base, error: 'Indica una fecha de vuelta válida.' }
  if (lastWorkingDate && returnDate <= lastWorkingDate) {
    return { ...base, error: `La fecha de vuelta debe ser posterior a su último día de trabajo (${formatLeaveDate(lastWorkingDate)}).` }
  }

  const current = getVersionForDate(versions, returnDate)
  const currentIsEnd = current?.kind === SCHEDULE_KIND.END
  if (currentIsEnd && current.valid_from === returnDate && current.valid_from > today) {
    return { ...base, error: null, outcome: REACTIVATION_OUTCOME.RESTORE }
  }
  if (current && !currentIsEnd) return { ...base, error: null, outcome: REACTIVATION_OUTCOME.CONTINUES }
  if (!copySchedule || !schedule) return { ...base, error: null, outcome: REACTIVATION_OUTCOME.NONE }

  const monday = getWeekStart(today)
  if (returnDate < monday) {
    return { ...base, error: `Para copiar su horario, la vuelta no puede ser antes del lunes ${formatLeaveDate(monday)}.` }
  }
  const latest = sortScheduleVersions(versions).at(-1)
  if (latest && returnDate <= latest.valid_from) {
    return { ...base, error: `Ya tiene un horario registrado desde el ${formatLeaveDate(latest.valid_from)}. Elige una fecha de vuelta posterior.` }
  }
  return { ...base, error: null, outcome: REACTIVATION_OUTCOME.COPY }
}

/** Texto que explica lo que pasará con el horario al reactivar. */
export function describeReactivationOutcome(plan) {
  switch (plan?.outcome) {
    case REACTIVATION_OUTCOME.RESTORE:
      return 'Vuelve justo al día siguiente de su último día: se anula la baja y sigue con su horario de antes.'
    case REACTIVATION_OUTCOME.COPY:
      return `Desde el ${formatLeaveDate(plan.returnDate)} tendrá su último horario habitual (${formatDuration(plan.weeklyMinutes)} a la semana). El periodo de baja queda sin horario.`
    case REACTIVATION_OUTCOME.CONTINUES:
      return 'Su horario habitual no se había cerrado: sigue igual.'
    case REACTIVATION_OUTCOME.NONE:
      return 'Quedará sin horario hasta que le configures uno. El periodo de baja queda sin horario.'
    default:
      return ''
  }
}

// ------------------------------------------------------------- Errores

const DEFAULT_MESSAGES = {
  load: 'No se ha podido comprobar su planificación. Vuelve a intentarlo.',
  deactivate: 'No se ha podido cambiar el estado. Vuelve a intentarlo.',
  reactivate: 'No se ha podido cambiar el estado. Vuelve a intentarlo.',
}

const NETWORK_MESSAGES = {
  load: 'No se ha podido comprobar su planificación. Comprueba la conexión a Internet y vuelve a intentarlo.',
  deactivate: 'No se ha podido cambiar el estado. Comprueba la conexión a Internet y vuelve a intentarlo.',
  reactivate: 'No se ha podido cambiar el estado. Comprueba la conexión a Internet y vuelve a intentarlo.',
}

// La función o la columna no existen: falta la migración de horarios.
const MISSING_CODES = new Set(['PGRST202', '42883', '42703'])

/**
 * Mensaje comprensible para un error de la baja o la reactivación (nunca el
 * mensaje técnico). Reconoce los códigos PS0xx de la migración de horarios.
 *
 * @param {{ error?: any, status?: number }} response
 * @param {'load' | 'deactivate' | 'reactivate'} action
 * @param {{ today?: string }} [options]
 */
export function getLeaveErrorFeedback(response, action, { today = getTodayDate() } = {}) {
  const code = String(response?.error?.code ?? '')
  const detail = String(response?.error?.details ?? response?.error?.detail ?? '')
  const date = isValidDate(detail) ? detail : null
  const message = (text, kind = DB_ERROR_KIND.VALIDATION) => ({ kind, message: text })

  switch (code) {
    case 'PS001':
      return message(date
        ? `Ya tiene un horario registrado desde el ${formatLeaveDate(date)}. Elige una fecha de vuelta posterior.`
        : 'Ya tiene un horario registrado en esa fecha o después. Elige una fecha de vuelta posterior.')
    case 'PS002':
      return message(date
        ? `Para copiar su horario, la vuelta no puede ser antes del lunes ${formatLeaveDate(date)}.`
        : 'Para copiar su horario, la vuelta no puede ser anterior a esta semana.')
    case 'PS003':
      return message('Su horario se solaparía con un turno nocturno del día anterior. Elige otra fecha de vuelta o no copies el horario.')
    case 'PS006':
      return message('La planificación de esta empleada no se puede modificar mientras esté desactivada.')
    case 'PS007':
      if (action === 'reactivate') {
        return message(date
          ? `La fecha de vuelta debe ser posterior a su último día de trabajo (${formatLeaveDate(date)}).`
          : 'La fecha de vuelta debe ser posterior a su último día de trabajo.')
      }
      if (!date || date === today) return message('El último día de trabajo no puede ser posterior a hoy.')
      return message(`Tiene un horario que empezó el ${formatLeaveDate(date)}, después de esa fecha. Elige el ${formatLeaveDate(date)} o un día posterior.`)
    case 'PS008':
      return message(action === 'reactivate'
        ? 'Esta empleada ya está activa. Recarga la lista para ver su estado actual.'
        : 'Esta empleada ya está dada de baja. Recarga la lista para ver su estado actual.', DB_ERROR_KIND.NOT_FOUND)
    case 'PS009':
      return message('Esta empleada tiene horarios registrados. Cierra este aviso y vuelve a abrir la baja para revisar qué se eliminará.')
    case 'PS010':
      return message('No se ha podido cerrar o reabrir su horario. Recarga la lista y vuelve a intentarlo.')
    case 'P0002':
      return message('No se ha encontrado esta empleada. Recarga la lista para ver los datos actuales.', DB_ERROR_KIND.NOT_FOUND)
    case '22004':
      return message('Falta la fecha.')
    default:
      break
  }

  if (MISSING_CODES.has(code)) {
    return message('La base de datos aún no está preparada para los horarios: falta aplicar su migración (SUPABASE_SETUP.md, sección 14).', DB_ERROR_KIND.MISSING)
  }

  const kind = classifyDatabaseError(response) ?? DB_ERROR_KIND.UNKNOWN
  switch (kind) {
    case DB_ERROR_KIND.NETWORK:
      return message(NETWORK_MESSAGES[action] ?? NETWORK_MESSAGES.deactivate, kind)
    case DB_ERROR_KIND.EXPIRED:
      return message('Tu sesión ha caducado. Vuelve a iniciar sesión para continuar.', kind)
    case DB_ERROR_KIND.PERMISSION:
      return message('Esta cuenta no tiene permiso para gestionar empleados.', kind)
    case DB_ERROR_KIND.MISSING:
      return message('La base de datos aún no está preparada para los horarios: falta aplicar su migración (SUPABASE_SETUP.md, sección 14).', kind)
    case DB_ERROR_KIND.NOT_FOUND:
      return message('No se ha encontrado esta empleada. Recarga la lista para ver los datos actuales.', kind)
    default:
      return message(DEFAULT_MESSAGES[action] ?? DEFAULT_MESSAGES.deactivate, kind === DB_ERROR_KIND.VALIDATION ? kind : DB_ERROR_KIND.UNKNOWN)
  }
}
