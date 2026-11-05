import { describe, expect, it } from 'vitest'
import {
  countOverridesCoveredByAbsence,
  findLeavePeriodOverlap,
  getAbsenceFormValues,
  getDayEditability,
  getExceptionErrorFeedback,
  getInitialDayShifts,
  normalizeAbsenceInput,
  sameShifts,
  sortAbsencesDesc,
  validateAbsence,
  validateDayChange,
} from '../../app/utils/schedule-exceptions.js'
import { DB_ERROR_KIND } from '../../app/utils/database-errors.js'

const s = (start, end) => ({ start, end })
const W1 = { 1: [s('07:00', '14:00')], 2: [s('07:00', '14:00')], 3: [s('22:00', '06:00')], 4: [s('07:00', '14:00')], 5: [s('07:00', '14:00')], 7: [s('22:00', '06:00')] }
const version = (validFrom, week = W1, kind = 'schedule') => ({ id: `v-${validFrom}`, employee_id: 'e1', valid_from: validFrom, kind, week: kind === 'end' ? null : week })
const override = (date, shifts) => ({ id: `o-${date}`, employee_id: 'e1', work_date: date, shifts })
const absence = (from, to, type = 'vacation', id = `a-${from}`) => ({ id, employee_id: 'e1', absence_type: type, start_date: from, end_date: to })
const active = { id: 'e1', is_active: true, last_working_date: null }
const versions = [version('2026-10-01')]
// Semana del lunes 2 al domingo 8 de noviembre de 2026; miércoles 4 y domingo 8 de noche.

describe('periodo laboral', () => {
  it('activa: se puede modificar', () => {
    expect(getDayEditability({ employee: active, date: '2026-11-05', versions })).toEqual({ editable: true, reason: null })
  })

  it('de baja: no se puede modificar', () => {
    const employee = { ...active, is_active: false, last_working_date: '2026-11-03' }
    expect(getDayEditability({ employee, date: '2026-11-02', versions }).editable).toBe(false)
    expect(getDayEditability({ employee, date: '2026-11-05', versions }).reason).toBe('Está de baja: su planificación no se puede modificar.')
  })

  it('periodo de baja anterior (versión de fin): no se puede modificar', () => {
    const list = [version('2026-09-01'), version('2026-10-01', null, 'end'), version('2026-11-09')]
    expect(getDayEditability({ employee: active, date: '2026-11-05', versions: list })).toEqual({ editable: false, reason: 'Ese día no tenía horario por una baja anterior.' })
    expect(getDayEditability({ employee: active, date: '2026-11-09', versions: list }).editable).toBe(true)
    expect(findLeavePeriodOverlap(list, '2026-11-08', '2026-11-12').from).toBe('2026-10-01')
    expect(findLeavePeriodOverlap(list, '2026-11-09', '2026-11-12')).toBeNull()
  })

  it('sin horario registrado: se puede modificar (puede trabajar con cambios de un día)', () => {
    expect(getDayEditability({ employee: active, date: '2026-11-05', versions: [] }).editable).toBe(true)
  })
})

