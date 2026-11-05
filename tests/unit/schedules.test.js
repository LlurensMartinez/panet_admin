import { describe, expect, it } from 'vitest'
import {
  ABSENCE_TYPES,
  CONFLICT_TYPE,
  DAY_STATUS,
  MAX_SHIFTS_PER_DAY,
  SCHEDULE_KIND,
  SHIFT_ERROR,
  SHIFT_ORIGIN,
  buildEmployeeWeek,
  buildPlannedVsOvertime,
  buildWeekPlan,
  describeShiftError,
  findAbsenceForDate,
  findOverrideForDate,
  findShiftConflicts,
  formatShiftTime,
  getShiftDuration,
  getShiftNominalMinutes,
  getTimeZoneOffsetMinutes,
  getVersionForDate,
  getVersionPeriods,
  getWeekDates,
  getWeekStart,
  getWeekTemplateMinutes,
  getWeekdayShifts,
  isEmployeeVisibleInWeek,
  isOvernightShift,
  listDates,
  localTimeToInstant,
  parseShiftTime,
  resolveEmployeeDay,
  shiftsSpillConflict,
  sortScheduleVersions,
  sortShifts,
  summarizePlannedMinutes,
  validateDayShifts,
  validateWeekShifts,
} from '../../app/utils/schedules.js'

// ----------------------------------------------------------------- Datos
// Semana de referencia: lunes 2 a domingo 8 de noviembre de 2026.
// Cambios de hora en Madrid:
//   - 2026: verano el 29 de marzo, invierno el 25 de octubre;
//   - 2027: verano el 28 de marzo, invierno el 31 de octubre.

const shift = (start, end) => ({ start, end })
const H = hours => hours * 60

// Lunes a viernes 07:00-14:00, sábado 07:00-13:00, domingo descanso.
const W1 = {
  1: [shift('07:00', '14:00')],
  2: [shift('07:00', '14:00')],
  3: [shift('07:00', '14:00')],
  4: [shift('07:00', '14:00')],
  5: [shift('07:00', '14:00')],
  6: [shift('07:00', '13:00')],
  7: [],
}
// Miércoles de noche (22:00-06:00) y jueves desde las 07:00.
const WNIGHT = {
  1: [shift('07:00', '14:00')],
  3: [shift('22:00', '06:00')],
  4: [shift('07:00', '14:00')],
}
// Domingo de noche (22:00-06:00).
const WSUNDAY = { 7: [shift('22:00', '06:00')] }

const ana = { id: 'e-ana', first_name: 'Ana', last_name: 'López', is_active: true, last_working_date: null }
const berta = { id: 'e-berta', first_name: 'Berta', last_name: 'Sanz', is_active: true, last_working_date: null }
const carmen = { id: 'e-carmen', first_name: 'Carmen', last_name: 'Ruiz', is_active: true, last_working_date: null }

const version = (employee, validFrom, week, kind = SCHEDULE_KIND.SCHEDULE) => ({
  id: `v-${employee.id}-${validFrom}`,
  employee_id: employee.id,
  valid_from: validFrom,
  kind,
  week: kind === SCHEDULE_KIND.END ? null : week,
})
const closing = (employee, validFrom) => version(employee, validFrom, null, SCHEDULE_KIND.END)
const override = (employee, date, shifts) => ({ id: `o-${employee.id}-${date}`, employee_id: employee.id, work_date: date, shifts })
const absence = (employee, from, to, type = 'vacation') => ({ id: `a-${employee.id}-${from}`, employee_id: employee.id, absence_type: type, start_date: from, end_date: to })

const day = (params, date) => resolveEmployeeDay({ ...params, date })

// ------------------------------------------------------------- Constantes

describe('constantes', () => {
  it('tipos de ausencia: Vacaciones, Permiso y Otro (sin tipos médicos)', () => {
    expect(ABSENCE_TYPES.map(type => type.value)).toEqual(['vacation', 'leave', 'other'])
    expect(ABSENCE_TYPES.map(type => type.label)).toEqual(['Vacaciones', 'Permiso', 'Otro'])
  })

  it('como mucho 3 turnos por día, como la base de datos', () => {
    expect(MAX_SHIFTS_PER_DAY).toBe(3)
  })
})

// ------------------------------------------------------------------ Horas

describe('parseShiftTime y formatShiftTime', () => {
  it('lee horas HH:MM de 00:00 a 23:59', () => {
    expect(parseShiftTime('00:00')).toBe(0)
    expect(parseShiftTime('07:30')).toBe(450)
    expect(parseShiftTime('23:59')).toBe(1439)
  })

  it.each(['24:00', '7:00', '07:60', '07:5', '0700', ' 07:00', '07:00 ', '', null, undefined, 420])(
    'rechaza %j', (value) => {
      expect(parseShiftTime(value)).toBeNull()
    })

  it('formatea minutos como HH:MM', () => {
    expect(formatShiftTime(0)).toBe('00:00')
    expect(formatShiftTime(450)).toBe('07:30')
    expect(formatShiftTime(1439)).toBe('23:59')
    expect(formatShiftTime(1440)).toBe('')
    expect(formatShiftTime(-1)).toBe('')
    expect(formatShiftTime(1.5)).toBe('')
  })
})

describe('turnos nocturnos y duración nominal', () => {
  it('un turno acaba al día siguiente si el fin es anterior al inicio', () => {
    expect(isOvernightShift(shift('22:00', '06:00'))).toBe(true)
    expect(isOvernightShift(shift('18:00', '00:00'))).toBe(true)
    expect(isOvernightShift(shift('07:00', '14:00'))).toBe(false)
    expect(isOvernightShift(shift('00:00', '06:00'))).toBe(false)
    expect(isOvernightShift(shift('xx', '06:00'))).toBe(false)
  })

  it('duración nominal en minutos', () => {
    expect(getShiftNominalMinutes(shift('07:00', '14:00'))).toBe(H(7))
    expect(getShiftNominalMinutes(shift('22:00', '06:00'))).toBe(H(8))
    expect(getShiftNominalMinutes(shift('18:00', '00:00'))).toBe(H(6))
    expect(getShiftNominalMinutes(shift('23:00', '22:00'))).toBe(H(23))
    expect(getShiftNominalMinutes(shift('07:00', '07:00'))).toBeNull()
    expect(getShiftNominalMinutes(shift('7:00', '14:00'))).toBeNull()
  })

  it('ordena los turnos por inicio sin modificar el original', () => {
    const shifts = [shift('17:00', '20:00'), shift('07:00', '14:00')]
    expect(sortShifts(shifts)).toEqual([shift('07:00', '14:00'), shift('17:00', '20:00')])
    expect(shifts[0].start).toBe('17:00')
    expect(sortShifts(null)).toEqual([])
  })
})

