import { describe, expect, it } from 'vitest'
import {
  CELL_TONE,
  describeDayCell,
  describeWeekRange,
  describeWeekRelation,
  formatLongDay,
  getDayCellView,
  getDayHeaders,
  getDefaultSelectedDate,
  getWeekPlanLoadMessage,
  resolveWeekParam,
  shiftWeekStart,
} from '../../app/utils/week-calendar.js'
import { DAY_STATUS, buildWeekPlan, getWeekDates } from '../../app/utils/schedules.js'

const TODAY = '2026-11-05'
const s = (start, end) => ({ start, end })

describe('semanas', () => {
  it('lunes de la semana de la URL, o de la semana actual', () => {
    expect(resolveWeekParam('2026-11-12', TODAY)).toBe('2026-11-09')
    expect(resolveWeekParam(['2026-11-02'], TODAY)).toBe('2026-11-02')
    expect(resolveWeekParam(undefined, TODAY)).toBe('2026-11-02')
    expect(resolveWeekParam('2026-02-30', TODAY)).toBe('2026-11-02')
    expect(resolveWeekParam('basura', TODAY)).toBe('2026-11-02')
  })

  it('semana anterior y siguiente', () => {
    expect(shiftWeekStart('2026-11-02', -1)).toBe('2026-10-26')
    expect(shiftWeekStart('2026-11-02', 1)).toBe('2026-11-09')
    expect(shiftWeekStart('2026-12-28', 1)).toBe('2027-01-04')
  })

  it('rango de la semana', () => {
    expect(describeWeekRange('2026-11-02')).toBe('2–8 nov 2026')
    expect(describeWeekRange('2026-11-30')).toBe('30 nov – 6 dic 2026')
    expect(describeWeekRange('2026-12-28')).toBe('28 dic 2026 – 3 ene 2027')
    expect(describeWeekRange('x')).toBe('')
  })

  it('relación con la semana actual', () => {
    expect(describeWeekRelation('2026-11-02', TODAY)).toBe('Esta semana')
    expect(describeWeekRelation('2026-10-26', TODAY)).toBe('La semana pasada')
    expect(describeWeekRelation('2026-11-09', TODAY)).toBe('La semana que viene')
    expect(describeWeekRelation('2026-11-16', TODAY)).toBe('')
  })

  it('día largo', () => {
    expect(formatLongDay('2026-11-05')).toBe('jueves, 5 de noviembre')
  })
})

describe('cabeceras y día seleccionado', () => {
  const dates = getWeekDates('2026-11-02')

  it('días de la semana, hoy y festivos (solo informativo)', () => {
    const headers = getDayHeaders(dates, { today: TODAY, holidays: [{ id: 'h1', holiday_date: '2026-11-06', name: 'Fiesta local' }] })
    expect(headers.map(h => `${h.short}${h.dayNumber}`)).toEqual(['L2', 'M3', 'X4', 'J5', 'V6', 'S7', 'D8'])
    expect(headers.filter(h => h.isToday).map(h => h.date)).toEqual([TODAY])
    expect(headers[4].holiday.name).toBe('Fiesta local')
    expect(headers[0].holiday).toBeNull()
  })

  it('al abrir la vista diaria: hoy si está en la semana; si no, el lunes', () => {
    expect(getDefaultSelectedDate(dates, TODAY)).toBe(TODAY)
    expect(getDefaultSelectedDate(getWeekDates('2026-11-09'), TODAY)).toBe('2026-11-09')
    expect(getDefaultSelectedDate([], TODAY)).toBeNull()
  })
})

