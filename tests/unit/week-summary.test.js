import { describe, expect, it } from 'vitest'
import {
  SCHEDULE_VIEW,
  SUMMARY_STATUS,
  buildWeekSummary,
  countWeekDays,
  describePlannedHours,
  describeWeekDays,
  resolveViewParam,
} from '../../app/utils/week-summary.js'
import { DAY_STATUS, TERMINATED_REASON, buildWeekPlan } from '../../app/utils/schedules.js'
import { getDayCellView } from '../../app/utils/week-calendar.js'

// Semana del lunes 2 al domingo 8 de noviembre de 2026; hoy, jueves 5.
const TODAY = '2026-11-05'
const s = (start, end) => ({ start, end })
const W1 = { 1: [s('07:00', '14:00')], 2: [s('07:00', '14:00')], 3: [s('07:00', '14:00')], 4: [s('07:00', '14:00')], 5: [s('07:00', '14:00')], 6: [s('07:00', '13:00')] }
const WLATE = { 3: [s('14:00', '21:00')], 4: [s('14:00', '21:00')], 5: [s('14:00', '21:00')] }
const emp = (id, first, extra = {}) => ({ id, first_name: first, last_name: 'X', is_active: true, last_working_date: null, ...extra })
const version = (employeeId, validFrom, week, kind = 'schedule') => ({ id: `v-${employeeId}-${validFrom}`, employee_id: employeeId, valid_from: validFrom, kind, week: kind === 'end' ? null : week })

const employees = [
  emp('ana', 'Ana'),
  emp('berta', 'Berta'),
  emp('carmen', 'Carmen'),
  emp('dani', 'Dani', { is_active: false, last_working_date: '2026-11-03' }),
  emp('eva', 'Eva'),
  emp('fina', 'Fina', { is_active: false }),
]
const versions = [
  // Ana: cambia de horario el miércoles.
  version('ana', '2026-10-01', W1),
  version('ana', '2026-11-04', WLATE),
  // Berta: horario normal con un libre, un cambio y vacaciones.
  version('berta', '2026-10-01', W1),
  // Dani: de baja el martes.
  version('dani', '2026-10-01', W1),
  version('dani', '2026-11-04', null, 'end'),
  // Eva: vacaciones toda la semana (planificación de cero horas).
  version('eva', '2026-10-01', W1),
]
const overrides = [
  { id: 'o1', employee_id: 'berta', work_date: '2026-11-03', shifts: [] },
  { id: 'o2', employee_id: 'berta', work_date: '2026-11-05', shifts: [s('10:00', '14:00')] },
  // Carmen: sin horario, solo un cambio puntual.
  { id: 'o3', employee_id: 'carmen', work_date: '2026-11-02', shifts: [s('09:00', '13:00')] },
]
const absences = [
  { id: 'a1', employee_id: 'berta', absence_type: 'vacation', start_date: '2026-11-06', end_date: '2026-11-07' },
  { id: 'a2', employee_id: 'eva', absence_type: 'vacation', start_date: '2026-11-01', end_date: '2026-11-10' },
]
function summary({ date = '2026-11-02' } = {}) {
  const plan = buildWeekPlan({ employees, versions, overrides, absences, date, today: TODAY })
  return { plan, result: buildWeekSummary({ plan }) }
}
const row = (result, id) => result.rows.find(r => r.employeeId === id)

describe('vista', () => {
  it('?vista=resumen o calendario por defecto', () => {
    expect(resolveViewParam('resumen')).toBe(SCHEDULE_VIEW.SUMMARY)
    expect(resolveViewParam(['resumen'])).toBe(SCHEDULE_VIEW.SUMMARY)
    expect(resolveViewParam(undefined)).toBe(SCHEDULE_VIEW.CALENDAR)
    expect(resolveViewParam('otra')).toBe(SCHEDULE_VIEW.CALENDAR)
  })
})

