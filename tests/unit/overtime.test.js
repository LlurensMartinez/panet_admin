import { describe, expect, it } from 'vitest'
import {
  OVERTIME_COLUMNS,
  OVERTIME_SUMMARY_VIEWS,
  formatSummaryTitle,
  getSummaryRange,
  shiftSummaryAnchor,
  summarizeOvertimeByEmployee,
  OVERTIME_PERIOD,
  addDaysToDate,
  getPeriodRange,
  describeOvertimeFilters,
  filterOvertimeEntries,
  formatDuration,
  formatDurationLong,
  formatWorkDate,
  getEntryEmployeeName,
  getOvertimeErrorFeedback,
  getOvertimeFieldErrors,
  getTodayDate,
  hasOvertimeChanges,
  isValidDate,
  normalizeOvertimeInput,
  parseDurationParts,
  removeOvertimeEntry,
  sortOvertimeEntries,
  splitMinutes,
  sumDurationMinutes,
  toOvertimeFormValues,
  upsertOvertimeEntry,
  validateDateRange,
  validateOvertimeInput,
} from '../../app/utils/overtime.js'
import { DB_ERROR_KIND } from '../../app/utils/database-errors.js'
import { AUTHZ_STATUS, getAccessDecision } from '../../app/utils/authorization.js'

const TODAY = '2026-10-28'

// Datos ficticios con la forma que devuelve la consulta (registro + empleado).
const entry = (id, employee_id, work_date, duration_minutes, extra = {}) => ({
  id,
  employee_id,
  work_date,
  duration_minutes,
  reason: null,
  notes: null,
  created_at: `${work_date}T18:00:00Z`,
  updated_at: `${work_date}T18:00:00Z`,
  employee: { id: employee_id, first_name: 'Ana', last_name: 'López', role: null, is_active: true },
  ...extra,
})

const entries = [
  entry('o1', 'ana', '2026-10-01', 90),
  entry('o2', 'ana', '2026-10-15', 45),
  entry('o3', 'luis', '2026-10-15', 30),
  entry('o4', 'luis', '2026-10-31', 120),
  entry('o5', 'ana', '2026-11-02', 15),
]

describe('columnas', () => {
  it('usa las columnas reales y la relación con employees', () => {
    expect(OVERTIME_COLUMNS).toBe('id, employee_id, work_date, duration_minutes, reason, notes, created_at, updated_at, employee:employees(id, first_name, last_name, role, is_active)')
  })
})

describe('minutos → horas y minutos', () => {
  it.each([
    [0, { hours: 0, minutes: 0 }, '0 h'],
    [1, { hours: 0, minutes: 1 }, '1 min'],
    [45, { hours: 0, minutes: 45 }, '45 min'],
    [60, { hours: 1, minutes: 0 }, '1 h'],
    [90, { hours: 1, minutes: 30 }, '1 h 30 min'],
    [1439, { hours: 23, minutes: 59 }, '23 h 59 min'],
    [1440, { hours: 24, minutes: 0 }, '24 h'],
    [1530, { hours: 25, minutes: 30 }, '25 h 30 min'],
  ])('%i min', (total, parts, text) => {
    expect(splitMinutes(total)).toEqual(parts)
    expect(formatDuration(total)).toBe(text)
  })

  it('texto largo para lectores de pantalla', () => {
    expect(formatDurationLong(61)).toBe('1 hora y 1 minuto')
    expect(formatDurationLong(150)).toBe('2 horas y 30 minutos')
    expect(formatDurationLong(45)).toBe('45 minutos')
    expect(formatDurationLong(120)).toBe('2 horas')
    expect(formatDurationLong(0)).toBe('0 horas')
  })
})

describe('horas y minutos → duration_minutes', () => {
  it.each([
    [{ hours: '1', minutes: '30' }, 90],
    [{ hours: '0', minutes: '1' }, 1],
    [{ hours: '', minutes: '45' }, 45],
    [{ hours: '2', minutes: '' }, 120],
    [{ hours: ' 2 ', minutes: ' 05 ' }, 125],
    [{ hours: '23', minutes: '59' }, 1439],
    [{ hours: '24', minutes: '0' }, 1440],
    [{ hours: 1, minutes: 15 }, 75],
  ])('%o → %i', (input, minutes) => {
    expect(parseDurationParts(input)).toEqual({ minutes, errors: [] })
  })

  it.each([
    ['vacía', { hours: '', minutes: '' }, 'duration', 'Indica la duración.'],
    ['cero', { hours: '0', minutes: '0' }, 'duration', 'La duración mínima es 1 minuto.'],
    ['más de 24 h', { hours: '24', minutes: '1' }, 'duration', 'La duración máxima es 24 horas por registro.'],
    ['25 horas', { hours: '25', minutes: '' }, 'duration', 'La duración máxima es 24 horas por registro.'],
    ['minutos ≥ 60', { hours: '1', minutes: '60' }, 'duration', 'Los minutos van de 0 a 59.'],
    ['horas decimales con punto', { hours: '1.5', minutes: '' }, 'duration', 'Escribe un número entero de horas.'],
    ['horas decimales con coma', { hours: '1,5', minutes: '' }, 'duration', 'Escribe un número entero de horas.'],
    ['minutos decimales', { hours: '', minutes: '30.5' }, 'duration', 'Escribe un número entero de minutos.'],
    ['negativos', { hours: '-1', minutes: '' }, 'duration', 'Escribe un número entero de horas.'],
    ['texto', { hours: 'dos', minutes: '' }, 'duration', 'Escribe un número entero de horas.'],
    ['notación científica', { hours: '1e1', minutes: '' }, 'duration', 'Escribe un número entero de horas.'],
  ])('rechaza una duración %s', (_, input, name, message) => {
    const result = parseDurationParts(input)
    expect(result.minutes).toBeNull()
    expect(result.errors).toEqual([{ name, message }])
  })
})

