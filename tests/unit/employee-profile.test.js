import { describe, expect, it } from 'vitest'
import {
  PROFILE_SCHEDULE_STATE,
  VERSION_STATUS,
  describePeriod,
  describeWeeklyTotal,
  getEmployeeStatusInfo,
  getProfileSchedule,
  getScheduleHistory,
  getWeekRows,
  summarizeWeek,
} from '../../app/utils/employee-profile.js'

// Hoy: jueves 5 de noviembre de 2026.
const TODAY = '2026-11-05'
const s = (start, end) => ({ start, end })
const W1 = { 1: [s('07:00', '14:00')], 2: [s('07:00', '14:00')], 3: [s('07:00', '14:00')], 4: [s('07:00', '14:00')], 5: [s('07:00', '14:00')], 6: [s('07:00', '13:00')] }
const W2 = { 1: [s('17:00', '20:00'), s('08:00', '12:00')], 3: [s('22:00', '06:00')] }
const version = (validFrom, week = W1, kind = 'schedule') => ({ id: `v-${validFrom}`, valid_from: validFrom, kind, week: kind === 'end' ? null : week })
const active = { is_active: true }
const inactive = { is_active: false }

describe('getEmployeeStatusInfo', () => {
  it('activa, de baja con fecha y desactivada sin fecha', () => {
    expect(getEmployeeStatusInfo(active)).toMatchObject({ active: true, label: 'En activo' })
    expect(getEmployeeStatusInfo(inactive, '2026-10-31')).toEqual({ active: false, label: 'De baja', detail: 'Último día de trabajo: 31 oct 2026.' })
    expect(getEmployeeStatusInfo(inactive)).toEqual({ active: false, label: 'De baja', detail: 'No consta su último día de trabajo.' })
  })
})

describe('semana del horario habitual', () => {
  it('filas de lunes a domingo con turnos ordenados, descansos y horas nominales', () => {
    const rows = getWeekRows(W2)
    expect(rows.map(r => r.label)).toEqual(['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'])
    expect(rows[0]).toMatchObject({ weekday: 1, rest: false, minutes: 7 * 60 })
    expect(rows[0].shifts.map(x => x.start)).toEqual(['08:00', '17:00'])
    expect(rows[1]).toMatchObject({ rest: true, minutes: 0, shifts: [] })
    expect(rows[2].shifts).toEqual([{ start: '22:00', end: '06:00', overnight: true }])
    expect(rows[2].minutes).toBe(8 * 60)
  })

  it('resumen compacto agrupando días seguidos iguales', () => {
    expect(summarizeWeek(W1)).toBe('L–V 07:00–14:00 · S 07:00–13:00')
    expect(summarizeWeek(W2)).toBe('L 08:00–12:00, 17:00–20:00 · X 22:00–06:00')
    expect(summarizeWeek({ 1: [s('07:00', '14:00')], 3: [s('07:00', '14:00')] })).toBe('L 07:00–14:00 · X 07:00–14:00')
    expect(summarizeWeek({})).toBe('Descanso toda la semana')
  })

  it('total semanal', () => {
    expect(describeWeeklyTotal(W1)).toBe('41 h a la semana')
    expect(describeWeeklyTotal(W2)).toBe('15 h a la semana')
    expect(describeWeeklyTotal({})).toBe('0 h a la semana')
  })

  it('periodos', () => {
    expect(describePeriod({ from: '2026-11-02', to: null })).toBe('Desde el 2 nov 2026')
    expect(describePeriod({ from: '2026-09-01', to: '2026-10-31' })).toBe('Del 1 sept 2026 al 31 oct 2026')
  })
})

describe('getScheduleHistory', () => {
  it('de la más reciente a la más antigua, con su estado respecto a hoy', () => {
    const history = getScheduleHistory([version('2026-09-01'), version('2026-11-02', W2), version('2026-11-16'), version('2026-12-01', null, 'end')], TODAY)
    expect(history.map(h => [h.from, h.to, h.status, h.weekly])).toEqual([
      ['2026-12-01', null, VERSION_STATUS.FUTURE, false],
      ['2026-11-16', '2026-11-30', VERSION_STATUS.FUTURE, true],
      ['2026-11-02', '2026-11-15', VERSION_STATUS.CURRENT, true],
      ['2026-09-01', '2026-11-01', VERSION_STATUS.PAST, true],
    ])
  })

  it('versión que empieza hoy: vigente; que acabó ayer: pasada', () => {
    const history = getScheduleHistory([version('2026-10-01'), version(TODAY, W2)], TODAY)
    expect(history.map(h => h.status)).toEqual([VERSION_STATUS.CURRENT, VERSION_STATUS.PAST])
  })

  it('sin versiones: historial vacío', () => {
    expect(getScheduleHistory([], TODAY)).toEqual([])
  })
})