describe('validateDayChange', () => {
  const base = { employee: active, versions }

  it('cambio válido con varios turnos: total real', () => {
    const result = validateDayChange({ ...base, date: '2026-11-05', shifts: [s('08:00', '12:00'), s('17:00', '20:00')] })
    expect(result).toEqual({ errors: [], shiftErrors: [], minutes: 7 * 60, overnight: false })
  })

  it('día libre: válido', () => {
    expect(validateDayChange({ ...base, date: '2026-11-05', shifts: [] }).errors).toEqual([])
  })

  it('más de 3 turnos, formato, inicio igual al fin y solapes en el día', () => {
    expect(validateDayChange({ ...base, date: '2026-11-06', shifts: [s('06:00', '07:00'), s('08:00', '09:00'), s('10:00', '11:00'), s('12:00', '13:00')] }).errors)
      .toContain('Como mucho 3 turnos por día.')
    expect(validateDayChange({ ...base, date: '2026-11-06', shifts: [s('', '14:00')] }).shiftErrors).toEqual([{ index: 0, message: 'Indica la hora de inicio y de fin de cada turno (HH:MM).' }])
    expect(validateDayChange({ ...base, date: '2026-11-06', shifts: [s('07:00', '07:00')] }).errors).toEqual(['Un turno no puede empezar y acabar a la misma hora.'])
    const overlap = validateDayChange({ ...base, date: '2026-11-06', shifts: [s('07:00', '14:00'), s('13:00', '15:00')] })
    expect(overlap.errors).toEqual(['Hay turnos que se solapan.'])
    expect(overlap.shiftErrors.map(e => e.index)).toEqual([0, 1])
  })

  it('solape con el turno nocturno del día anterior', () => {
    const result = validateDayChange({ ...base, date: '2026-11-05', shifts: [s('05:00', '10:00')] })
    expect(result.errors).toEqual(['Se solapa con el turno nocturno del día anterior (miércoles, 4 de noviembre de 2026: 22:00–06:00).'])
    expect(validateDayChange({ ...base, date: '2026-11-05', shifts: [s('06:00', '10:00')] }).errors).toEqual([])
  })

  it('turno nocturno que pisa el día siguiente, incluido domingo con lunes', () => {
    expect(validateDayChange({ ...base, date: '2026-11-05', shifts: [s('22:00', '08:00')] }).errors)
      .toEqual(['El turno nocturno se solapa con los turnos del día siguiente (viernes, 6 de noviembre de 2026: 07:00–14:00).'])
    // Domingo 8: ya tiene su nocturno; cambiarlo a 22:00-08:00 pisa el lunes 9.
    expect(validateDayChange({ ...base, date: '2026-11-08', shifts: [s('22:00', '08:00')] }).errors[0]).toContain('lunes, 9 de noviembre')
    // El lunes 9 desde las 05:00 choca con el domingo 8 de noche.
    expect(validateDayChange({ ...base, date: '2026-11-09', shifts: [s('05:00', '12:00')] }).errors[0]).toContain('domingo, 8 de noviembre')
  })

  it('el cambio que se edita no cuenta como vecino de sí mismo, y los demás cambios sí', () => {
    const overrides = [override('2026-11-04', []), override('2026-11-05', [s('10:00', '14:00')])]
    // Con el miércoles libre, el jueves puede empezar a las 05:00.
    expect(validateDayChange({ ...base, overrides, date: '2026-11-05', shifts: [s('05:00', '10:00')] }).errors).toEqual([])
  })

  it('las ausencias de los días vecinos cuentan (sin turnos)', () => {
    const absences = [absence('2026-11-04', '2026-11-04')]
    expect(validateDayChange({ ...base, absences, date: '2026-11-05', shifts: [s('05:00', '10:00')] }).errors).toEqual([])
  })

  it('no se cambian los turnos de un día con ausencia (prevalece la ausencia)', () => {
    const absences = [absence('2026-11-05', '2026-11-06', 'leave')]
    expect(validateDayChange({ ...base, absences, date: '2026-11-05', shifts: [s('08:00', '12:00')] }).errors[0])
      .toBe('Ese día tiene permiso (del 5 nov 2026 al 6 nov 2026). La ausencia prevalece: para cambiar sus turnos, modifica o quita la ausencia.')
  })

  it('cambio de hora de verano: hora inexistente', () => {
    const result = validateDayChange({ employee: active, versions: [], date: '2027-03-28', shifts: [s('02:30', '06:00')] })
    expect(result.errors).toEqual(['La hora 02:30 no existe el 28/03/2027 por el cambio al horario de verano. Modifica el turno.'])
    expect(result.shiftErrors).toEqual([{ index: 0, message: result.errors[0] }])
    expect(validateDayChange({ employee: active, versions: [], date: '2027-03-27', shifts: [s('22:00', '02:15')] }).errors[0]).toContain('La hora 02:15 no existe')
    expect(validateDayChange({ employee: active, versions: [], date: '2027-03-27', shifts: [s('22:00', '06:00')] }).minutes).toBe(7 * 60)
  })

  it('cambio de hora de invierno: horas reales (primera aparición de la hora repetida)', () => {
    expect(validateDayChange({ employee: active, versions: [], date: '2027-10-30', shifts: [s('22:00', '06:00')] })).toMatchObject({ errors: [], minutes: 9 * 60, overnight: true })
    expect(validateDayChange({ employee: active, versions: [], date: '2027-10-31', shifts: [s('02:30', '06:00')] }).minutes).toBe(270)
  })

  it('fuera del periodo laboral', () => {
    expect(validateDayChange({ employee: { ...active, is_active: false, last_working_date: '2026-11-03' }, versions, date: '2026-11-02', shifts: [] }).errors)
      .toEqual(['Está de baja: su planificación no se puede modificar.'])
    expect(validateDayChange({ employee: active, versions: [version('2026-09-01'), version('2026-10-01', null, 'end')], date: '2026-11-05', shifts: [] }).errors)
      .toEqual(['Ese día no tenía horario por una baja anterior.'])
  })

  it('turnos iniciales y comparación', () => {
    expect(getInitialDayShifts({ shifts: [{ start: '17:00', end: '20:00', minutes: 180 }, { start: '08:00', end: '12:00' }] })).toEqual([s('08:00', '12:00'), s('17:00', '20:00')])
    expect(getInitialDayShifts(null)).toEqual([])
    expect(sameShifts([s('17:00', '20:00'), s('08:00', '12:00')], [s('08:00', '12:00'), s('17:00', '20:00')])).toBe(true)
    expect(sameShifts([], [s('08:00', '12:00')])).toBe(false)
  })
})