// ------------------------------------------------------------- Validación

describe('validateDayShifts', () => {
  it('acepta un día vacío, uno o varios turnos y turnos seguidos', () => {
    expect(validateDayShifts([]).valid).toBe(true)
    expect(validateDayShifts([shift('07:00', '14:00')]).valid).toBe(true)
    expect(validateDayShifts([shift('07:00', '14:00'), shift('14:00', '20:00')]).valid).toBe(true)
    expect(validateDayShifts([shift('07:00', '14:00'), shift('22:00', '06:00')]).valid).toBe(true)
    expect(validateDayShifts([shift('06:00', '07:00'), shift('08:00', '09:00'), shift('10:00', '11:00')]).valid).toBe(true)
  })

  it('rechaza lo que no es una lista', () => {
    expect(validateDayShifts(null).errors).toEqual([{ code: SHIFT_ERROR.NOT_A_LIST }])
    expect(validateDayShifts({}).errors).toEqual([{ code: SHIFT_ERROR.NOT_A_LIST }])
  })

  it('rechaza más de 3 turnos', () => {
    const four = [shift('06:00', '07:00'), shift('08:00', '09:00'), shift('10:00', '11:00'), shift('12:00', '13:00')]
    expect(validateDayShifts(four).errors).toContainEqual({ code: SHIFT_ERROR.TOO_MANY })
  })

  it.each([
    ['hora 24:00', { start: '20:00', end: '24:00' }],
    ['hora sin cero inicial', { start: '7:00', end: '14:00' }],
    ['sin fin', { start: '07:00' }],
    ['campo extra', { start: '07:00', end: '14:00', note: 'x' }],
    ['número', 420],
    ['null', null],
  ])('rechaza un turno mal formado (%s)', (_, value) => {
    expect(validateDayShifts([value]).errors).toEqual([{ code: SHIFT_ERROR.INVALID_TIME, index: 0 }])
  })

  it('rechaza inicio igual al fin', () => {
    expect(validateDayShifts([shift('07:00', '07:00')]).errors).toEqual([{ code: SHIFT_ERROR.SAME_START_END, index: 0 }])
  })

  it('rechaza turnos solapados el mismo día', () => {
    expect(validateDayShifts([shift('07:00', '14:00'), shift('13:30', '20:00')]).errors)
      .toEqual([{ code: SHIFT_ERROR.OVERLAP, index: 0, other: 1 }])
  })

  it('rechaza un turno nocturno solapado con otro del mismo día', () => {
    expect(validateDayShifts([shift('20:00', '02:00'), shift('21:00', '22:00')]).valid).toBe(false)
    expect(validateDayShifts([shift('22:00', '06:00'), shift('23:00', '01:00')]).valid).toBe(false)
  })
})

describe('shiftsSpillConflict (turno nocturno que pisa el día siguiente)', () => {
  it('acabar a las 06:00 y empezar a las 06:00 no es solapamiento', () => {
    expect(shiftsSpillConflict([shift('22:00', '06:00')], [shift('06:00', '12:00')])).toBe(false)
  })

  it('empezar antes de que acabe el turno nocturno sí lo es', () => {
    expect(shiftsSpillConflict([shift('22:00', '06:00')], [shift('05:59', '12:00')])).toBe(true)
    expect(shiftsSpillConflict([shift('22:00', '06:00')], [shift('17:00', '20:00'), shift('05:00', '09:00')])).toBe(true)
  })

  it('sin turno nocturno o sin turnos al día siguiente no hay conflicto', () => {
    expect(shiftsSpillConflict([shift('07:00', '14:00')], [shift('00:00', '06:00')])).toBe(false)
    expect(shiftsSpillConflict([shift('22:00', '06:00')], [])).toBe(false)
    expect(shiftsSpillConflict(null, null)).toBe(false)
  })

  it('un turno que acaba a medianoche no pisa el día siguiente', () => {
    expect(shiftsSpillConflict([shift('18:00', '00:00')], [shift('00:00', '06:00')])).toBe(false)
  })
})

describe('validateWeekShifts', () => {
  it('acepta una semana normal, una con turno nocturno y una vacía', () => {
    expect(validateWeekShifts(W1).valid).toBe(true)
    expect(validateWeekShifts(WNIGHT).valid).toBe(true)
    expect(validateWeekShifts({}).valid).toBe(true)
  })

  it('rechaza un nocturno del lunes que pisa el martes', () => {
    const week = { 1: [shift('22:00', '06:00')], 2: [shift('05:30', '12:00')] }
    expect(validateWeekShifts(week).errors).toEqual([{ code: SHIFT_ERROR.NEXT_DAY_OVERLAP, weekday: 1, nextWeekday: 2 }])
  })

  it('rechaza un nocturno del domingo que pisa el lunes (la semana se repite)', () => {
    const week = { 7: [shift('23:00', '07:30')], 1: [shift('07:00', '14:00')] }
    expect(validateWeekShifts(week).errors).toEqual([{ code: SHIFT_ERROR.NEXT_DAY_OVERLAP, weekday: 7, nextWeekday: 1 }])
  })

  it('acepta un domingo de noche hasta las 06:00 con el lunes desde las 06:00', () => {
    expect(validateWeekShifts({ 7: [shift('22:00', '06:00')], 1: [shift('06:00', '14:00')] }).valid).toBe(true)
  })

  it('rechaza días fuera de 1-7 y formatos que no son una semana', () => {
    expect(validateWeekShifts({ 8: [] }).errors).toEqual([{ code: SHIFT_ERROR.INVALID_WEEKDAY, weekday: '8' }])
    expect(validateWeekShifts({ 0: [] }).valid).toBe(false)
    expect(validateWeekShifts([]).errors).toEqual([{ code: SHIFT_ERROR.NOT_A_WEEK }])
    expect(validateWeekShifts(null).valid).toBe(false)
  })

  it('indica el día de la semana de cada error', () => {
    expect(validateWeekShifts({ 3: [shift('07:00', '07:00')] }).errors)
      .toEqual([{ code: SHIFT_ERROR.SAME_START_END, index: 0, weekday: 3 }])
  })

  it('getWeekdayShifts devuelve [] para un día de descanso', () => {
    expect(getWeekdayShifts(W1, 7)).toEqual([])
    expect(getWeekdayShifts(WNIGHT, 2)).toEqual([])
    expect(getWeekdayShifts(null, 1)).toEqual([])
    expect(getWeekdayShifts(W1, 1)).toEqual([shift('07:00', '14:00')])
  })

  it('total semanal nominal del horario habitual', () => {
    expect(getWeekTemplateMinutes(W1)).toBe(H(41))
    expect(getWeekTemplateMinutes(WNIGHT)).toBe(H(22))
    expect(getWeekTemplateMinutes({})).toBe(0)
  })
})