describe('buildWeekSummary', () => {
  it('totales por empleada y de la tienda (los mismos que el calendario)', () => {
    const { plan, result } = summary()
    expect(row(result, 'ana').plannedMinutes).toBe(14 * 60 + 21 * 60)
    expect(row(result, 'berta').plannedMinutes).toBe(7 * 60 + 7 * 60 + 4 * 60)
    expect(row(result, 'carmen').plannedMinutes).toBe(4 * 60)
    expect(row(result, 'dani').plannedMinutes).toBe(14 * 60)
    expect(result.plannedMinutes).toBe(plan.totalMinutes)
    expect(result.plannedMinutes).toBe((35 + 18 + 4 + 14) * 60)
  })

  it('cambio de horario a mitad de semana', () => {
    const { result } = summary()
    expect(row(result, 'ana').counts).toMatchObject({ work: 5, rest: 2, changes: 0 })
    expect(describeWeekDays(row(result, 'ana').counts)).toBe('5 días con turnos · 2 de descanso')
  })

  it('días libres, cambios puntuales y ausencias', () => {
    const { result } = summary()
    expect(row(result, 'berta').counts).toMatchObject({ work: 3, dayOff: 1, absence: 2, changes: 2, rest: 1 })
    expect(describeWeekDays(row(result, 'berta').counts)).toBe('3 días con turnos · 1 de descanso · 1 libre · 2 de ausencia · 2 cambios de un día')
  })

  it('de baja durante la semana', () => {
    const { result } = summary()
    expect(row(result, 'dani')).toMatchObject({ status: SUMMARY_STATUS.PLANNED, plannedMinutes: 14 * 60 })
    expect(row(result, 'dani').counts).toMatchObject({ work: 2, terminated: 5 })
  })

  it('sin horario pero con planificación puntual', () => {
    const { result } = summary()
    expect(row(result, 'carmen')).toMatchObject({ status: SUMMARY_STATUS.PLANNED, plannedMinutes: 240 })
    expect(row(result, 'carmen').counts).toMatchObject({ work: 1, noSchedule: 6, changes: 1 })
  })

  it('planificación de cero horas frente a sin planificación', () => {
    const { result } = summary()
    expect(row(result, 'eva')).toMatchObject({ status: SUMMARY_STATUS.ZERO, plannedMinutes: 0 })
    expect(describePlannedHours(row(result, 'eva'))).toBe('0 h')
    expect(describeWeekDays(row(result, 'eva').counts)).toBe('7 de ausencia')
    // Una semana futura sin horario para Carmen: sin planificación.
    const later = summary({ date: '2026-11-16' })
    expect(row(later.result, 'carmen')).toMatchObject({ status: SUMMARY_STATUS.NONE, plannedMinutes: 0 })
    expect(describePlannedHours(row(later.result, 'carmen'))).toBe('Sin planificación')
  })

  it('no incluye horas extra (la comparación está preparada, pero no se muestra)', () => {
    const { result } = summary()
    expect(result).not.toHaveProperty('overtimeMinutes')
    expect(row(result, 'ana')).not.toHaveProperty('overtimeMinutes')
    // Fina (de baja, sin planificación) no sale en el calendario ni en el resumen.
    expect(row(result, 'fina')).toBeUndefined()
  })

  it('no modifica los datos de partida', () => {
    const input = JSON.stringify({ employees, versions, overrides, absences })
    const { plan } = summary()
    const planCopy = JSON.stringify(plan)
    buildWeekSummary({ plan })
    expect(JSON.stringify({ employees, versions, overrides, absences })).toBe(input)
    expect(JSON.stringify(plan)).toBe(planCopy)
  })

  it('orden por nombre y recuentos', () => {
    const { result } = summary()
    expect(result.rows.map(r => r.employeeId)).toEqual(['ana', 'berta', 'carmen', 'dani', 'eva'])
    expect(result.withPlanning).toBe(5)
    expect(result.withoutPlanning).toBe(0)
  })

  it('semana de cero horas para toda la tienda', () => {
    const plan = buildWeekPlan({ employees: [emp('eva', 'Eva')], versions: [version('eva', '2026-10-01', W1)], absences, date: '2026-11-02', today: TODAY })
    const result = buildWeekSummary({ plan })
    expect(result.plannedMinutes).toBe(0)
    expect(result.rows[0].status).toBe(SUMMARY_STATUS.ZERO)
  })

  it('sin plan: resumen vacío', () => {
    expect(buildWeekSummary({ plan: null })).toMatchObject({ rows: [], plannedMinutes: 0, withPlanning: 0 })
  })

  it('countWeekDays y describeWeekDays sin datos', () => {
    expect(countWeekDays(null)).toEqual({ work: 0, rest: 0, dayOff: 0, absence: 0, terminated: 0, closedSchedule: 0, noSchedule: 0, changes: 0 })
    expect(describeWeekDays(null)).toBe('')
  })
})