describe('getDayCellView', () => {
  const header = { label: 'lunes', dayNumber: 2 }

  it('turnos habituales, con turno nocturno', () => {
    const view = getDayCellView({ status: DAY_STATUS.REGULAR, minutes: 900, shifts: [{ start: '07:00', end: '14:00', overnight: false }, { start: '22:00', end: '06:00', overnight: true }] })
    expect(view).toMatchObject({ tone: CELL_TONE.REGULAR, isException: false, label: null, badge: null, duration: '15 h' })
    expect(view.shifts.map(x => [x.text, x.overnight])).toEqual([['07:00–14:00', false], ['22:00–06:00', true]])
    expect(describeDayCell(header, view)).toBe('Lunes 2: 07:00–14:00, 22:00–06:00 (acaba al día siguiente) · 15 h')
  })

  it('cambio de un día y día libre: excepciones', () => {
    expect(getDayCellView({ status: DAY_STATUS.OVERRIDE, minutes: 240, shifts: [{ start: '10:00', end: '14:00' }] }))
      .toMatchObject({ tone: CELL_TONE.EXCEPTION, badge: 'Cambio', isException: true, duration: '4 h' })
    const off = getDayCellView({ status: DAY_STATUS.DAY_OFF, minutes: 0, shifts: [] })
    expect(off).toMatchObject({ tone: CELL_TONE.EXCEPTION, label: 'Libre', badge: 'Cambio', isException: true, duration: '' })
    expect(describeDayCell(header, off)).toBe('Lunes 2: Libre · cambio')
  })

  it('descanso, ausencias, baja y sin horario', () => {
    expect(getDayCellView({ status: DAY_STATUS.REST })).toMatchObject({ tone: CELL_TONE.REST, label: 'Descanso', isException: false })
    expect(getDayCellView({ status: DAY_STATUS.ABSENCE, absence: { absence_type: 'vacation' } })).toMatchObject({ tone: CELL_TONE.ABSENCE, label: 'Vacaciones', isException: true })
    expect(getDayCellView({ status: DAY_STATUS.ABSENCE, absence: { absence_type: 'leave' } }).label).toBe('Permiso')
    expect(getDayCellView({ status: DAY_STATUS.TERMINATED })).toMatchObject({ tone: CELL_TONE.TERMINATED, label: 'Baja' })
    expect(getDayCellView({ status: DAY_STATUS.NO_SCHEDULE })).toMatchObject({ tone: CELL_TONE.EMPTY, label: 'Sin horario' })
  })

  it('conflictos y horas que no existen', () => {
    const view = getDayCellView({
      status: DAY_STATUS.REGULAR,
      minutes: 0,
      hasConflict: true,
      shifts: [{ start: '02:30', end: '06:00', error: { code: 'nonexistent_time', date: '2027-03-28', time: '02:30' } }],
    })
    expect(view.hasConflict).toBe(true)
    expect(view.errors).toEqual(['La hora 02:30 no existe el 28/03/2027 por el cambio al horario de verano. Modifica el turno.'])
    expect(describeDayCell(header, view)).toContain('turnos solapados · hora no válida')
  })

  it('con buildWeekPlan: un turno nocturno del domingo cuenta en esa semana', () => {
    const plan = buildWeekPlan({
      employees: [{ id: 'e1', first_name: 'Ana', last_name: 'L', is_active: true }],
      versions: [{ id: 'v1', employee_id: 'e1', valid_from: '2026-10-01', kind: 'schedule', week: { 7: [s('22:00', '06:00')] } }],
      date: '2026-11-02',
      today: TODAY,
    })
    const view = getDayCellView(plan.rows[0].days[6])
    expect(view.shifts[0]).toMatchObject({ text: '22:00–06:00', overnight: true })
    expect(view.duration).toBe('8 h')
    expect(plan.totalMinutes).toBe(480)
  })
})

describe('getWeekPlanLoadMessage', () => {
  it('mensajes comprensibles', () => {
    expect(getWeekPlanLoadMessage({ kind: 'network' })).toContain('conexión a Internet')
    expect(getWeekPlanLoadMessage({ kind: 'expired' })).toContain('sesión ha caducado')
    expect(getWeekPlanLoadMessage({ kind: 'permission' })).toBe('Esta cuenta no tiene permiso para consultar los horarios.')
    expect(getWeekPlanLoadMessage({ kind: 'unknown' })).toContain('Vuelve a intentarlo en unos minutos')
    expect(getWeekPlanLoadMessage(null)).toContain('Vuelve a intentarlo en unos minutos')
  })
})