// ---------------------------------------------------------------- Fechas

describe('fechas de la semana', () => {
  it('la semana va de lunes a domingo', () => {
    expect(getWeekStart('2026-11-02')).toBe('2026-11-02')
    expect(getWeekStart('2026-11-05')).toBe('2026-11-02')
    expect(getWeekStart('2026-11-08')).toBe('2026-11-02')
    expect(getWeekStart('2026-11-09')).toBe('2026-11-09')
  })

  it('cruza años y meses', () => {
    expect(getWeekStart('2027-01-01')).toBe('2026-12-28')
    expect(getWeekDates('2027-01-01')).toEqual(['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03'])
  })

  it('una fecha no válida no tiene semana', () => {
    expect(getWeekStart('2026-02-30')).toBeNull()
    expect(getWeekDates('x')).toEqual([])
  })

  it('listDates incluye ambos extremos y los años bisiestos', () => {
    expect(listDates('2028-02-28', '2028-03-01')).toEqual(['2028-02-28', '2028-02-29', '2028-03-01'])
    expect(listDates('2026-11-05', '2026-11-05')).toEqual(['2026-11-05'])
    expect(listDates('2026-11-06', '2026-11-05')).toEqual([])
    expect(listDates('x', '2026-11-05')).toEqual([])
  })
})

// ------------------------------------------------- Zona horaria (Madrid)

describe('zona horaria Europe/Madrid', () => {
  it('desplazamiento de invierno (UTC+1) y de verano (UTC+2)', () => {
    expect(getTimeZoneOffsetMinutes(Date.UTC(2026, 10, 5, 12))).toBe(60)
    expect(getTimeZoneOffsetMinutes(Date.UTC(2026, 6, 1, 12))).toBe(120)
  })

  it('hora normal: un único instante', () => {
    expect(localTimeToInstant('2026-11-05', H(7))).toEqual({ instant: Date.UTC(2026, 10, 5, 6), nonexistent: false, ambiguous: false })
    expect(localTimeToInstant('2026-07-01', H(7))).toEqual({ instant: Date.UTC(2026, 6, 1, 5), nonexistent: false, ambiguous: false })
  })

  it.each(['02:00', '02:30', '02:59'])('primavera: %s del 28/03/2027 no existe', (time) => {
    expect(localTimeToInstant('2027-03-28', parseShiftTime(time))).toEqual({ instant: null, nonexistent: true, ambiguous: false })
  })

  it('primavera: 01:59 y 03:00 sí existen', () => {
    expect(localTimeToInstant('2027-03-28', parseShiftTime('01:59')).instant).toBe(Date.UTC(2027, 2, 28, 0, 59))
    expect(localTimeToInstant('2027-03-28', parseShiftTime('03:00')).instant).toBe(Date.UTC(2027, 2, 28, 1, 0))
  })

  it.each(['02:00', '02:30', '02:59'])('otoño: %s del 31/10/2027 se repite y se toma la primera aparición (UTC+2)', (time) => {
    const minutes = parseShiftTime(time)
    expect(localTimeToInstant('2027-10-31', minutes)).toEqual({
      instant: Date.UTC(2027, 9, 31, 0, minutes - 120),
      nonexistent: false,
      ambiguous: true,
    })
  })

  it('otoño: 01:59 y 03:00 no son ambiguas', () => {
    expect(localTimeToInstant('2027-10-31', parseShiftTime('01:59'))).toEqual({ instant: Date.UTC(2027, 9, 30, 23, 59), nonexistent: false, ambiguous: false })
    expect(localTimeToInstant('2027-10-31', parseShiftTime('03:00'))).toEqual({ instant: Date.UTC(2027, 9, 31, 2, 0), nonexistent: false, ambiguous: false })
  })

  it('también funciona con los cambios de hora de 2026', () => {
    expect(localTimeToInstant('2026-03-29', parseShiftTime('02:30')).nonexistent).toBe(true)
    expect(localTimeToInstant('2026-10-25', parseShiftTime('02:30')).ambiguous).toBe(true)
  })
})