describe('fechas', () => {
  it('«hoy» en la zona horaria de la tienda', () => {
    // 23:30 UTC del 28 de octubre = 00:30 del 29 en Madrid (UTC+1).
    expect(getTodayDate(new Date('2026-10-28T23:30:00Z'))).toBe('2026-10-29')
    expect(getTodayDate(new Date('2026-10-28T10:00:00Z'))).toBe('2026-10-28')
    // Horario de verano (UTC+2): 22:30 UTC del 30 de junio = 0:30 del 1 de julio.
    expect(getTodayDate(new Date('2026-06-30T22:30:00Z'))).toBe('2026-07-01')
  })

  it('valida fechas de calendario reales', () => {
    expect(isValidDate('2026-10-28')).toBe(true)
    expect(isValidDate('2028-02-29')).toBe(true)
    expect(isValidDate('2026-02-29')).toBe(false)
    expect(isValidDate('2026-13-01')).toBe(false)
    expect(isValidDate('28/10/2026')).toBe(false)
    expect(isValidDate('')).toBe(false)
  })

  it('formatea la fecha sin desplazarla por la zona horaria', () => {
    expect(formatWorkDate('2026-10-27', 'long')).toBe('martes, 27 de octubre de 2026')
    expect(formatWorkDate('2026-01-01', 'compact')).toBe('1 ene 2026')
    expect(formatWorkDate('no-es-fecha')).toBe('')
  })
})

describe('validateOvertimeInput', () => {
  const valid = { employee_id: 'ana', work_date: '2026-10-27', hours: '1', minutes: '30', reason: '', notes: '' }

  it('acepta un registro completo', () => {
    expect(validateOvertimeInput(valid, { today: TODAY })).toEqual([])
  })

  it('exige empleado, fecha y duración', () => {
    expect(validateOvertimeInput({}, { today: TODAY }).map(e => e.name)).toEqual(['employee_id', 'work_date', 'duration'])
  })

  it('solo permite empleados de la lista (activos o el ya asociado)', () => {
    expect(validateOvertimeInput(valid, { today: TODAY, allowedEmployeeIds: ['luis'] }))
      .toEqual([{ name: 'employee_id', message: 'Elige un empleado activo.' }])
    expect(validateOvertimeInput(valid, { today: TODAY, allowedEmployeeIds: ['ana', 'luis'] })).toEqual([])
  })

  it('rechaza fechas inválidas o posteriores a hoy', () => {
    expect(validateOvertimeInput({ ...valid, work_date: '2026-02-30' }, { today: TODAY }))
      .toEqual([{ name: 'work_date', message: 'La fecha no es válida.' }])
    expect(validateOvertimeInput({ ...valid, work_date: '2026-10-29' }, { today: TODAY }))
      .toEqual([{ name: 'work_date', message: 'La fecha no puede ser posterior a hoy.' }])
    expect(validateOvertimeInput({ ...valid, work_date: TODAY }, { today: TODAY })).toEqual([])
  })

  it('rechaza duraciones inválidas', () => {
    expect(validateOvertimeInput({ ...valid, hours: '24', minutes: '30' }, { today: TODAY }).map(e => e.name)).toEqual(['duration'])
    expect(validateOvertimeInput({ ...valid, hours: '1,5', minutes: '' }, { today: TODAY }).map(e => e.name)).toEqual(['duration'])
  })

  it('limita la longitud del motivo y las observaciones', () => {
    expect(validateOvertimeInput({ ...valid, reason: 'a'.repeat(201), notes: 'b'.repeat(1001) }, { today: TODAY }).map(e => e.name))
      .toEqual(['reason', 'notes'])
  })
})

