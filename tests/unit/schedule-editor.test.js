import { describe, expect, it } from 'vitest'
import {
  SCHEDULE_EDITOR_MODE,
  createEditorDays,
  describeScheduleStart,
  editorDaysToWeek,
  getEditorDayMinutes,
  getScheduleDstNotices,
  getScheduleEditorContext,
  getScheduleSaveFeedback,
  hasOvernightShift,
  sameWeek,
  validateScheduleDraft,
} from '../../app/utils/schedule-editor.js'
import { DB_ERROR_KIND } from '../../app/utils/database-errors.js'
import { buildWeekPlan } from '../../app/utils/schedules.js'

// Hoy: jueves 5 de noviembre de 2026 (semana del lunes 2).
const TODAY = '2026-11-05'
const s = (start, end) => ({ start, end })
const W1 = { 1: [s('07:00', '14:00')], 2: [s('07:00', '14:00')], 3: [s('07:00', '14:00')], 4: [s('07:00', '14:00')], 5: [s('07:00', '14:00')], 6: [s('07:00', '13:00')] }
const ana = { id: 'ana', first_name: 'Ana', last_name: 'López', is_active: true, last_working_date: null }
const version = (validFrom, week, kind = 'schedule') => ({ id: `v-${validFrom}`, employee_id: 'ana', valid_from: validFrom, kind, week: kind === 'end' ? null : week })

/** Días del editor a partir de un objeto { weekday: shifts }. */
const daysOf = week => createEditorDays(week)

function check({ employee = ana, versions = [], overrides = [], absences = [], week, validFrom }) {
  const context = getScheduleEditorContext({ employee, versions, today: TODAY })
  return validateScheduleDraft({ employee, context, days: daysOf(week), validFrom, versions, overrides, absences })
}

describe('getScheduleEditorContext', () => {
  it('sin horario: crear, sin fecha mínima y propuesta el lunes siguiente', () => {
    expect(getScheduleEditorContext({ employee: ana, versions: [], today: TODAY })).toMatchObject({
      mode: SCHEDULE_EDITOR_MODE.CREATE, editable: true, isFirst: true, minDate: null, defaultDate: '2026-11-09', baseWeek: null, latest: null,
    })
  })

  it('con horario vigente: cambiar, como pronto el lunes de esta semana', () => {
    const context = getScheduleEditorContext({ employee: ana, versions: [version('2026-10-01', W1)], today: TODAY })
    expect(context).toMatchObject({ mode: SCHEDULE_EDITOR_MODE.CHANGE, isFirst: false, minDate: '2026-11-02', defaultDate: '2026-11-09' })
    expect(context.baseWeek).toEqual(W1)
  })

  it('con un horario próximo: después de él', () => {
    const context = getScheduleEditorContext({ employee: ana, versions: [version('2026-10-01', W1), version('2026-11-16', W1)], today: TODAY })
    expect(context).toMatchObject({ mode: SCHEDULE_EDITOR_MODE.CHANGE, minDate: '2026-11-17', defaultDate: '2026-11-23' })
  })

  it('activa con el horario cerrado: crear, partiendo de su último horario', () => {
    const context = getScheduleEditorContext({ employee: ana, versions: [version('2026-09-01', W1), version('2026-10-10', null, 'end')], today: TODAY })
    expect(context).toMatchObject({ mode: SCHEDULE_EDITOR_MODE.CREATE, minDate: '2026-11-02', isFirst: false })
    expect(context.baseWeek).toEqual(W1)
  })

  it('de baja: no se puede editar', () => {
    const context = getScheduleEditorContext({ employee: { ...ana, is_active: false, last_working_date: '2026-11-01' }, versions: [version('2026-10-01', W1)], today: TODAY })
    expect(context.editable).toBe(false)
    expect(context.blockedReason).toMatch(/de baja/)
  })
})

describe('días del editor', () => {
  it('de una semana guardada a los siete días y vuelta (descansos como [])', () => {
    const days = createEditorDays({ 1: [s('17:00', '20:00'), s('07:00', '11:00')] })
    expect(days).toHaveLength(7)
    expect(days[0]).toMatchObject({ weekday: 1, label: 'Lunes', works: true, shifts: [s('07:00', '11:00'), s('17:00', '20:00')] })
    expect(days[6]).toMatchObject({ weekday: 7, label: 'Domingo', works: false, shifts: [] })
    expect(editorDaysToWeek(days)).toEqual({ 1: [s('07:00', '11:00'), s('17:00', '20:00')], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [] })
  })

  it('un día desactivado se guarda como descanso aunque tuviera turnos', () => {
    const days = createEditorDays(W1)
    days[5].works = false
    expect(editorDaysToWeek(days)['6']).toEqual([])
    expect(getEditorDayMinutes(days[5])).toBe(0)
  })

  it('sameWeek y hasOvernightShift', () => {
    expect(sameWeek(editorDaysToWeek(createEditorDays(W1)), W1)).toBe(true)
    expect(sameWeek({ 1: [s('07:00', '14:00')] }, W1)).toBe(false)
    expect(hasOvernightShift({ works: true, shifts: [s('22:00', '06:00')] })).toBe(true)
    expect(hasOvernightShift({ works: false, shifts: [s('22:00', '06:00')] })).toBe(false)
  })
})