describe('getShiftDuration: horas reales', () => {
  it('turno de día y turno nocturno de un día normal', () => {
    expect(getShiftDuration('2026-11-05', shift('07:00', '14:00'))).toMatchObject({ minutes: H(7), overnight: false, error: null })
    expect(getShiftDuration('2026-11-05', shift('22:00', '06:00'))).toMatchObject({ minutes: H(8), overnight: true, error: null })
    expect(getShiftDuration('2026-11-05', shift('18:00', '00:00'))).toMatchObject({ minutes: H(6), overnight: true })
    expect(getShiftDuration('2026-11-05', shift('00:00', '06:00'))).toMatchObject({ minutes: H(6), overnight: false })
    expect(getShiftDuration('2026-11-05', shift('23:00', '22:00')).minutes).toBe(H(23))
  })

  it('el turno nocturno acaba al día siguiente: los instantes lo reflejan', () => {
    const result = getShiftDuration('2026-11-08', shift('22:00', '06:00'))
    expect(result.startsAt).toBe(Date.UTC(2026, 10, 8, 21))
    expect(result.endsAt).toBe(Date.UTC(2026, 10, 9, 5))
  })

  it('la noche del cambio al horario de verano dura una hora menos', () => {
    expect(getShiftDuration('2027-03-27', shift('22:00', '06:00')).minutes).toBe(H(7))
    expect(getShiftDuration('2026-03-28', shift('22:00', '06:00')).minutes).toBe(H(7))
    expect(getShiftDuration('2027-03-28', shift('01:00', '04:00')).minutes).toBe(H(2))
    expect(getShiftDuration('2027-03-27', shift('22:00', '03:00')).minutes).toBe(H(4))
  })

  it('la noche del cambio al horario de invierno dura una hora más', () => {
    expect(getShiftDuration('2027-10-30', shift('22:00', '06:00')).minutes).toBe(H(9))
    expect(getShiftDuration('2026-10-24', shift('22:00', '06:00')).minutes).toBe(H(9))
    expect(getShiftDuration('2027-10-31', shift('01:00', '04:00')).minutes).toBe(H(4))
  })

  it('hora repetida: se toma la primera aparición en el inicio y en el fin', () => {
    expect(getShiftDuration('2027-10-31', shift('01:00', '03:00'))).toMatchObject({ minutes: H(3), ambiguous: false })
    expect(getShiftDuration('2027-10-31', shift('02:30', '06:00'))).toMatchObject({ minutes: 270, ambiguous: true })
    expect(getShiftDuration('2027-10-31', shift('02:15', '02:45'))).toMatchObject({ minutes: 30, ambiguous: true })
    expect(getShiftDuration('2027-10-31', shift('01:30', '02:30'))).toMatchObject({ minutes: 60, ambiguous: true })
    expect(getShiftDuration('2027-10-30', shift('22:00', '02:30'))).toMatchObject({ minutes: 270, ambiguous: true })
  })

  it('hora inexistente al inicio: error, sin minutos ni corrección', () => {
    const result = getShiftDuration('2027-03-28', shift('02:30', '06:00'))
    expect(result.minutes).toBeNull()
    expect(result.startsAt).toBeNull()
    expect(result.error).toEqual({ code: SHIFT_ERROR.NONEXISTENT_TIME, date: '2027-03-28', time: '02:30' })
  })

  it('hora inexistente al final de un turno nocturno: error en el día siguiente', () => {
    const result = getShiftDuration('2027-03-27', shift('22:00', '02:15'))
    expect(result.minutes).toBeNull()
    expect(result.error).toEqual({ code: SHIFT_ERROR.NONEXISTENT_TIME, date: '2027-03-28', time: '02:15' })
  })

  it('turno o fecha no válidos', () => {
    expect(getShiftDuration('2026-11-05', shift('07:00', '07:00')).error.code).toBe(SHIFT_ERROR.INVALID_TIME)
    expect(getShiftDuration('2026-11-05', shift('7:00', '14:00')).error.code).toBe(SHIFT_ERROR.INVALID_TIME)
    expect(getShiftDuration('2026-02-30', shift('07:00', '14:00')).error.code).toBe(SHIFT_ERROR.INVALID_TIME)
  })

  it('mensaje comprensible para una hora inexistente', () => {
    expect(describeShiftError(getShiftDuration('2027-03-28', shift('02:30', '06:00')).error))
      .toBe('La hora 02:30 no existe el 28/03/2027 por el cambio al horario de verano. Modifica el turno.')
    expect(describeShiftError(null)).toBe('')
    expect(describeShiftError({ code: SHIFT_ERROR.INVALID_TIME })).toBe('El turno no tiene un formato válido.')
  })
})

// ------------------------------------------------ Versiones del horario

describe('versiones del horario', () => {
  const versions = [
    version(ana, '2026-11-09', W1),
    version(ana, '2026-10-01', WNIGHT),
    closing(ana, '2026-12-01'),
    version(ana, '2027-01-11', W1),
  ]

  it('ordena por fecha de inicio', () => {
    expect(sortScheduleVersions(versions).map(v => v.valid_from)).toEqual(['2026-10-01', '2026-11-09', '2026-12-01', '2027-01-11'])
  })

  it('la versión vigente es la más reciente igual o anterior a la fecha', () => {
    expect(getVersionForDate(versions, '2026-09-30')).toBeNull()
    expect(getVersionForDate(versions, '2026-10-01').valid_from).toBe('2026-10-01')
    expect(getVersionForDate(versions, '2026-11-08').valid_from).toBe('2026-10-01')
    expect(getVersionForDate(versions, '2026-11-09').valid_from).toBe('2026-11-09')
    expect(getVersionForDate(versions, '2026-12-15').kind).toBe(SCHEDULE_KIND.END)
    expect(getVersionForDate(versions, '2030-01-01').valid_from).toBe('2027-01-11')
    expect(getVersionForDate([], '2026-11-05')).toBeNull()
  })

  it('cada versión rige hasta el día antes de la siguiente (sin solapes)', () => {
    expect(getVersionPeriods(versions).map(({ from, to, kind }) => ({ from, to, kind }))).toEqual([
      { from: '2026-10-01', to: '2026-11-08', kind: 'schedule' },
      { from: '2026-11-09', to: '2026-11-30', kind: 'schedule' },
      { from: '2026-12-01', to: '2027-01-10', kind: 'end' },
      { from: '2027-01-11', to: null, kind: 'schedule' },
    ])
  })
})

// --------------------------------------------- Horario de un día concreto

