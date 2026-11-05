// Resumen de horas planificadas de una semana (vista «Resumen» de
// /horarios), sin dependencias de Nuxt ni de Supabase.
//
// No calcula nada por su cuenta: las horas planificadas salen de
// buildWeekPlan y la comparación con las horas extra, de
// buildPlannedVsOvertime (app/utils/schedules.js), que usa
// filterOvertimeEntries y sumDurationMinutes de horas extra.
//
// Las horas extra se muestran APARTE: no se suman a las planificadas, no
// cambian el horario y no son horas trabajadas comprobadas (se registran a
// mano). No hay cálculos de nómina, compensaciones ni fichajes.

import { getEmployeeFullName, sortEmployees } from './employees.js'
import { DAY_STATUS } from './schedules.js'
import { formatDuration } from './overtime.js'

/** Columnas mínimas de horas extra para el resumen (solo lectura). */
export const WEEK_OVERTIME_COLUMNS = 'id, employee_id, work_date, duration_minutes'

/** Parámetro de la URL con la vista de /horarios (?vista=resumen). */
export const VIEW_QUERY_KEY = 'vista'
export const SCHEDULE_VIEW = Object.freeze({
  CALENDAR: 'calendario',
  SUMMARY: 'resumen',
})

/** Situación de la planificación de una empleada en la semana. */
export const SUMMARY_STATUS = Object.freeze({
  // Tiene horas planificadas.
  PLANNED: 'planned',
  // Tiene planificación, pero de cero horas (descanso, libres, ausencias…).
  ZERO: 'zero',
  // No tiene planificación esa semana (sin horario, o de baja).
  NONE: 'none',
})

export function resolveViewParam(value) {
  const text = Array.isArray(value) ? value[0] : value
  return text === SCHEDULE_VIEW.SUMMARY ? SCHEDULE_VIEW.SUMMARY : SCHEDULE_VIEW.CALENDAR
}

/** Recuento de días de la semana por situación. */
export function countWeekDays(days) {
  const counts = { work: 0, rest: 0, dayOff: 0, absence: 0, terminated: 0, noSchedule: 0, changes: 0 }
  for (const day of days ?? []) {
    if (day.minutes > 0) counts.work++
    switch (day.status) {
      case DAY_STATUS.REST:
        counts.rest++
        break
      case DAY_STATUS.DAY_OFF:
        counts.dayOff++
        counts.changes++
        break
      case DAY_STATUS.OVERRIDE:
        counts.changes++
        break
      case DAY_STATUS.ABSENCE:
        counts.absence++
        break
      case DAY_STATUS.TERMINATED:
        counts.terminated++
        break
      case DAY_STATUS.NO_SCHEDULE:
        counts.noSchedule++
        break
      default:
        break
    }
  }
  return counts
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

/** «5 días con turnos · 1 libre · 2 de ausencia · 1 cambio». */
export function describeWeekDays(counts) {
  if (!counts) return ''
  return [
    counts.work ? plural(counts.work, 'día con turnos', 'días con turnos') : null,
    counts.rest ? plural(counts.rest, 'de descanso', 'de descanso') : null,
    counts.dayOff ? plural(counts.dayOff, 'libre', 'libres') : null,
    counts.absence ? plural(counts.absence, 'de ausencia', 'de ausencia') : null,
    counts.terminated ? plural(counts.terminated, 'de baja', 'de baja') : null,
    counts.changes ? plural(counts.changes, 'cambio de un día', 'cambios de un día') : null,
  ].filter(Boolean).join(' · ')
}

/**
 * Resumen de la semana: una fila por empleada visible en el calendario (y
 * por cualquier otra con horas extra registradas esa semana), con sus horas
 * planificadas, el desglose de días y, aparte, las horas extra registradas.
 *
 * @param {object} params
 * @param {object} params.plan resultado de buildWeekPlan
 * @param {object | null} params.comparison resultado de buildPlannedVsOvertime
 *   para la misma semana, o null si las horas extra no se han podido cargar
 */
export function buildWeekSummary({ plan, comparison = null }) {
  const byId = new Map((comparison?.rows ?? []).map(row => [row.employeeId, row]))
  const planIds = new Set((plan?.rows ?? []).map(row => row.employeeId))

  const fromPlan = (plan?.rows ?? []).map((row) => {
    const counts = countWeekDays(row.days)
    const status = !row.hasPlanning
      ? SUMMARY_STATUS.NONE
      : row.totalMinutes > 0 ? SUMMARY_STATUS.PLANNED : SUMMARY_STATUS.ZERO
    return {
      employeeId: row.employeeId,
      employee: row.employee,
      name: row.name,
      status,
      plannedMinutes: row.totalMinutes,
      counts,
      conflictCount: row.conflicts.length,
      errorCount: row.errorCount,
      overtimeMinutes: comparison ? (byId.get(row.employeeId)?.overtimeMinutes ?? 0) : null,
      overtimeCount: comparison ? (byId.get(row.employeeId)?.overtimeCount ?? 0) : null,
    }
  })

  // Empleadas que no salen en el calendario pero tienen horas extra esa semana.
  const onlyOvertime = (comparison?.rows ?? [])
    .filter(row => !planIds.has(row.employeeId) && row.overtimeCount > 0)
    .map(row => ({
      employeeId: row.employeeId,
      employee: row.employee,
      name: row.name ?? getEmployeeFullName(row.employee),
      status: SUMMARY_STATUS.NONE,
      plannedMinutes: 0,
      counts: null,
      conflictCount: 0,
      errorCount: 0,
      overtimeMinutes: row.overtimeMinutes,
      overtimeCount: row.overtimeCount,
    }))

  const order = new Map(sortEmployees([...fromPlan, ...onlyOvertime].map(row => ({ ...row.employee, id: row.employeeId })))
    .map((employee, index) => [employee.id, index]))
  const rows = [...fromPlan, ...onlyOvertime].sort((a, b) => order.get(a.employeeId) - order.get(b.employeeId))

  return {
    rows,
    plannedMinutes: plan?.totalMinutes ?? 0,
    overtimeMinutes: comparison ? rows.reduce((total, row) => total + (row.overtimeMinutes ?? 0), 0) : null,
    overtimeCount: comparison ? rows.reduce((total, row) => total + (row.overtimeCount ?? 0), 0) : null,
    withPlanning: rows.filter(row => row.status !== SUMMARY_STATUS.NONE).length,
    withoutPlanning: rows.filter(row => row.status === SUMMARY_STATUS.NONE).length,
  }
}

/** Texto de las horas planificadas de una fila: «35 h», «0 h» o «Sin planificación». */
export function describePlannedHours(row) {
  return row.status === SUMMARY_STATUS.NONE ? 'Sin planificación' : formatDuration(row.plannedMinutes)
}

/** Texto de las horas extra registradas: «1 h 30 min (2 registros)», «—». */
export function describeOvertime(row) {
  if (row.overtimeMinutes === null || row.overtimeMinutes === undefined) return ''
  if (!row.overtimeCount) return '—'
  return `${formatDuration(row.overtimeMinutes)} (${plural(row.overtimeCount, 'registro', 'registros')})`
}