describe('validateScheduleDraft', () => {
  it('primer horario con varios turnos y días de descanso: válido, con totales', () => {
    const week = { 1: [s('07:00', '11:00'), s('17:00', '20:00')], 3: [s('07:00', '14:00')], 6: [s('08:00', '12:00')] }
    const result = check({ week, validFrom: '2026-11-09' })
    expect(result.valid).toBe(true)
    expect(result.dayMinutes).toMatchObject({ 1: 420, 2: 0, 3: 420, 6: 240, 7: 0 })
    expect(result.weekMinutes).toBe(1080)
    expect(result.week).toEqual({ 1: week[1], 2: [], 3: week[3], 4: [], 5: [], 6: week[6], 7: [] })
  })

  it('el primer horario puede empezar en una fecha pasada (carga inicial)', () => {
    expect(check({ week: W1, validFrom: '2026-09-01' }).valid).toBe(true)
  })

  it('nueva versión de un horario existente: después de la última y desde esta semana', () => {
    const versions = [version('2026-10-01', W1)]
    expect(check({ versions, week: W1, validFrom: '2026-11-02' }).valid).toBe(true)
    expect(check({ versions, week: W1, validFrom: '2026-11-01' }).dateError).toMatch(/No puede empezar antes del lunes 2 nov 2026/)
    expect(check({ versions, week: W1, validFrom: '2026-10-01' }).dateError).toMatch(/Ya tiene un horario registrado desde el 1 oct 2026/)
  })

  it('fecha que pisa un horario próximo ya registrado', () => {
    const versions = [version('2026-10-01', W1), version('2026-11-16', W1)]
    const result = check({ versions, week: W1, validFrom: '2026-11-09' })
    expect(result.valid).toBe(false)
    expect(result.dateError).toBe('Ya tiene un horario registrado desde el 16 nov 2026: el nuevo debe empezar después (como pronto, el 17 nov 2026).')
  })

  it('fecha vacía o no válida', () => {
    expect(check({ week: W1, validFrom: '' }).dateError).toBe('Indica desde qué fecha rige el horario.')
    expect(check({ week: W1, validFrom: '2026-02-30' }).dateError).toBe('Indica desde qué fecha rige el horario.')
  })

  it('turnos no válidos en un día', () => {
    const empty = createEditorDays({})
    empty[0].works = true
    const context = getScheduleEditorContext({ employee: ana, today: TODAY })
    expect(validateScheduleDraft({ employee: ana, context, days: empty, validFrom: '2026-11-09' }).dayErrors[1]).toEqual(['Añade al menos un turno o marca el día como descanso.'])

    expect(check({ week: { 1: [s('07:00', '10:00'), s('09:00', '12:00')] }, validFrom: '2026-11-09' }).dayErrors[1]).toEqual(['Hay turnos que se solapan.'])
    const overlap = check({ week: { 1: [s('07:00', '10:00'), s('09:00', '12:00')] }, validFrom: '2026-11-09' })
    expect(overlap.shiftErrors).toMatchObject({ '1:0': 'Hay turnos que se solapan.', '1:1': 'Hay turnos que se solapan.' })
    expect(check({ week: { 2: [s('08:00', '08:00')] }, validFrom: '2026-11-09' }).dayErrors[2]).toEqual(['Un turno no puede empezar y acabar a la misma hora.'])
    expect(check({ week: { 3: [s('08:00', '')] }, validFrom: '2026-11-09' }).shiftErrors['3:0']).toBe('Indica la hora de inicio y de fin de cada turno (HH:MM).')
    expect(check({ week: { 4: [s('06:00', '07:00'), s('08:00', '09:00'), s('10:00', '11:00'), s('12:00', '13:00')] }, validFrom: '2026-11-09' }).dayErrors[4]).toContain('Como mucho 3 turnos por día.')
  })

  it('turnos nocturnos: válidos si no pisan el día siguiente', () => {
    const ok = check({ week: { 5: [s('22:00', '06:00')], 6: [s('06:00', '10:00')] }, validFrom: '2026-11-09' })
    expect(ok.valid).toBe(true)
    expect(ok.dayMinutes[5]).toBe(480)
    const bad = check({ week: { 5: [s('22:00', '06:00')], 6: [s('05:00', '10:00')] }, validFrom: '2026-11-09' })
    expect(bad.dayErrors[5]).toEqual(['El turno nocturno se solapa con los turnos del sábado.'])
  })

  it('del domingo al lunes siguiente (la semana se repite)', () => {
    const result = check({ week: { 1: [s('05:00', '12:00')], 7: [s('23:00', '07:00')] }, validFrom: '2026-11-09' })
    expect(result.dayErrors[7]).toEqual(['El turno nocturno se solapa con los turnos del lunes siguiente.'])
  })

  it('el primer día choca con un turno nocturno del día anterior (horario anterior o cambio de un día)', () => {
    const versions = [version('2026-10-01', { 7: [s('22:00', '06:00')] })]
    const result = check({ versions, week: { 1: [s('05:00', '12:00')] }, validFrom: '2026-11-09' })
    expect(result.valid).toBe(false)
    expect(result.dateError).toMatch(/^El primer día \(lunes, 9 de noviembre de 2026\) se solapa con el turno nocturno del día anterior \(22:00–06:00\)/)

    const overrides = [{ id: 'o1', employee_id: 'ana', work_date: '2026-11-08', shifts: [s('23:00', '07:00')] }]
    expect(check({ versions: [version('2026-10-01', W1)], overrides, week: { 1: [s('06:00', '12:00')] }, validFrom: '2026-11-09' }).dateError).toMatch(/23:00–07:00/)
    // Con una ausencia ese día anterior, no hay choque.
    const absences = [{ id: 'a1', employee_id: 'ana', absence_type: 'vacation', start_date: '2026-11-08', end_date: '2026-11-08' }]
    expect(check({ versions, absences, week: { 1: [s('05:00', '12:00')] }, validFrom: '2026-11-09' }).valid).toBe(true)
  })

  it('choques con cambios de un día ya guardados: aviso, no impide guardar', () => {
    const overrides = [{ id: 'o1', employee_id: 'ana', work_date: '2026-11-12', shifts: [s('22:00', '08:00')] }]
    const result = check({ versions: [version('2026-10-01', W1)], overrides, week: W1, validFrom: '2026-11-09' })
    expect(result.valid).toBe(true)
    expect(result.warnings).toEqual(['Choca con el cambio de un día del jueves, 12 de noviembre de 2026 (turnos nocturnos que se solapan). Revisa ese día en el calendario.'])
  })

  it('empleada de baja: no se puede guardar', () => {
    const result = check({ employee: { ...ana, is_active: false, last_working_date: '2026-11-01' }, versions: [version('2026-10-01', W1)], week: W1, validFrom: '2026-11-09' })
    expect(result.valid).toBe(false)
    expect(result.errors).toEqual(['Está de baja: actívala antes de registrar un horario habitual.'])
  })

  it('igual que el último horario: se avisa, pero se puede guardar', () => {
    const result = check({ versions: [version('2026-10-01', W1)], week: W1, validFrom: '2026-11-09' })
    expect(result.valid).toBe(true)
    expect(result.notices).toContain('Es igual que su último horario habitual.')
  })

  it('no modifica los datos de partida', () => {
    const versions = [version('2026-10-01', W1)]
    const days = daysOf(W1)
    const before = JSON.stringify({ versions, days })
    const context = getScheduleEditorContext({ employee: ana, versions, today: TODAY })
    validateScheduleDraft({ employee: ana, context, days, validFrom: '2026-11-09', versions })
    expect(JSON.stringify({ versions, days })).toBe(before)
  })
})