describe('resolveEmployeeDay: prioridades', () => {
  const base = { employee: ana, versions: [version(ana, '2026-11-02', W1)] }

  it('sin ninguna versión: sin horario', () => {
    expect(day({ employee: ana }, '2026-11-05')).toMatchObject({ status: DAY_STATUS.NO_SCHEDULE, shifts: [], minutes: 0 })
  })

  it('antes de la primera versión (incorporación futura): sin horario', () => {
    expect(day(base, '2026-11-01').status).toBe(DAY_STATUS.NO_SCHEDULE)
    expect(day(base, '2026-11-02').status).toBe(DAY_STATUS.REGULAR)
  })

  it('horario habitual: turnos del día de la semana y horas reales', () => {
    const result = day(base, '2026-11-05')
    expect(result.status).toBe(DAY_STATUS.REGULAR)
    expect(result.weekday).toBe(4)
    expect(result.shifts).toHaveLength(1)
    expect(result.shifts[0]).toMatchObject({ start: '07:00', end: '14:00', minutes: H(7), origin: SHIFT_ORIGIN.REGULAR })
    expect(result.minutes).toBe(H(7))
  })

  it('descanso habitual: el día sin turnos o que no aparece en la semana', () => {
    expect(day(base, '2026-11-08')).toMatchObject({ status: DAY_STATUS.REST, minutes: 0 })
    expect(day({ employee: ana, versions: [version(ana, '2026-11-02', WNIGHT)] }, '2026-11-03').status).toBe(DAY_STATUS.REST)
  })

  it('un cambio de un día sustituye al horario habitual y se marca como excepción', () => {
    const result = day({ ...base, overrides: [override(ana, '2026-11-05', [shift('10:00', '14:00'), shift('16:00', '19:00')])] }, '2026-11-05')
    expect(result.status).toBe(DAY_STATUS.OVERRIDE)
    expect(result.shifts.map(s => s.origin)).toEqual([SHIFT_ORIGIN.OVERRIDE, SHIFT_ORIGIN.OVERRIDE])
    expect(result.minutes).toBe(H(7))
    expect(result.override.id).toBe('o-e-ana-2026-11-05')
    expect(day({ ...base, overrides: [override(ana, '2026-11-05', [])] }, '2026-11-06').status).toBe(DAY_STATUS.REGULAR)
  })

  it('un cambio sin turnos es un día libre', () => {
    expect(day({ ...base, overrides: [override(ana, '2026-11-05', [])] }, '2026-11-05')).toMatchObject({ status: DAY_STATUS.DAY_OFF, minutes: 0 })
  })

  it('un cambio también vale antes de la primera versión', () => {
    expect(day({ ...base, overrides: [override(ana, '2026-10-30', [shift('08:00', '12:00')])] }, '2026-10-30'))
      .toMatchObject({ status: DAY_STATUS.OVERRIDE, minutes: H(4) })
  })

  it('una ausencia tiene prioridad sobre el cambio del día y el horario habitual', () => {
    const params = {
      ...base,
      overrides: [override(ana, '2026-11-05', [shift('10:00', '14:00')])],
      absences: [absence(ana, '2026-11-04', '2026-11-06', 'leave')],
    }
    expect(day(params, '2026-11-03').status).toBe(DAY_STATUS.REGULAR)
    expect(day(params, '2026-11-04')).toMatchObject({ status: DAY_STATUS.ABSENCE, minutes: 0 })
    expect(day(params, '2026-11-05')).toMatchObject({ status: DAY_STATUS.ABSENCE, minutes: 0, override: null })
    expect(day(params, '2026-11-05').absence.absence_type).toBe('leave')
    expect(day(params, '2026-11-06').status).toBe(DAY_STATUS.ABSENCE)
    expect(day(params, '2026-11-07').status).toBe(DAY_STATUS.REGULAR)
  })

  it('una versión de fin deja los días sin horario, aunque haya cambios o ausencias', () => {
    const params = {
      employee: ana,
      versions: [version(ana, '2026-10-01', W1), closing(ana, '2026-11-04')],
      overrides: [override(ana, '2026-11-05', [shift('07:00', '14:00')])],
      absences: [absence(ana, '2026-11-06', '2026-11-06')],
    }
    expect(day(params, '2026-11-03').status).toBe(DAY_STATUS.REGULAR)
    for (const date of ['2026-11-04', '2026-11-05', '2026-11-06']) {
      expect(day(params, date)).toMatchObject({ status: DAY_STATUS.TERMINATED, terminatedReason: 'closed_schedule', minutes: 0 })
    }
  })

  it('versión de fin: horario cerrado si sigue activa sin versión posterior; si no, periodo de baja', () => {
    const versions = [version(ana, '2026-10-01', W1), closing(ana, '2026-11-04')]
    expect(day({ employee: ana, versions }, '2026-11-04').terminatedReason).toBe('closed_schedule')
    expect(day({ employee: { ...ana, is_active: false }, versions }, '2026-11-04').terminatedReason).toBe('leave_period')
    const reactivated = [...versions, version(ana, '2026-11-09', W1)]
    expect(day({ employee: ana, versions: reactivated }, '2026-11-05')).toMatchObject({ status: DAY_STATUS.TERMINATED, terminatedReason: 'leave_period' })
    expect(day({ employee: ana, versions: reactivated }, '2026-11-09').status).toBe(DAY_STATUS.REGULAR)
  })

  it('después del último día de trabajo: baja (el último día cuenta)', () => {
    const employee = { ...ana, is_active: false, last_working_date: '2026-11-04' }
    const params = { employee, versions: [version(ana, '2026-10-01', W1)], overrides: [override(ana, '2026-11-05', [shift('07:00', '09:00')])] }
    expect(day(params, '2026-11-04')).toMatchObject({ status: DAY_STATUS.REGULAR, minutes: H(7) })
    expect(day(params, '2026-11-05')).toMatchObject({ status: DAY_STATUS.TERMINATED, terminatedReason: 'after_last_day', minutes: 0 })
  })

  it('reactivación: periodo de baja sin horario y el horario nuevo desde la vuelta', () => {
    const params = {
      employee: ana,
      versions: [version(ana, '2026-09-01', W1), closing(ana, '2026-10-10'), version(ana, '2026-11-09', WNIGHT)],
    }
    expect(day(params, '2026-10-09').status).toBe(DAY_STATUS.REGULAR)
    expect(day(params, '2026-10-10').status).toBe(DAY_STATUS.TERMINATED)
    expect(day(params, '2026-11-08').status).toBe(DAY_STATUS.TERMINATED)
    expect(day(params, '2026-11-09')).toMatchObject({ status: DAY_STATUS.REGULAR, minutes: H(7) })
  })

  it('el cambio de versión ocurre exactamente en su fecha de inicio', () => {
    const params = { employee: ana, versions: [version(ana, '2026-10-01', W1), version(ana, '2026-11-09', { 1: [shift('08:00', '15:00')] })] }
    expect(day(params, '2026-11-02').shifts[0].start).toBe('07:00')
    expect(day(params, '2026-11-09').shifts[0].start).toBe('08:00')
  })

  it('ignora los datos de otras empleadas', () => {
    const params = {
      employee: ana,
      versions: [version(ana, '2026-11-02', W1), version(berta, '2026-11-02', WNIGHT)],
      overrides: [override(berta, '2026-11-05', [])],
      absences: [absence(berta, '2026-11-05', '2026-11-05')],
    }
    expect(day(params, '2026-11-05')).toMatchObject({ status: DAY_STATUS.REGULAR, minutes: H(7) })
  })

  it('suma varios turnos del día ordenados por inicio', () => {
    const params = { employee: ana, versions: [version(ana, '2026-11-02', { 4: [shift('17:00', '20:00'), shift('07:00', '14:00')] })] }
    const result = day(params, '2026-11-05')
    expect(result.shifts.map(s => s.start)).toEqual(['07:00', '17:00'])
    expect(result.minutes).toBe(H(10))
  })

  it('un turno nocturno cuenta entero en el día en que empieza', () => {
    const params = { employee: ana, versions: [version(ana, '2026-11-02', WSUNDAY)] }
    expect(day(params, '2026-11-08')).toMatchObject({ status: DAY_STATUS.REGULAR, minutes: H(8) })
    expect(day(params, '2026-11-09')).toMatchObject({ status: DAY_STATUS.REST, minutes: 0 })
  })

  it('horario habitual con una hora que no existe ese domingo: error en ese día y no suma', () => {
    const params = { employee: ana, versions: [version(ana, '2027-01-04', { 7: [shift('02:30', '06:00'), shift('10:00', '12:00')] })] }
    const spring = day(params, '2027-03-28')
    expect(spring.minutes).toBe(H(2))
    expect(spring.errors).toEqual([{ code: SHIFT_ERROR.NONEXISTENT_TIME, date: '2027-03-28', time: '02:30' }])
    expect(day(params, '2027-03-21')).toMatchObject({ minutes: 330, errors: [] })
  })

  it('cambio de un día el domingo de primavera desde las 03:00: 3 horas reales', () => {
    const params = { ...base, overrides: [override(ana, '2027-03-28', [shift('03:00', '06:00')])] }
    expect(day(params, '2027-03-28')).toMatchObject({ status: DAY_STATUS.OVERRIDE, minutes: H(3), errors: [] })
  })

  it('findAbsenceForDate y findOverrideForDate', () => {
    const absences = [absence(ana, '2026-11-04', '2026-11-06')]
    expect(findAbsenceForDate(absences, '2026-11-03')).toBeNull()
    expect(findAbsenceForDate(absences, '2026-11-04')).not.toBeNull()
    expect(findAbsenceForDate(absences, '2026-11-06')).not.toBeNull()
    expect(findAbsenceForDate(null, '2026-11-06')).toBeNull()
    expect(findOverrideForDate([override(ana, '2026-11-05', [])], '2026-11-05')).not.toBeNull()
    expect(findOverrideForDate([], '2026-11-05')).toBeNull()
  })

  it('no modifica los datos de entrada', () => {
    const params = {
      employee: ana,
      versions: [version(ana, '2026-11-02', W1)],
      overrides: [override(ana, '2026-11-05', [shift('17:00', '20:00'), shift('07:00', '14:00')])],
      absences: [absence(ana, '2026-11-06', '2026-11-06')],
    }
    const copy = structuredClone(params)
    day(params, '2026-11-05')
    expect(params).toEqual(copy)
  })
})

