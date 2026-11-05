import { describe, expect, it } from 'vitest'
import {
  SCHEDULE_VIEW,
  SUMMARY_STATUS,
  buildWeekSummary,
  countWeekDays,
  describeOvertime,
  describePlannedHours,
  describeWeekDays,
  resolveViewParam,
} from '../../app/utils/week-summary.js'
import { buildPlannedVsOvertime, buildWeekPlan } from '../../app/utils/schedules.js'

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
const overtimeEntries = [
  { id: 'x1', employee_id: 'ana', work_date: '2026-11-03', duration_minutes: 45 },
  { id: 'x2', employee_id: 'ana', work_date: '2026-11-08', duration_minutes: 30 },
  { id: 'x3', employee_id: 'ana', work_date: '2026-11-09', duration_minutes: 60 }, // otra semana
  { id: 'x4', employee_id: 'fina', work_date: '2026-11-04', duration_minutes: 20 }, // no sale en el calendario
]

function summary({ withOvertime = true, date = '2026-11-02' } = {}) {
  const plan = buildWeekPlan({ employees, versions, overrides, absences, date, today: TODAY })
  const comparison = withOvertime
    ? buildPlannedVsOvertime({ employees, versions, overrides, absences, overtimeEntries, from: plan.dates[0], to: plan.dates[6] })
    : null
  return { plan, result: buildWeekSummary({ plan, comparison }) }
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

  it('horas extra de la misma semana, aparte de las planificadas', () => {
    const { result } = summary()
    expect(row(result, 'ana')).toMatchObject({ overtimeMinutes: 75, overtimeCount: 2 })
    expect(describeOvertime(row(result, 'ana'))).toBe('1 h 15 min (2 registros)')
    expect(row(result, 'berta')).toMatchObject({ overtimeMinutes: 0, overtimeCount: 0 })
    expect(describeOvertime(row(result, 'berta'))).toBe('—')
    // Las horas extra no se suman a las planificadas.
    expect(result.plannedMinutes).toBe((35 + 18 + 4 + 14) * 60)
    expect(result.overtimeMinutes).toBe(95)
    expect(result.overtimeCount).toBe(3)
  })

  it('incluye a quien no sale en el calendario pero tiene horas extra esa semana', () => {
    const { result } = summary()
    expect(row(result, 'fina')).toMatchObject({ status: SUMMARY_STATUS.NONE, plannedMinutes: 0, overtimeMinutes: 20, counts: null })
  })

  it('sin horas extra cargadas: solo las planificadas', () => {
    const { result } = summary({ withOvertime: false })
    expect(result.overtimeMinutes).toBeNull()
    expect(row(result, 'ana').overtimeMinutes).toBeNull()
    expect(describeOvertime(row(result, 'ana'))).toBe('')
    expect(row(result, 'fina')).toBeUndefined()
  })

  it('orden por nombre y recuentos', () => {
    const { result } = summary()
    expect(result.rows.map(r => r.employeeId)).toEqual(['ana', 'berta', 'carmen', 'dani', 'eva', 'fina'])
    expect(result.withPlanning).toBe(5)
    expect(result.withoutPlanning).toBe(1)
  })

  it('semana de cero horas para toda la tienda', () => {
    const plan = buildWeekPlan({ employees: [emp('eva', 'Eva')], versions: [version('eva', '2026-10-01', W1)], absences, date: '2026-11-02', today: TODAY })
    const result = buildWeekSummary({ plan, comparison: null })
    expect(result.plannedMinutes).toBe(0)
    expect(result.rows[0].status).toBe(SUMMARY_STATUS.ZERO)
  })

  it('sin plan: resumen vacío', () => {
    expect(buildWeekSummary({ plan: null })).toMatchObject({ rows: [], plannedMinutes: 0, overtimeMinutes: null })
  })

  it('countWeekDays y describeWeekDays sin datos', () => {
    expect(countWeekDays(null)).toEqual({ work: 0, rest: 0, dayOff: 0, absence: 0, terminated: 0, noSchedule: 0, changes: 0 })
    expect(describeWeekDays(null)).toBe('')
  })
})