describe('cambios de hora', () => {
  it('verano: una hora que no existe se avisa (sábado nocturno y domingo), sin impedir guardar', () => {
    const week = { 6: [s('22:00', '02:30')], 7: [s('02:15', '08:00')] }
    const notes = getScheduleDstNotices(week, '2027-03-01')
    expect(notes.warnings).toEqual([
      'El sábado, 27 de marzo de 2027 la hora 02:30 no existe por el cambio al horario de verano: ese día el turno 22:00–02:30 aparecerá con un aviso en el calendario. Corrígelo con un cambio de un día.',
      'El domingo, 28 de marzo de 2027 la hora 02:15 no existe por el cambio al horario de verano: ese día el turno 02:15–08:00 aparecerá con un aviso en el calendario. Corrígelo con un cambio de un día.',
    ])
    const result = check({ week: { 7: [s('02:15', '08:00')] }, validFrom: '2027-03-01' })
    expect(result.valid).toBe(true)
    expect(result.warnings).toHaveLength(1)
  })

  it('verano e invierno: turnos con más o menos horas reales ese día', () => {
    const week = { 7: [s('01:00', '04:00')] }
    // Desde el 1 de octubre de 2026: primero el 25 oct (una hora más), luego el 28 mar 2027 (una menos).
    expect(getScheduleDstNotices(week, '2026-10-01').notices).toEqual([
      'El domingo, 25 de octubre de 2026, por el cambio de hora, el turno 01:00–04:00 dura 4 h reales (en lugar de 3 h).',
      'El domingo, 28 de marzo de 2027, por el cambio de hora, el turno 01:00–04:00 dura 2 h reales (en lugar de 3 h).',
    ])
  })

  it('sin turnos afectados, ni avisos ni notas', () => {
    expect(getScheduleDstNotices(W1, '2026-11-09')).toEqual({ warnings: [], notices: [] })
    expect(getScheduleDstNotices(W1, '')).toEqual({ warnings: [], notices: [] })
  })
})