// ------------------------------------------------------------ Conflictos

describe('conflictos entre días consecutivos', () => {
  it('sin conflictos en un horario válido', () => {
    const week = buildEmployeeWeek({ employee: ana, versions: [version(ana, '2026-10-01', WNIGHT)], date: '2026-11-02' })
    expect(week.conflicts).toEqual([])
  })

  it('un cambio del jueves que empieza antes de que acabe el nocturno del miércoles', () => {
    const week = buildEmployeeWeek({
      employee: ana,
      versions: [version(ana, '2026-10-01', WNIGHT)],
      overrides: [override(ana, '2026-11-05', [shift('05:00', '10:00')])],
      date: '2026-11-02',
    })
    expect(week.conflicts).toEqual([{ type: CONFLICT_TYPE.NEXT_DAY, date: '2026-11-04', nextDate: '2026-11-05' }])
    expect(week.days.filter(d => d.hasConflict).map(d => d.date)).toEqual(['2026-11-04', '2026-11-05'])
  })

  it('domingo anterior con el lunes de la semana', () => {
    const week = buildEmployeeWeek({
      employee: ana,
      versions: [version(ana, '2026-10-01', WSUNDAY)],
      overrides: [override(ana, '2026-11-02', [shift('05:00', '10:00')])],
      date: '2026-11-04',
    })
    expect(week.conflicts).toEqual([{ type: CONFLICT_TYPE.NEXT_DAY, date: '2026-11-01', nextDate: '2026-11-02' }])
    expect(week.days[0].hasConflict).toBe(true)
  })

  it('domingo de la semana con el lunes siguiente', () => {
    const week = buildEmployeeWeek({
      employee: ana,
      versions: [version(ana, '2026-10-01', WSUNDAY)],
      overrides: [override(ana, '2026-11-09', [shift('05:00', '10:00')])],
      date: '2026-11-02',
    })
    expect(week.conflicts).toEqual([{ type: CONFLICT_TYPE.NEXT_DAY, date: '2026-11-08', nextDate: '2026-11-09' }])
    expect(week.days[6].hasConflict).toBe(true)
  })

  it('domingo con lunes al cambiar de versión', () => {
    const week = buildEmployeeWeek({
      employee: ana,
      versions: [version(ana, '2026-10-01', WSUNDAY), version(ana, '2026-11-09', { 1: [shift('05:00', '12:00')] })],
      date: '2026-11-09',
    })
    expect(week.conflicts).toEqual([{ type: CONFLICT_TYPE.NEXT_DAY, date: '2026-11-08', nextDate: '2026-11-09' }])
  })

  it('una ausencia que tapa el día evita el conflicto', () => {
    const week = buildEmployeeWeek({
      employee: ana,
      versions: [version(ana, '2026-10-01', WNIGHT)],
      overrides: [override(ana, '2026-11-05', [shift('05:00', '10:00')])],
      absences: [absence(ana, '2026-11-05', '2026-11-05')],
      date: '2026-11-02',
    })
    expect(week.conflicts).toEqual([])
  })

  it('conflictos que aparecen al quitar algo (datos ya guardados)', () => {
    // Si se borra la ausencia que ocultaba el cambio, el conflicto reaparece.
    const params = {
      employee: ana,
      versions: [version(ana, '2026-10-01', WNIGHT)],
      overrides: [override(ana, '2026-11-05', [shift('05:00', '10:00')])],
      date: '2026-11-02',
    }
    expect(buildEmployeeWeek(params).conflicts).toHaveLength(1)
  })

  it('turnos solapados el mismo día (datos ya guardados)', () => {
    const days = [{ date: '2026-11-05', shifts: [shift('07:00', '14:00'), shift('13:00', '15:00')] }]
    expect(findShiftConflicts(days)).toEqual([{ type: CONFLICT_TYPE.SAME_DAY, date: '2026-11-05' }])
  })

  it('solo compara días consecutivos', () => {
    const days = [
      { date: '2026-11-04', shifts: [shift('22:00', '06:00')] },
      { date: '2026-11-06', shifts: [shift('05:00', '10:00')] },
    ]
    expect(findShiftConflicts(days)).toEqual([])
    expect(findShiftConflicts(null)).toEqual([])
  })
})