describe('getProfileSchedule', () => {
  it('activa con horario vigente', () => {
    const result = getProfileSchedule({ employee: active, versions: [version('2026-09-01', W2), version('2026-11-02')], today: TODAY })
    expect(result).toMatchObject({ state: PROFILE_SCHEDULE_STATE.CURRENT, period: { from: '2026-11-02', to: null }, upcoming: null })
    expect(result.version.valid_from).toBe('2026-11-02')
  })

  it('activa con horario vigente y otro que empieza más adelante', () => {
    const result = getProfileSchedule({ employee: active, versions: [version('2026-09-01'), version('2026-11-16', W2)], today: TODAY })
    expect(result).toMatchObject({ state: PROFILE_SCHEDULE_STATE.CURRENT, period: { from: '2026-09-01', to: '2026-11-15' } })
    expect(result.upcoming.valid_from).toBe('2026-11-16')
  })

  it('activa sin horario', () => {
    expect(getProfileSchedule({ employee: active, versions: [], today: TODAY })).toMatchObject({ state: PROFILE_SCHEDULE_STATE.NONE, version: null, upcoming: null })
  })

  it('activa con un horario que empieza más adelante (incorporación futura)', () => {
    const result = getProfileSchedule({ employee: active, versions: [version('2026-11-16')], today: TODAY })
    expect(result.state).toBe(PROFILE_SCHEDULE_STATE.NONE)
    expect(result.upcoming.valid_from).toBe('2026-11-16')
  })

  it('activa con el horario cerrado (volvió sin copiar su horario)', () => {
    const result = getProfileSchedule({ employee: active, versions: [version('2026-09-01'), version('2026-10-21', null, 'end')], today: TODAY })
    expect(result).toMatchObject({ state: PROFILE_SCHEDULE_STATE.CLOSED, closedFrom: '2026-10-21', upcoming: null })
  })

  it('activa con el horario cerrado y otro que empieza más adelante', () => {
    const result = getProfileSchedule({ employee: active, versions: [version('2026-09-01'), version('2026-10-21', null, 'end'), version('2026-11-09', W2)], today: TODAY })
    expect(result.state).toBe(PROFILE_SCHEDULE_STATE.CLOSED)
    expect(result.upcoming.valid_from).toBe('2026-11-09')
  })

  it('de baja: el último horario aplicable con sus fechas, hasta su último día', () => {
    const versions = [version('2026-06-01', W2), version('2026-09-01'), version('2026-11-01', null, 'end')]
    const result = getProfileSchedule({ employee: inactive, lastWorkingDate: '2026-10-31', versions, today: TODAY })
    expect(result).toMatchObject({ state: PROFILE_SCHEDULE_STATE.LAST_APPLICABLE, period: { from: '2026-09-01', to: '2026-10-31' } })
    expect(result.version.valid_from).toBe('2026-09-01')
  })

  it('de baja tras una reactivación anterior: el último horario semanal antes de la baja', () => {
    const versions = [version('2026-03-01', W2), version('2026-05-01', null, 'end'), version('2026-06-01'), version('2026-10-21', null, 'end')]
    const result = getProfileSchedule({ employee: inactive, lastWorkingDate: '2026-10-20', versions, today: TODAY })
    expect(result.period).toEqual({ from: '2026-06-01', to: '2026-10-20' })
  })

  it('de baja con un horario que se cerró antes de su último día', () => {
    const versions = [version('2026-06-01'), version('2026-08-01', null, 'end')]
    const result = getProfileSchedule({ employee: inactive, lastWorkingDate: '2026-10-20', versions, today: TODAY })
    expect(result.period).toEqual({ from: '2026-06-01', to: '2026-07-31' })
  })

  it('de baja sin horario nunca', () => {
    expect(getProfileSchedule({ employee: inactive, lastWorkingDate: '2026-10-20', versions: [], today: TODAY }).state).toBe(PROFILE_SCHEDULE_STATE.NEVER)
  })

  it('desactivada sin fecha (antes del módulo): su último horario, sin fecha de fin', () => {
    const result = getProfileSchedule({ employee: inactive, versions: [version('2026-06-01'), version('2026-12-01', W2)], today: TODAY })
    expect(result).toMatchObject({ state: PROFILE_SCHEDULE_STATE.LAST_APPLICABLE, period: { from: '2026-06-01', to: '2026-11-30' } })
  })
})