describe('validateAbsence', () => {
  const absences = [absence('2026-11-10', '2026-11-14', 'vacation', 'a1'), absence('2026-12-01', '2026-12-01', 'leave', 'a2')]
  const base = { employee: active, absences, versions }
  const values = (start, end, extra = {}) => ({ id: null, absence_type: 'vacation', start_date: start, end_date: end, notes: '', ...extra })

  it('ausencia válida', () => {
    expect(validateAbsence({ ...base, values: values('2026-11-05', '2026-11-06') }).errors).toEqual([])
  })

  it('fechas no válidas o invertidas', () => {
    expect(validateAbsence({ ...base, values: values('', '2026-11-06') }).errors).toEqual([{ field: 'start_date', message: 'Indica una fecha de inicio válida.' }])
    expect(validateAbsence({ ...base, values: values('2026-11-06', '2026-11-05') }).errors).toEqual([{ field: 'end_date', message: 'La fecha de fin no puede ser anterior a la de inicio.' }])
  })

  it('tipo no permitido (sin tipos médicos)', () => {
    expect(validateAbsence({ ...base, values: values('2026-11-05', '2026-11-05', { absence_type: 'sick' }) }).errors).toEqual([{ field: 'absence_type', message: 'Elige el tipo de ausencia.' }])
  })

  it('solapamientos con otra ausencia (los extremos cuentan)', () => {
    expect(validateAbsence({ ...base, values: values('2026-11-14', '2026-11-16') }).errors).toEqual([{ field: null, message: 'Se solapa con vacaciones del 10 nov 2026 al 14 nov 2026.' }])
    expect(validateAbsence({ ...base, values: values('2026-11-15', '2026-11-16') }).errors).toEqual([])
  })

  it('al editar, la propia ausencia no cuenta como solape', () => {
    expect(validateAbsence({ ...base, values: values('2026-11-09', '2026-11-15', { id: 'a1' }) }).errors).toEqual([])
    expect(validateAbsence({ ...base, values: values('2026-11-09', '2026-12-01', { id: 'a1' }) }).errors[0].message).toBe('Se solapa con permiso el 1 dic 2026.')
  })

  it('fuera del periodo laboral', () => {
    expect(validateAbsence({ ...base, employee: { ...active, is_active: false, last_working_date: '2026-11-03' }, values: values('2026-11-02', '2026-11-02') }).errors[0].message)
      .toBe('Está de baja: su planificación no se puede modificar.')
    const withLeave = [version('2026-09-01'), version('2026-10-01', null, 'end'), version('2026-11-09')]
    expect(validateAbsence({ ...base, versions: withLeave, values: values('2026-11-05', '2026-11-10') }).errors[0].message)
      .toBe('Las fechas coinciden con un periodo en que no tenía horario por una baja.')
    expect(validateAbsence({ ...base, versions: withLeave, values: values('2026-11-09', '2026-11-09') }).errors).toEqual([])
  })

  it('observaciones demasiado largas', () => {
    expect(validateAbsence({ ...base, values: values('2026-11-05', '2026-11-05', { notes: 'x'.repeat(501) }) }).errors).toEqual([{ field: 'notes', message: 'Como mucho 500 caracteres.' }])
  })

  it('formulario y datos enviados', () => {
    expect(getAbsenceFormValues(null, '2026-11-05')).toEqual({ id: null, absence_type: 'vacation', start_date: '2026-11-05', end_date: '2026-11-05', notes: '' })
    expect(getAbsenceFormValues({ ...absences[0], notes: null }, '2026-11-05')).toMatchObject({ id: 'a1', start_date: '2026-11-10', notes: '' })
    expect(normalizeAbsenceInput({ id: 'a1', absence_type: 'leave', start_date: '2026-11-05', end_date: '2026-11-05', notes: '  ' }))
      .toEqual({ absence_type: 'leave', start_date: '2026-11-05', end_date: '2026-11-05', notes: null })
    expect(sortAbsencesDesc(absences).map(a => a.id)).toEqual(['a2', 'a1'])
    expect(countOverridesCoveredByAbsence([override('2026-11-05', []), override('2026-11-09', [])], { start_date: '2026-11-04', end_date: '2026-11-06' })).toBe(1)
  })
})