// ---------------------------------------------- Semana de una empleada

describe('buildEmployeeWeek: totales', () => {
  it('total de la semana con el horario habitual', () => {
    const week = buildEmployeeWeek({ employee: ana, versions: [version(ana, '2026-10-01', W1)], date: '2026-11-05' })
    expect(week.weekStart).toBe('2026-11-02')
    expect(week.days.map(d => d.date)).toEqual(getWeekDates('2026-11-02'))
    expect(week.days.map(d => d.minutes)).toEqual([H(7), H(7), H(7), H(7), H(7), H(6), 0])
    expect(week.totalMinutes).toBe(H(41))
    expect(week.hasPlanning).toBe(true)
  })

  it('el nocturno del domingo cuenta entero en esa semana y no en la siguiente', () => {
    const params = { employee: ana, versions: [version(ana, '2026-10-01', WSUNDAY)] }
    expect(buildEmployeeWeek({ ...params, date: '2026-11-02' }).totalMinutes).toBe(H(8))
    expect(buildEmployeeWeek({ ...params, date: '2026-11-09' }).days[0].minutes).toBe(0)
  })

  it('semana del cambio al horario de invierno: el nocturno del sábado dura 9 h', () => {
    const params = { employee: ana, versions: [version(ana, '2026-01-05', { 6: [shift('22:00', '06:00')] })] }
    expect(buildEmployeeWeek({ ...params, date: '2026-10-19' }).totalMinutes).toBe(H(9))
    expect(buildEmployeeWeek({ ...params, date: '2026-11-02' }).totalMinutes).toBe(H(8))
  })

  it('semana del cambio al horario de verano: el nocturno del sábado dura 7 h', () => {
    const params = { employee: ana, versions: [version(ana, '2027-01-04', { 6: [shift('22:00', '06:00')] })] }
    expect(buildEmployeeWeek({ ...params, date: '2027-03-22' }).totalMinutes).toBe(H(7))
  })

  it('cuenta los errores por horas inexistentes', () => {
    const week = buildEmployeeWeek({ employee: ana, versions: [version(ana, '2027-01-04', { 7: [shift('02:30', '06:00')] })], date: '2027-03-22' })
    expect(week.errorCount).toBe(1)
    expect(week.totalMinutes).toBe(0)
  })

  it('cambios, días libres y ausencias en la semana', () => {
    const week = buildEmployeeWeek({
      employee: ana,
      versions: [version(ana, '2026-10-01', W1)],
      overrides: [override(ana, '2026-11-03', []), override(ana, '2026-11-08', [shift('09:00', '13:00')])],
      absences: [absence(ana, '2026-11-05', '2026-11-06')],
      date: '2026-11-02',
    })
    expect(week.days.map(d => d.status)).toEqual([
      DAY_STATUS.REGULAR, DAY_STATUS.DAY_OFF, DAY_STATUS.REGULAR, DAY_STATUS.ABSENCE,
      DAY_STATUS.ABSENCE, DAY_STATUS.REGULAR, DAY_STATUS.OVERRIDE,
    ])
    expect(week.totalMinutes).toBe(H(7 + 7 + 6 + 4))
  })

  it('sin horario: sin planificación', () => {
    const week = buildEmployeeWeek({ employee: ana, date: '2026-11-02' })
    expect(week.hasPlanning).toBe(false)
    expect(week.totalMinutes).toBe(0)
  })

  it('fecha no válida', () => {
    expect(buildEmployeeWeek({ employee: ana, date: 'x' })).toBeNull()
  })
})

describe('isEmployeeVisibleInWeek', () => {
  const today = '2026-11-05'
  const week = (employee, versions, date) => buildEmployeeWeek({ employee, versions, date })

  it('activa sin horario: aparece en la semana actual y en las futuras, no en las pasadas', () => {
    expect(isEmployeeVisibleInWeek(ana, week(ana, [], '2026-11-02'), { today })).toBe(true)
    expect(isEmployeeVisibleInWeek(ana, week(ana, [], '2026-11-16'), { today })).toBe(true)
    expect(isEmployeeVisibleInWeek(ana, week(ana, [], '2026-10-26'), { today })).toBe(false)
  })

  it('con horario en una semana pasada: aparece', () => {
    expect(isEmployeeVisibleInWeek(ana, week(ana, [version(ana, '2026-10-01', W1)], '2026-10-26'), { today })).toBe(true)
  })

  it('dada de baja: aparece hasta la semana de su último día y nunca después', () => {
    const employee = { ...ana, is_active: false, last_working_date: '2026-11-04' }
    const versions = [version(ana, '2026-10-01', W1), closing(ana, '2026-11-05')]
    expect(isEmployeeVisibleInWeek(employee, week(employee, versions, '2026-10-26'), { today })).toBe(true)
    expect(isEmployeeVisibleInWeek(employee, week(employee, versions, '2026-11-02'), { today })).toBe(true)
    expect(isEmployeeVisibleInWeek(employee, week(employee, versions, '2026-11-09'), { today })).toBe(false)
  })

  it('desactivada sin fecha pero con horario: no aparece en semanas futuras', () => {
    const employee = { ...ana, is_active: false }
    const versions = [version(ana, '2026-10-01', W1)]
    expect(isEmployeeVisibleInWeek(employee, week(employee, versions, '2026-11-02'), { today })).toBe(true)
    expect(isEmployeeVisibleInWeek(employee, week(employee, versions, '2026-11-09'), { today })).toBe(false)
  })

  it('desactivada antes del módulo (sin fecha ni horario): no aparece', () => {
    const employee = { ...ana, is_active: false }
    expect(isEmployeeVisibleInWeek(employee, week(employee, [], '2026-11-02'), { today })).toBe(false)
  })

  it('sin semana: no aparece', () => {
    expect(isEmployeeVisibleInWeek(ana, null, { today })).toBe(false)
  })
})

// ----------------------------------------------------- Semana de la plantilla