describe('textos y errores', () => {
  it('describeScheduleStart', () => {
    const first = getScheduleEditorContext({ employee: ana, today: TODAY })
    expect(describeScheduleStart({ context: first, validFrom: '2026-11-09', today: TODAY })).toBe('Será su primer horario habitual, desde el 9 nov 2026.')
    expect(describeScheduleStart({ context: first, validFrom: '2026-11-02', today: TODAY })).toMatch(/Incluye días ya pasados/)
    const change = getScheduleEditorContext({ employee: ana, versions: [version('2026-10-01', W1)], today: TODAY })
    expect(describeScheduleStart({ context: change, validFrom: '2026-11-09', today: TODAY }))
      .toBe('Su horario anterior (desde el 1 oct 2026) se aplicará hasta el 8 nov 2026. El nuevo rige desde el 9 nov 2026.')
    const closed = getScheduleEditorContext({ employee: ana, versions: [version('2026-09-01', W1), version('2026-10-10', null, 'end')], today: TODAY })
    expect(describeScheduleStart({ context: closed, validFrom: '2026-11-09', today: TODAY })).toBe('No tiene horario desde el 10 oct 2026. El nuevo rige desde el 9 nov 2026.')
    expect(describeScheduleStart({ context: change, validFrom: '', today: TODAY })).toBe('')
  })

  it('getScheduleSaveFeedback: códigos de la migración y errores generales', () => {
    const fb = (code, details = null, status = 400) => getScheduleSaveFeedback({ error: { code, details, message: 'x' }, status })
    expect(fb('PS001', '2026-11-16').message).toMatch(/desde el 16 nov 2026/)
    expect(fb('23505').message).toBe('Ya tiene un horario que empieza ese mismo día: elige otra fecha.')
    expect(fb('PS002', '2026-11-02').message).toMatch(/lunes 2 nov 2026/)
    expect(fb('PS003').kind).toBe(DB_ERROR_KIND.VALIDATION)
    expect(fb('PS006').message).toMatch(/de baja/)
    expect(fb('23514').message).toMatch(/Revisa los turnos/)
    expect(fb('42501', null, 403)).toMatchObject({ kind: DB_ERROR_KIND.PERMISSION, message: 'Esta cuenta no tiene permiso para modificar los horarios.' })
    expect(fb('PGRST205', null, 404).kind).toBe(DB_ERROR_KIND.MISSING)
    expect(getScheduleSaveFeedback({ error: new TypeError('Failed to fetch'), status: 0 }).kind).toBe(DB_ERROR_KIND.NETWORK)
    expect(fb('XX000', null, 500).message).toBe('No se ha podido guardar el horario. Vuelve a intentarlo.')
  })
})

describe('integración con el calendario', () => {
  it('la versión nueva cambia el calendario desde su fecha y conserva la anterior antes', () => {
    const versions = [version('2026-10-01', W1)]
    const context = getScheduleEditorContext({ employee: ana, versions, today: TODAY })
    const result = validateScheduleDraft({ employee: ana, context, days: daysOf({ 1: [s('09:00', '13:00')] }), validFrom: '2026-11-09', versions })
    const saved = [...versions, { id: 'nueva', employee_id: 'ana', valid_from: '2026-11-09', kind: 'schedule', week: result.week }]
    const before = buildWeekPlan({ employees: [ana], versions: saved, date: '2026-11-02', today: TODAY })
    const after = buildWeekPlan({ employees: [ana], versions: saved, date: '2026-11-09', today: TODAY })
    expect(before.totalMinutes).toBe(41 * 60)
    expect(after.totalMinutes).toBe(4 * 60)
  })
})