describe('getExceptionErrorFeedback', () => {
  const err = (code, details = null, status = 400) => ({ error: { code, details, message: 'técnico' }, status })

  it('códigos de la base de datos', () => {
    expect(getExceptionErrorFeedback(err('PS003')).message).toContain('turno nocturno')
    expect(getExceptionErrorFeedback(err('PS004', '2027-03-28 02:30')).message).toBe('La hora 02:30 no existe el 28 mar 2027 por el cambio al horario de verano. Modifica el turno.')
    expect(getExceptionErrorFeedback(err('PS005'), 'absence').message).toContain('otra ausencia')
    expect(getExceptionErrorFeedback(err('PS006')).message).toContain('de baja')
    expect(getExceptionErrorFeedback(err('23505')).message).toContain('ya tiene un cambio')
    expect(getExceptionErrorFeedback(err('23514'), 'absence').message).toBe('Revisa las fechas y el tipo de ausencia.')
  })

  it('red, permisos, sesión y errores desconocidos (nunca el mensaje técnico)', () => {
    expect(getExceptionErrorFeedback({ error: { message: 'Failed to fetch' }, status: 0 }).kind).toBe(DB_ERROR_KIND.NETWORK)
    expect(getExceptionErrorFeedback({ error: { code: '42501' }, status: 403 }).message).toBe('Esta cuenta no tiene permiso para modificar los horarios.')
    expect(getExceptionErrorFeedback({ error: { code: 'PGRST303' }, status: 401 }).kind).toBe(DB_ERROR_KIND.EXPIRED)
    expect(getExceptionErrorFeedback({ error: { message: 'x' }, status: 503 }).message).toBe('No se ha podido guardar. Vuelve a intentarlo.')
    expect(getExceptionErrorFeedback({ error: { message: 'x' }, status: 503 }, 'load').message).toBe('No se han podido cargar las ausencias. Vuelve a intentarlo.')
  })
})