describe('normalizeOvertimeInput', () => {
  it('convierte la duración a minutos y deja los opcionales vacíos en null', () => {
    expect(normalizeOvertimeInput({ employee_id: 'ana', work_date: ' 2026-10-27 ', hours: '1', minutes: '5', reason: '  ', notes: '' }))
      .toEqual({ employee_id: 'ana', work_date: '2026-10-27', duration_minutes: 65, reason: null, notes: null })
  })

  it('recorta el motivo y conserva los saltos de línea de las observaciones', () => {
    const data = normalizeOvertimeInput({ employee_id: 'a', work_date: TODAY, hours: '', minutes: '30', reason: '  Inventario   de fin de mes ', notes: ' Línea 1\nLínea 2 ' })
    expect(data.reason).toBe('Inventario de fin de mes')
    expect(data.notes).toBe('Línea 1\nLínea 2')
  })

  it('solo envía columnas de la tabla', () => {
    expect(Object.keys(normalizeOvertimeInput({ id: 'x', employee: {}, created_at: 'y' })))
      .toEqual(['employee_id', 'work_date', 'duration_minutes', 'reason', 'notes'])
  })
})

describe('formulario a partir de un registro', () => {
  it('alta: hoy y campos vacíos', () => {
    expect(toOvertimeFormValues(null, { today: TODAY }))
      .toEqual({ employee_id: undefined, work_date: TODAY, hours: '', minutes: '', reason: '', notes: '' })
  })

  it('edición: separa la duración en horas y minutos', () => {
    const values = toOvertimeFormValues(entry('o', 'ana', '2026-10-01', 95, { reason: 'Carga' }))
    expect(values).toEqual({ employee_id: 'ana', work_date: '2026-10-01', hours: '1', minutes: '35', reason: 'Carga', notes: '' })
  })

  it('detecta si hay cambios', () => {
    const saved = entry('o', 'ana', '2026-10-01', 95)
    expect(hasOvertimeChanges(saved, toOvertimeFormValues(saved))).toBe(false)
    expect(hasOvertimeChanges(saved, { ...toOvertimeFormValues(saved), hours: '01', minutes: ' 35' })).toBe(false)
    expect(hasOvertimeChanges(saved, { ...toOvertimeFormValues(saved), minutes: '40' })).toBe(true)
    expect(hasOvertimeChanges(saved, { ...toOvertimeFormValues(saved), employee_id: 'luis' })).toBe(true)
    expect(hasOvertimeChanges(saved, { ...toOvertimeFormValues(saved), reason: 'Nuevo' })).toBe(true)
    expect(hasOvertimeChanges(null, {})).toBe(true)
  })
})

describe('filtros', () => {
  const ids = list => list.map(e => e.id)

  it('sin filtros, todos', () => {
    expect(filterOvertimeEntries(entries)).toHaveLength(5)
  })

  it('por empleado', () => {
    expect(ids(filterOvertimeEntries(entries, { employeeId: 'luis' }))).toEqual(['o3', 'o4'])
  })

  it('por periodo, con ambos extremos incluidos', () => {
    expect(ids(filterOvertimeEntries(entries, { from: '2026-10-15', to: '2026-10-31' }))).toEqual(['o2', 'o3', 'o4'])
    expect(ids(filterOvertimeEntries(entries, { from: '2026-10-15', to: '2026-10-15' }))).toEqual(['o2', 'o3'])
  })

  it('con un solo límite', () => {
    expect(ids(filterOvertimeEntries(entries, { from: '2026-10-31' }))).toEqual(['o4', 'o5'])
    expect(ids(filterOvertimeEntries(entries, { to: '2026-10-01' }))).toEqual(['o1'])
  })

  it('empleado y periodo a la vez', () => {
    expect(ids(filterOvertimeEntries(entries, { employeeId: 'ana', from: '2026-10-01', to: '2026-10-31' }))).toEqual(['o1', 'o2'])
  })

  it('fechas abiertas por un extremo con el estado de la página (cadena vacía = sin límite)', () => {
    expect(ids(filterOvertimeEntries(entries, { employeeId: undefined, from: '2026-10-15', to: '' }))).toEqual(['o2', 'o3', 'o4', 'o5'])
    expect(ids(filterOvertimeEntries(entries, { employeeId: undefined, from: '', to: '2026-10-15' }))).toEqual(['o1', 'o2', 'o3'])
    expect(ids(filterOvertimeEntries(entries, { employeeId: 'ana', from: '2026-10-15', to: '' }))).toEqual(['o2', 'o5'])
    expect(ids(filterOvertimeEntries(entries, { employeeId: 'luis', from: '', to: '2026-10-15' }))).toEqual(['o3'])
  })

  it('filtros limpios (estado inicial y tras «Limpiar filtros»): todos los registros', () => {
    expect(filterOvertimeEntries(entries, { employeeId: undefined, from: '', to: '' })).toHaveLength(5)
    expect(validateDateRange({ employeeId: undefined, from: '', to: '' })).toBeNull()
  })

  it('periodo sin registros', () => {
    expect(filterOvertimeEntries(entries, { from: '2027-01-01' })).toEqual([])
  })

  it('valida el periodo', () => {
    expect(validateDateRange({ from: '2026-10-31', to: '2026-10-01' })).toBe('La fecha «Desde» es posterior a «Hasta».')
    expect(validateDateRange({ from: '2026-10-01', to: '2026-10-01' })).toBeNull()
    expect(validateDateRange({ from: '2026-02-30' })).toBe('La fecha «Desde» no es válida.')
    expect(validateDateRange({})).toBeNull()
  })
})

