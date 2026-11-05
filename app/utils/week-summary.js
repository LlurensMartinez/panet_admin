// Resumen de horas planificadas de una semana (vista «Resumen» de
// /horarios), sin dependencias de Nuxt ni de Supabase.
//
// No calcula nada por su cuenta: las horas planificadas salen de
// buildWeekPlan (app/utils/schedules.js). La comparación con las horas extra
// registradas está preparada en buildPlannedVsOvertime (schedules.js), pero
// todavía no se muestra (SPEC.md, 3.9). No hay cálculos de nómina,
// compensaciones ni fichajes.

import { DAY_STATUS, TERMINATED_REASON } from './schedules.js'
import { formatDuration } from './overtime.js'

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
  // No tiene planificación esa semana (sin horario, horario cerrado o de baja).
  NONE: 'none',
})

export function resolveViewParam(value) {
  const text = Array.isArray(value) ? value[0] : value
  return text === SCHEDULE_VIEW.SUMMARY ? SCHEDULE_VIEW.SUMMARY : SCHEDULE_VIEW.CALENDAR
}

/** Recuento de días de la semana por situación. */
export function countWeekDays(days) {
  const counts = { work: 0, rest: 0, dayOff: 0, absence: 0, terminated: 0, closedSchedule: 0, noSchedule: 0, changes: 0 }
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
        // El horario cerrado de una empleada activa no es una baja.
        if (day.terminatedReason === TERMINATED_REASON.CLOSED_SCHEDULE) counts.closedSchedule++
        else counts.terminated++
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

/** «5 días con turnos · 1 libre · 2 de ausencia · 1 cambio de un día». */
export function describeWeekDays(counts) {
  if (!counts) return ''
  return [
    counts.work ? plural(counts.work, 'día con turnos', 'días con turnos') : null,
    counts.rest ? plural(counts.rest, 'de descanso', 'de descanso') : null,
    counts.dayOff ? plural(counts.dayOff, 'libre', 'libres') : null,
    counts.absence ? plural(counts.absence, 'de ausencia', 'de ausencia') : null,
    counts.terminated ? plural(counts.terminated, 'de baja', 'de baja') : null,
    counts.closedSchedule ? plural(counts.closedSchedule, 'con horario cerrado', 'con horario cerrado') : null,
    counts.changes ? plural(counts.changes, 'cambio de un día', 'cambios de un día') : null,
  ].filter(Boolean).join(' · ')
}

/**
 * Resumen de la semana: una fila por empleada visible en el calendario (en
 * el mismo orden), con sus horas planificadas y el desglose de días.
 *
 * @param {object} params
 * @param {object} params.plan resultado de buildWeekPlan
 */
export function buildWeekSummary({ plan }) {
  const rows = (plan?.rows ?? []).map((row) => {
    const status = !row.hasPlanning
      ? SUMMARY_STATUS.NONE
      : row.totalMinutes > 0 ? SUMMARY_STATUS.PLANNED : SUMMARY_STATUS.ZERO
    return {
      employeeId: row.employeeId,
      employee: row.employee,
      name: row.name,
      status,
      plannedMinutes: row.totalMinutes,
      counts: countWeekDays(row.days),
      conflictCount: row.conflicts.length,
      errorCount: row.errorCount,
    }
  })

  return {
    rows,
    plannedMinutes: plan?.totalMinutes ?? 0,
    withPlanning: rows.filter(row => row.status !== SUMMARY_STATUS.NONE).length,
    withoutPlanning: rows.filter(row => row.status === SUMMARY_STATUS.NONE).length,
  }
}

/** Texto de las horas planificadas de una fila: «35 h», «0 h» o «Sin planificación». */
export function describePlannedHours(row) {
  return row.status === SUMMARY_STATUS.NONE ? 'Sin planificación' : formatDuration(row.plannedMinutes)
}