describe('horario cerrado frente a baja', () => {
  const plan = (employee, list, date = '2026-11-02') => buildWeekPlan({ employees: [employee], versions: list, date, today: TODAY })
  const days = (employee, list, date) => plan(employee, list, date).rows[0]?.days ?? []

  it('activa con el horario cerrado y sin versión posterior: «Horario cerrado», no baja', () => {
    const gema = emp('gema', 'Gema')
    const list = [version('gema', '2026-10-01', W1), version('gema', '2026-11-04', null, 'end')]
    const week = days(gema, list)
    expect(week[3]).toMatchObject({ status: DAY_STATUS.TERMINATED, terminatedReason: TERMINATED_REASON.CLOSED_SCHEDULE })
    expect(getDayCellView(week[3]).label).toBe('Horario cerrado')
    const counts = countWeekDays(week)
    expect(counts).toMatchObject({ work: 2, closedSchedule: 5, terminated: 0 })
    expect(describeWeekDays(counts)).toBe('2 días con turnos · 5 con horario cerrado')
    // Una semana entera con el horario cerrado: sin planificación, no 0 h.
    const later = buildWeekSummary({ plan: plan(gema, list, '2026-11-09') })
    expect(later.rows[0]).toMatchObject({ status: SUMMARY_STATUS.NONE })
    expect(describeWeekDays(later.rows[0].counts)).toBe('7 con horario cerrado')
  })

  it('de baja (después del último día): sigue siendo «Baja»', () => {
    const week = days(employees[3], versions.filter(v => v.employee_id === 'dani'))
    expect(week[3]).toMatchObject({ status: DAY_STATUS.TERMINATED, terminatedReason: TERMINATED_REASON.AFTER_LAST_DAY })
    expect(getDayCellView(week[3]).label).toBe('Baja')
    expect(countWeekDays(week)).toMatchObject({ terminated: 5, closedSchedule: 0 })
  })

  it('desactivada sin último día y con el horario cerrado: «Baja»', () => {
    const hana = emp('hana', 'Hana', { is_active: false })
    const list = [version('hana', '2026-10-01', W1), version('hana', '2026-11-04', null, 'end')]
    const week = days(hana, list)
    expect(week[3]).toMatchObject({ status: DAY_STATUS.TERMINATED, terminatedReason: TERMINATED_REASON.LEAVE_PERIOD })
    expect(getDayCellView(week[3]).label).toBe('Baja')
  })

  it('reactivada con un horario nuevo: el periodo de baja anterior sigue siendo «Baja»', () => {
    const irene = emp('irene', 'Irene')
    const list = [version('irene', '2026-10-01', W1), version('irene', '2026-11-03', null, 'end'), version('irene', '2026-11-06', W1)]
    const week = days(irene, list)
    expect(week.map(d => d.status)).toEqual([
      DAY_STATUS.REGULAR, DAY_STATUS.TERMINATED, DAY_STATUS.TERMINATED, DAY_STATUS.TERMINATED, DAY_STATUS.REGULAR, DAY_STATUS.REGULAR, DAY_STATUS.REST,
    ])
    expect(week[1].terminatedReason).toBe(TERMINATED_REASON.LEAVE_PERIOD)
    expect(getDayCellView(week[1]).label).toBe('Baja')
    expect(countWeekDays(week)).toMatchObject({ terminated: 3, closedSchedule: 0 })
  })
})