describe('descripción de los filtros', () => {
  it.each([
    [{}, 'Todos los empleados, todas las fechas'],
    [{ employeeName: 'Ana López' }, 'Ana López, todas las fechas'],
    [{ from: '2026-10-01', to: '2026-10-31' }, 'Todos los empleados, del 1 oct 2026 al 31 oct 2026'],
    [{ from: '2026-10-01', to: '2026-10-01' }, 'Todos los empleados, el 1 oct 2026'],
    [{ from: '2026-10-01' }, 'Todos los empleados, desde el 1 oct 2026'],
    [{ employeeName: 'Ana López', to: '2026-10-31' }, 'Ana López, hasta el 31 oct 2026'],
  ])('%o', (filters, text) => {
    expect(describeOvertimeFilters(filters)).toBe(text)
  })
})

describe('periodos de calendario', () => {
  const P = OVERTIME_PERIOD

  it('sumar días cruza meses y años sin cambiar de día por la zona horaria', () => {
    expect(addDaysToDate('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDaysToDate('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDaysToDate('2027-01-01', -1)).toBe('2026-12-31')
    expect(addDaysToDate('2028-02-28', 1)).toBe('2028-02-29')
    // Fin del horario de verano en España: domingo 25 de octubre de 2026.
    expect(addDaysToDate('2026-10-24', 1)).toBe('2026-10-25')
    expect(addDaysToDate('2026-10-25', 1)).toBe('2026-10-26')
  })

  it('Hoy: solo el día actual', () => {
    expect(getPeriodRange(P.TODAY, '2026-10-28')).toEqual({ from: '2026-10-28', to: '2026-10-28' })
  })

  describe('Semanal: de lunes a domingo', () => {
    it.each([
      ['un miércoles', '2026-10-28', '2026-10-26', '2026-11-01'],
      ['el lunes (primer día)', '2026-10-26', '2026-10-26', '2026-11-01'],
      ['el domingo (último día)', '2026-11-01', '2026-10-26', '2026-11-01'],
      ['la semana del cambio de hora (domingo 25 oct)', '2026-10-25', '2026-10-19', '2026-10-25'],
      ['semana que cruza de mes', '2026-09-30', '2026-09-28', '2026-10-04'],
      ['semana que cruza de año (jueves 31 dic)', '2026-12-31', '2026-12-28', '2027-01-03'],
      ['semana que cruza de año (viernes 1 ene)', '2027-01-01', '2026-12-28', '2027-01-03'],
      ['1 de enero en lunes', '2024-01-01', '2024-01-01', '2024-01-07'],
      ['semana con 29 de febrero', '2028-02-29', '2028-02-28', '2028-03-05'],
    ])('%s', (_, today, from, to) => {
      expect(getPeriodRange(P.WEEK, today)).toEqual({ from, to })
    })

    it('siempre son 7 días y empieza en lunes', () => {
      for (let i = 0; i < 400; i++) {
        const today = addDaysToDate('2026-01-01', i)
        const { from, to } = getPeriodRange(P.WEEK, today)
        expect(new Date(`${from}T00:00:00Z`).getUTCDay()).toBe(1)
        expect(new Date(`${to}T00:00:00Z`).getUTCDay()).toBe(0)
        expect(addDaysToDate(from, 6)).toBe(to)
        expect(from <= today && today <= to).toBe(true)
      }
    })
  })

  describe('Mensual: mes natural', () => {
    it.each([
      ['octubre (31 días)', '2026-10-28', '2026-10-01', '2026-10-31'],
      ['noviembre (30 días)', '2026-11-15', '2026-11-01', '2026-11-30'],
      ['febrero normal', '2026-02-10', '2026-02-01', '2026-02-28'],
      ['febrero bisiesto', '2028-02-10', '2028-02-01', '2028-02-29'],
      ['primer día del mes', '2026-10-01', '2026-10-01', '2026-10-31'],
      ['último día del año', '2026-12-31', '2026-12-01', '2026-12-31'],
      ['primer día del año', '2027-01-01', '2027-01-01', '2027-01-31'],
    ])('%s', (_, today, from, to) => {
      expect(getPeriodRange(P.MONTH, today)).toEqual({ from, to })
    })
  })

  describe('Anual: año natural', () => {
    it.each([
      ['a mitad de año', '2026-10-28', '2026-01-01', '2026-12-31'],
      ['31 de diciembre', '2026-12-31', '2026-01-01', '2026-12-31'],
      ['1 de enero', '2027-01-01', '2027-01-01', '2027-12-31'],
    ])('%s', (_, today, from, to) => {
      expect(getPeriodRange(P.YEAR, today)).toEqual({ from, to })
    })
  })

  it('«hoy» en España decide el periodo cerca de medianoche', () => {
    // 23:30 UTC del 31 dic = 0:30 del 1 ene en Madrid: ya es el año nuevo.
    const today = getTodayDate(new Date('2026-12-31T23:30:00Z'))
    expect(today).toBe('2027-01-01')
    expect(getPeriodRange(P.YEAR, today)).toEqual({ from: '2027-01-01', to: '2027-12-31' })
    expect(getPeriodRange(P.MONTH, today)).toEqual({ from: '2027-01-01', to: '2027-01-31' })
    expect(getPeriodRange(P.WEEK, today)).toEqual({ from: '2026-12-28', to: '2027-01-03' })
    // 22:30 UTC del 31 dic = 23:30 en Madrid: todavía 2026.
    expect(getPeriodRange(P.YEAR, getTodayDate(new Date('2026-12-31T22:30:00Z')))).toEqual({ from: '2026-01-01', to: '2026-12-31' })
  })

  it('periodo desconocido o fecha inválida → sin rango', () => {
    expect(getPeriodRange('custom', '2026-10-28')).toBeNull()
    expect(getPeriodRange('quincenal', '2026-10-28')).toBeNull()
    expect(getPeriodRange(P.WEEK, '2026-02-30')).toBeNull()
  })

  describe('fechas de una semana o un mes aplicadas al listado (reutiliza filterOvertimeEntries)', () => {
    // entries: 1 oct (90), 15 oct (45, 30), 31 oct (120), 2 nov (15)
    const apply = (period, day, extra = {}) => filterOvertimeEntries(entries, { ...getPeriodRange(period, day), ...extra })

    it('semana del 26 oct al 1 nov', () => {
      expect(apply(P.WEEK, '2026-10-28').map(e => e.id)).toEqual(['o4'])
    })

    it('semana siguiente: incluye el 2 nov y no el 31 oct', () => {
      expect(apply(P.WEEK, '2026-11-02').map(e => e.id)).toEqual(['o5'])
    })

    it('mes de octubre: incluye el día 1 y el 31', () => {
      const result = apply(P.MONTH, '2026-10-28')
      expect(result.map(e => e.id)).toEqual(['o1', 'o2', 'o3', 'o4'])
      expect(sumDurationMinutes(result)).toBe(285)
    })

    it('se combina con el filtro por empleado', () => {
      const result = apply(P.MONTH, '2026-10-28', { employeeId: 'ana' })
      expect(result.map(e => e.id)).toEqual(['o1', 'o2'])
      expect(formatDuration(sumDurationMinutes(result))).toBe('2 h 15 min')
    })
  })
})

describe('resumen por empleado', () => {
  const W = OVERTIME_PERIOD.WEEK
  const M = OVERTIME_PERIOD.MONTH

  const staff = [
    { id: 'ana', first_name: 'Ana', last_name: 'López', is_active: true },
    { id: 'alvaro', first_name: 'Álvaro', last_name: 'Pérez', is_active: true },
    { id: 'lucia', first_name: 'Lucía', last_name: 'Núñez', is_active: false },
    { id: 'marta', first_name: 'Marta', last_name: 'Ortega', is_active: true },
    { id: 'pepe', first_name: 'Pepe', last_name: 'Gil', is_active: false },
  ]
  const e = (id, employee_id, work_date, duration_minutes) => entry(id, employee_id, work_date, duration_minutes, {
    employee: staff.find(s => s.id === employee_id) ?? { id: employee_id, first_name: 'Sin', last_name: 'Ficha', is_active: true },
  })
  const data = [
    e('1', 'ana', '2026-10-26', 20), // lunes
    e('2', 'ana', '2026-10-28', 20),
    e('3', 'ana', '2026-11-01', 20), // domingo
    e('4', 'lucia', '2026-10-27', 95), // inactiva
    e('5', 'alvaro', '2026-10-25', 60), // domingo de la semana anterior
    e('6', 'alvaro', '2026-11-02', 30), // lunes de la semana siguiente
    e('7', 'marta', '2026-10-31', 1),
    e('8', 'alvaro', '2026-12-31', 45),
    e('9', 'ana', '2027-01-01', 15),
  ]

  it('opciones de vista: Semanal y Mensual', () => {
    expect(OVERTIME_SUMMARY_VIEWS.map(v => v.label)).toEqual(['Semanal', 'Mensual'])
  })

  describe('periodo y navegación', () => {
    it('semana de lunes a domingo y mes natural (reutiliza los periodos rápidos)', () => {
      expect(getSummaryRange(W, '2026-10-28')).toEqual({ from: '2026-10-26', to: '2026-11-01' })
      expect(getSummaryRange(M, '2026-10-28')).toEqual({ from: '2026-10-01', to: '2026-10-31' })
      expect(getSummaryRange(OVERTIME_PERIOD.YEAR, '2026-10-28')).toBeNull()
    })

    it('semana anterior y siguiente, cruzando de año', () => {
      expect(getSummaryRange(W, shiftSummaryAnchor(W, '2026-10-28', -1))).toEqual({ from: '2026-10-19', to: '2026-10-25' })
      expect(getSummaryRange(W, shiftSummaryAnchor(W, '2026-10-28', 1))).toEqual({ from: '2026-11-02', to: '2026-11-08' })
      expect(getSummaryRange(W, shiftSummaryAnchor(W, '2026-12-24', 1))).toEqual({ from: '2026-12-28', to: '2027-01-03' })
      expect(getSummaryRange(W, shiftSummaryAnchor(W, '2027-01-03', 1))).toEqual({ from: '2027-01-04', to: '2027-01-10' })
      expect(getSummaryRange(W, shiftSummaryAnchor(W, '2027-01-01', -1))).toEqual({ from: '2026-12-21', to: '2026-12-27' })
    })

    it('mes anterior y siguiente, sin desbordes por el día del mes ni por el año', () => {
      expect(shiftSummaryAnchor(M, '2026-01-31', 1)).toBe('2026-02-01')
      expect(getSummaryRange(M, shiftSummaryAnchor(M, '2026-01-31', 1))).toEqual({ from: '2026-02-01', to: '2026-02-28' })
      expect(getSummaryRange(M, shiftSummaryAnchor(M, '2028-03-31', -1))).toEqual({ from: '2028-02-01', to: '2028-02-29' })
      expect(getSummaryRange(M, shiftSummaryAnchor(M, '2026-12-15', 1))).toEqual({ from: '2027-01-01', to: '2027-01-31' })
      expect(getSummaryRange(M, shiftSummaryAnchor(M, '2027-01-10', -1))).toEqual({ from: '2026-12-01', to: '2026-12-31' })
      expect(getSummaryRange(M, shiftSummaryAnchor(M, '2026-05-31', 1))).toEqual({ from: '2026-06-01', to: '2026-06-30' })
    })

    it('ir y volver deja el mismo periodo', () => {
      let anchor = '2026-10-28'
      for (let i = 0; i < 14; i++) anchor = shiftSummaryAnchor(M, anchor, -1)
      for (let i = 0; i < 14; i++) anchor = shiftSummaryAnchor(M, anchor, 1)
      expect(getSummaryRange(M, anchor)).toEqual(getSummaryRange(M, '2026-10-28'))
      let week = '2026-10-28'
      for (let i = 0; i < 60; i++) week = shiftSummaryAnchor(W, week, 1)
      for (let i = 0; i < 60; i++) week = shiftSummaryAnchor(W, week, -1)
      expect(week).toBe('2026-10-28')
    })

    it('encabezado del periodo', () => {
      expect(formatSummaryTitle(W, getSummaryRange(W, '2026-09-12'))).toBe('Semana del 7 al 13 sept 2026')
      expect(formatSummaryTitle(W, getSummaryRange(W, '2026-10-28'))).toBe('Semana del 26 oct al 1 nov 2026')
      expect(formatSummaryTitle(W, getSummaryRange(W, '2026-12-31'))).toBe('Semana del 28 dic 2026 al 3 ene 2027')
      expect(formatSummaryTitle(M, getSummaryRange(M, '2026-10-28'))).toBe('Octubre de 2026')
      expect(formatSummaryTitle(M, getSummaryRange(M, '2027-01-05'))).toBe('Enero de 2027')
    })
  })

  describe('totales por empleado', () => {
    it('semana: solo los registros de lunes a domingo, con los minutos exactos', () => {
      const summary = summarizeOvertimeByEmployee(data, staff, getSummaryRange(W, '2026-10-28'))
      expect(summary.rows.map(r => [r.name, r.minutes, r.count])).toEqual([
        ['Álvaro Pérez', 0, 0], // su domingo anterior y su lunes siguiente no cuentan
        ['Ana López', 60, 3], // 3 × 20 min: no se redondea cada registro
        ['Lucía Núñez', 95, 1], // inactiva, pero con registros: cuenta
        ['Marta Ortega', 1, 1],
      ])
      expect(summary.totalMinutes).toBe(156)
      expect(formatDuration(summary.totalMinutes)).toBe('2 h 36 min')
      expect(summary.entryCount).toBe(5)
      expect(summary.employeesWithEntries).toBe(3)
    })

    it('marca a los empleados inactivos y no muestra a los inactivos sin registros', () => {
      const summary = summarizeOvertimeByEmployee(data, staff, getSummaryRange(W, '2026-10-28'))
      expect(summary.rows.find(r => r.id === 'lucia').isActive).toBe(false)
      expect(summary.rows.some(r => r.id === 'pepe')).toBe(false)
      expect(summary.rows.find(r => r.id === 'ana').isActive).toBe(true)
    })

    it('mes de octubre: incluye el día 1 y el 31', () => {
      const summary = summarizeOvertimeByEmployee(data, staff, getSummaryRange(M, '2026-10-05'))
      expect(summary.rows.map(r => [r.id, r.minutes])).toEqual([
        ['alvaro', 60], ['ana', 40], ['lucia', 95], ['marta', 1],
      ])
      expect(summary.totalMinutes).toBe(196)
    })

    it('meses de distinta duración y cambio de año', () => {
      expect(summarizeOvertimeByEmployee(data, staff, getSummaryRange(M, '2026-11-20')).totalMinutes).toBe(50) // 1 y 2 nov
      expect(summarizeOvertimeByEmployee(data, staff, getSummaryRange(M, '2026-12-01')).totalMinutes).toBe(45) // 31 dic
      expect(summarizeOvertimeByEmployee(data, staff, getSummaryRange(M, '2027-01-31')).totalMinutes).toBe(15) // 1 ene
      const crossing = summarizeOvertimeByEmployee(data, staff, getSummaryRange(W, '2026-12-31'))
      expect(crossing.totalMinutes).toBe(60) // 31 dic + 1 ene, misma semana
      expect(crossing.rows.filter(r => r.count).map(r => r.id)).toEqual(['alvaro', 'ana'])
    })

    it('periodo sin registros: total 0 y los empleados activos a 0', () => {
      const summary = summarizeOvertimeByEmployee(data, staff, getSummaryRange(W, '2025-06-10'))
      expect(summary.totalMinutes).toBe(0)
      expect(summary.entryCount).toBe(0)
      expect(formatDuration(summary.totalMinutes)).toBe('0 h')
      expect(summary.rows.every(r => r.minutes === 0 && r.isActive)).toBe(true)
    })

    it('sin datos todavía', () => {
      expect(summarizeOvertimeByEmployee([], [], getSummaryRange(W, '2026-10-28'))).toEqual({ rows: [], totalMinutes: 0, entryCount: 0, employeesWithEntries: 0 })
    })

    it('un registro de un empleado que no está en la lista de fichas sigue contando', () => {
      const summary = summarizeOvertimeByEmployee([e('x', 'otro', '2026-10-28', 30)], staff, getSummaryRange(W, '2026-10-28'))
      expect(summary.rows.find(r => r.id === 'otro')).toMatchObject({ name: 'Sin Ficha', minutes: 30 })
      expect(summary.totalMinutes).toBe(30)
    })

    it('suma exacta con muchos registros (sin pérdidas)', () => {
      const many = Array.from({ length: 500 }, (_, i) => e(`m${i}`, 'ana', '2026-10-28', 7))
      const summary = summarizeOvertimeByEmployee(many, staff, getSummaryRange(M, '2026-10-28'))
      expect(summary.totalMinutes).toBe(3500)
      expect(formatDuration(summary.totalMinutes)).toBe('58 h 20 min')
    })

    it('el total general es la suma de las filas', () => {
      const summary = summarizeOvertimeByEmployee(data, staff, getSummaryRange(M, '2026-10-05'))
      expect(summary.rows.reduce((t, r) => t + r.minutes, 0)).toBe(summary.totalMinutes)
    })
  })

  describe('«Ver registros»: el listado recibe el empleado y las fechas del periodo', () => {
    // Lo que hace la página: filters = { employeeId, from, to } del periodo del resumen.
    const fromSummary = (view, anchor, employeeId) => ({ employeeId, ...getSummaryRange(view, anchor) })

    it('semana actual: mismos registros y minutos en el listado que en la fila del resumen', () => {
      const filters = fromSummary(W, '2026-10-28', 'ana')
      expect(filters).toEqual({ employeeId: 'ana', from: '2026-10-26', to: '2026-11-01' })
      const listed = filterOvertimeEntries(data, filters)
      const row = summarizeOvertimeByEmployee(data, staff, getSummaryRange(W, '2026-10-28')).rows.find(r => r.id === 'ana')
      expect(listed.map(x => x.id)).toEqual(['1', '2', '3'])
      expect(sumDurationMinutes(listed)).toBe(row.minutes)
    })

    it('semana pasada y empleada inactiva', () => {
      const filters = fromSummary(W, '2026-10-27', 'lucia')
      expect(filterOvertimeEntries(data, filters).map(x => x.id)).toEqual(['4'])
    })

    it('mes pasado que cruza de año al navegar', () => {
      const filters = fromSummary(M, shiftSummaryAnchor(M, '2027-01-15', -1), 'alvaro')
      expect(filters).toEqual({ employeeId: 'alvaro', from: '2026-12-01', to: '2026-12-31' })
      expect(filterOvertimeEntries(data, filters).map(x => x.id)).toEqual(['8'])
    })
  })
})

describe('totales', () => {
  it('suma los minutos enteros sin redondear cada registro', () => {
    // 3 registros de 20 min = 60 min (redondeando cada uno a horas daría 0 h).
    const small = [entry('a', 'x', TODAY, 20), entry('b', 'x', TODAY, 20), entry('c', 'x', TODAY, 20)]
    expect(sumDurationMinutes(small)).toBe(60)
    expect(formatDuration(sumDurationMinutes(small))).toBe('1 h')
  })

  it('total de los registros filtrados', () => {
    expect(sumDurationMinutes(entries)).toBe(300)
    expect(formatDuration(sumDurationMinutes(filterOvertimeEntries(entries, { employeeId: 'ana' })))).toBe('2 h 30 min')
  })

  it('lista vacía → 0', () => {
    expect(sumDurationMinutes([])).toBe(0)
    expect(sumDurationMinutes(null)).toBe(0)
  })
})

describe('orden', () => {
  it('fecha de trabajo descendente; el mismo día, el creado más tarde primero; desempate por id', () => {
    const list = [
      entry('b', 'x', '2026-10-15', 10, { created_at: '2026-10-15T09:00:00Z' }),
      entry('a', 'x', '2026-10-15', 10, { created_at: '2026-10-15T09:00:00Z' }),
      entry('c', 'x', '2026-10-15', 10, { created_at: '2026-10-15T12:00:00Z' }),
      entry('d', 'x', '2026-10-20', 10),
      entry('e', 'x', '2026-09-30', 10),
    ]
    expect(sortOvertimeEntries(list).map(e => e.id)).toEqual(['d', 'c', 'a', 'b', 'e'])
  })

  it('upsert y eliminación mantienen el orden', () => {
    const sorted = sortOvertimeEntries(entries)
    expect(sorted.map(e => e.id)).toEqual(['o5', 'o4', 'o2', 'o3', 'o1'])
    const moved = upsertOvertimeEntry(sorted, { ...entries[0], work_date: '2026-12-01' })
    expect(moved[0].id).toBe('o1')
    expect(moved).toHaveLength(5)
    expect(removeOvertimeEntry(sorted, 'o3').map(e => e.id)).toEqual(['o5', 'o4', 'o2', 'o1'])
  })
})

describe('empleado del registro', () => {
  it('nombre a partir de la ficha embebida', () => {
    expect(getEntryEmployeeName(entries[0])).toBe('Ana López')
    expect(getEntryEmployeeName({ employee: null })).toBe('Empleado no disponible')
  })
})

describe('errores de Supabase', () => {
  it('restricción de duración → error en la duración', () => {
    const error = { code: '23514', message: 'new row for relation "overtime_entries" violates check constraint "overtime_entries_duration_minutes_range"' }
    expect(getOvertimeFieldErrors(error)).toEqual([{ name: 'duration', message: 'La duración debe estar entre 1 minuto y 24 horas.' }])
  })

  it('empleado inexistente → error en el empleado', () => {
    const error = { code: '23503', message: 'insert or update on table "overtime_entries" violates foreign key constraint "overtime_entries_employee_id_fkey"' }
    const feedback = getOvertimeErrorFeedback({ error, status: 409 }, 'save')
    expect(feedback.kind).toBe(DB_ERROR_KIND.VALIDATION)
    expect(feedback.fields).toEqual([{ name: 'employee_id', message: 'Ese empleado ya no existe. Elige otro.' }])
  })

  it('decimal rechazado por PostgREST → error en la duración', () => {
    const error = { code: '22P02', message: 'invalid input syntax for type integer: "90.5"' }
    expect(getOvertimeFieldErrors(error)[0].name).toBe('duration')
  })

  it.each([
    ['sin conexión', { error: { message: 'TypeError: fetch failed' }, status: 0 }, 'delete', DB_ERROR_KIND.NETWORK, /No se ha podido eliminar.*conexión/],
    ['sesión caducada', { error: { code: 'PGRST303', message: 'JWT expired' }, status: 401 }, 'save', DB_ERROR_KIND.EXPIRED, /sesión ha caducado/],
    ['RLS', { error: { code: '42501', message: 'new row violates row-level security policy for table "overtime_entries"' }, status: 403 }, 'save', DB_ERROR_KIND.PERMISSION, /no tiene permiso/],
    ['tabla inexistente', { error: { code: 'PGRST205', message: 'Could not find the table' }, status: 404 }, 'load', DB_ERROR_KIND.MISSING, /migración/],
    ['registro ya eliminado', { error: { code: 'PGRST116', message: 'Cannot coerce' }, status: 406 }, 'delete', DB_ERROR_KIND.NOT_FOUND, /ya se haya eliminado/],
    ['error del servidor', { error: { message: 'Service Unavailable' }, status: 503 }, 'load', DB_ERROR_KIND.UNKNOWN, /Vuelve a intentarlo en unos minutos/],
  ])('%s', (_, response, action, kind, pattern) => {
    const feedback = getOvertimeErrorFeedback(response, action)
    expect(feedback.kind).toBe(kind)
    expect(feedback.message).toMatch(pattern)
  })

  it('nunca muestra el mensaje técnico', () => {
    const response = { error: { code: 'XX000', message: 'detalle interno secreto' }, status: 500 }
    for (const action of ['load', 'save', 'delete']) {
      expect(getOvertimeErrorFeedback(response, action).message).not.toMatch(/secreto|XX000/)
    }
  })
})

describe('protección de la página /horas-extra', () => {
  it('solo la cuenta autorizada accede', () => {
    expect(getAccessDecision('/horas-extra', AUTHZ_STATUS.AUTHORIZED)).toEqual({ action: 'allow' })
    expect(getAccessDecision('/horas-extra', AUTHZ_STATUS.UNAUTHORIZED)).toEqual({ action: 'redirect', to: '/acceso-denegado' })
    expect(getAccessDecision('/horas-extra', AUTHZ_STATUS.EXPIRED).action).toBe('expired')
    expect(getAccessDecision('/horas-extra', AUTHZ_STATUS.CHECK_FAILED).action).toBe('error')
  })
})