describe('buildWeekPlan', () => {
  const employees = [
    carmen,
    ana,
    berta,
    { id: 'e-dana', first_name: 'Dana', last_name: 'Vidal', is_active: false, last_working_date: '2026-10-20' },
  ]
  const versions = [
    version(ana, '2026-10-01', W1),
    version(berta, '2026-10-01', WNIGHT),
    version({ id: 'e-dana' }, '2026-09-01', W1),
    closing({ id: 'e-dana' }, '2026-10-21'),
  ]
  const plan = buildWeekPlan({
    employees,
    versions,
    overrides: [override(berta, '2026-11-05', [shift('05:00', '10:00')])],
    absences: [absence(ana, '2026-11-06', '2026-11-06')],
    date: '2026-11-05',
    today: '2026-11-05',
  })

  it('filas ordenadas por nombre; la dada de baja antes de la semana no aparece', () => {
    expect(plan.rows.map(row => row.name)).toEqual(['Ana López', 'Berta Sanz', 'Carmen Ruiz'])
    expect(plan.weekStart).toBe('2026-11-02')
    expect(plan.dates).toHaveLength(7)
  })

  it('totales por empleada, por día y de la plantilla', () => {
    const [anaRow, bertaRow, carmenRow] = plan.rows
    expect(anaRow.totalMinutes).toBe(H(7 * 4 + 6))
    expect(bertaRow.totalMinutes).toBe(H(7 + 8 + 5))
    expect(carmenRow.totalMinutes).toBe(0)
    expect(plan.dayTotals).toEqual([H(14), H(7), H(15), H(12), 0, H(6), 0])
    expect(plan.totalMinutes).toBe(anaRow.totalMinutes + bertaRow.totalMinutes)
  })

  it('cuenta los conflictos de la plantilla', () => {
    expect(plan.conflictCount).toBe(1)
    expect(plan.rows[1].conflicts).toEqual([{ type: CONFLICT_TYPE.NEXT_DAY, date: '2026-11-04', nextDate: '2026-11-05' }])
  })

  it('la dada de baja sí aparece en una semana en la que trabajó', () => {
    const past = buildWeekPlan({ employees, versions, date: '2026-10-19', today: '2026-11-05' })
    const dana = past.rows.find(row => row.employeeId === 'e-dana')
    expect(dana.days.map(d => d.status)).toEqual([
      DAY_STATUS.REGULAR, DAY_STATUS.REGULAR, DAY_STATUS.TERMINATED, DAY_STATUS.TERMINATED,
      DAY_STATUS.TERMINATED, DAY_STATUS.TERMINATED, DAY_STATUS.TERMINATED,
    ])
    expect(dana.totalMinutes).toBe(H(14))
  })

  it('sin empleadas: plan vacío', () => {
    const empty = buildWeekPlan({ date: '2026-11-05', today: '2026-11-05' })
    expect(empty.rows).toEqual([])
    expect(empty.totalMinutes).toBe(0)
    expect(empty.dayTotals).toEqual([0, 0, 0, 0, 0, 0, 0])
  })
})

// --------------------------------------------- Totales de un periodo

describe('summarizePlannedMinutes', () => {
  it('total de un mes natural por empleada', () => {
    const totals = summarizePlannedMinutes({
      employees: [ana, berta],
      versions: [version(ana, '2026-10-01', W1)],
      from: '2026-11-01',
      to: '2026-11-30',
    })
    // Noviembre de 2026: 21 días de lunes a viernes y 4 sábados.
    expect(totals.get('e-ana')).toEqual({ minutes: H(21 * 7 + 4 * 6), errorCount: 0 })
    expect(totals.get('e-berta')).toEqual({ minutes: 0, errorCount: 0 })
  })

  it('un nocturno del último día del periodo cuenta entero; el del día anterior al periodo, no', () => {
    const params = { employees: [ana], versions: [version(ana, '2026-10-01', WSUNDAY)] }
    expect(summarizePlannedMinutes({ ...params, from: '2026-11-02', to: '2026-11-08' }).get('e-ana').minutes).toBe(H(8))
    expect(summarizePlannedMinutes({ ...params, from: '2026-11-09', to: '2026-11-14' }).get('e-ana').minutes).toBe(0)
  })

  it('periodo no válido: cero', () => {
    expect(summarizePlannedMinutes({ employees: [ana], versions: [version(ana, '2026-10-01', W1)], from: '2026-11-30', to: '2026-11-01' }).get('e-ana').minutes).toBe(0)
  })
})

describe('buildPlannedVsOvertime (preparado, todavía no se muestra)', () => {
  const inactive = { id: 'e-eva', first_name: 'Eva', last_name: 'Mora', is_active: false, last_working_date: null }
  const silent = { id: 'e-fina', first_name: 'Fina', last_name: 'Gil', is_active: false, last_working_date: null }
  const overtimeEntries = [
    { id: 'x1', employee_id: 'e-ana', work_date: '2026-11-03', duration_minutes: 45 },
    { id: 'x2', employee_id: 'e-ana', work_date: '2026-11-08', duration_minutes: 30 },
    { id: 'x3', employee_id: 'e-ana', work_date: '2026-11-09', duration_minutes: 60 },
    { id: 'x4', employee_id: 'e-eva', work_date: '2026-11-04', duration_minutes: 20 },
    { id: 'x5', employee_id: 'e-ana', work_date: '2026-11-01', duration_minutes: 15 },
  ]
  const params = {
    employees: [ana, berta, inactive, silent],
    versions: [version(ana, '2026-10-01', W1)],
    overtimeEntries,
    from: '2026-11-02',
    to: '2026-11-08',
  }

  it('pone las horas previstas junto a las horas extra del mismo periodo', () => {
    const result = buildPlannedVsOvertime(params)
    expect(result.rows.map(({ employeeId, plannedMinutes, overtimeMinutes, overtimeCount }) => ({ employeeId, plannedMinutes, overtimeMinutes, overtimeCount }))).toEqual([
      { employeeId: 'e-ana', plannedMinutes: H(41), overtimeMinutes: 75, overtimeCount: 2 },
      { employeeId: 'e-berta', plannedMinutes: 0, overtimeMinutes: 0, overtimeCount: 0 },
      { employeeId: 'e-eva', plannedMinutes: 0, overtimeMinutes: 20, overtimeCount: 1 },
    ])
    expect(result.plannedMinutes).toBe(H(41))
    expect(result.overtimeMinutes).toBe(95)
    expect(result.from).toBe('2026-11-02')
    expect(result.to).toBe('2026-11-08')
  })

  it('no incluye inactivas sin horas previstas ni horas extra', () => {
    expect(buildPlannedVsOvertime(params).rows.some(row => row.employeeId === 'e-fina')).toBe(false)
  })

  it('no modifica los registros de horas extra', () => {
    const copy = structuredClone(overtimeEntries)
    buildPlannedVsOvertime(params)
    expect(overtimeEntries).toEqual(copy)
  })
})
