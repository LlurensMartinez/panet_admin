import { describe, expect, it } from 'vitest'
import {
  HOLIDAY_FIELD_LIMITS,
  HOLIDAY_MAX_YEAR,
  HOLIDAY_MIN_YEAR,
  HOLIDAY_SCOPES,
  clampHolidayYear,
  filterHolidaysByYear,
  findHolidayByDate,
  formatHolidayDate,
  formatHolidayDayMonth,
  getCurrentYear,
  getHolidayDateParts,
  getHolidayErrorFeedback,
  getHolidayFieldErrors,
  getScopeLabel,
  groupHolidaysByMonth,
  hasHolidayChanges,
  normalizeHolidayInput,
  removeHoliday,
  sortHolidays,
  toHolidayFormValues,
  upsertHoliday,
  validateHolidayInput,
} from '../../app/utils/holidays.js'
import { DB_ERROR_KIND } from '../../app/utils/database-errors.js'

const holiday = (over = {}) => ({
  id: 'h1',
  holiday_date: '2026-12-08',
  name: 'Inmaculada Concepción',
  scope: 'national',
  notes: null,
  ...over,
})

const list = [
  holiday({ id: 'a', holiday_date: '2026-12-25', name: 'Navidad' }),
  holiday({ id: 'b', holiday_date: '2027-01-01', name: 'Año Nuevo' }),
  holiday({ id: 'c', holiday_date: '2026-09-11', name: 'Diada', scope: 'regional' }),
  holiday({ id: 'd', holiday_date: '2026-12-08' }),
]

describe('ámbitos y fechas', () => {
  it('ofrece los tres ámbitos de la base de datos', () => {
    expect(HOLIDAY_SCOPES.map(s => s.value)).toEqual(['national', 'regional', 'local'])
    expect(getScopeLabel('regional')).toBe('Autonómico')
    expect(getScopeLabel('otro')).toBe('')
  })

  it('formatea la fecha completa y sus partes sin desplazarla por la zona horaria', () => {
    expect(formatHolidayDate('2026-12-08')).toBe('martes, 8 de diciembre de 2026')
    expect(getHolidayDateParts('2027-01-01')).toEqual({ day: '1', weekday: 'vie' })
    expect(formatHolidayDate('2026-02-30')).toBe('')
    expect(formatHolidayDayMonth('2026-12-08')).toBe('martes, 8 de diciembre')
  })

  it('obtiene el año actual de la tienda y limita el año navegable', () => {
    expect(getCurrentYear('2026-10-28')).toBe(2026)
    expect(clampHolidayYear(1990)).toBe(HOLIDAY_MIN_YEAR)
    expect(clampHolidayYear(2500)).toBe(HOLIDAY_MAX_YEAR)
    expect(clampHolidayYear('2027')).toBe(2027)
  })
})

describe('listado', () => {
  it('ordena por fecha y filtra por año', () => {
    expect(sortHolidays(list).map(h => h.id)).toEqual(['c', 'd', 'a', 'b'])
    expect(filterHolidaysByYear(list, 2026).map(h => h.id)).toEqual(['c', 'd', 'a'])
    expect(filterHolidaysByYear(list, 2027).map(h => h.id)).toEqual(['b'])
    expect(filterHolidaysByYear(list, 2028)).toEqual([])
  })

  it('agrupa por meses en orden', () => {
    const groups = groupHolidaysByMonth(filterHolidaysByYear(list, 2026))
    expect(groups.map(g => [g.key, g.label, g.holidays.map(h => h.id)])).toEqual([
      ['2026-09', 'septiembre', ['c']],
      ['2026-12', 'diciembre', ['d', 'a']],
    ])
  })

  it('busca el festivo de una fecha (excepto el que se edita)', () => {
    expect(findHolidayByDate(list, '2026-12-08')?.id).toBe('d')
    expect(findHolidayByDate(list, '2026-12-08', 'd')).toBeNull()
    expect(findHolidayByDate(list, '2026-12-09')).toBeNull()
  })

  it('añade, sustituye y elimina manteniendo el orden', () => {
    expect(upsertHoliday(list, holiday({ id: 'e', holiday_date: '2026-01-06', name: 'Reyes' }))[0].id).toBe('e')
    expect(upsertHoliday(list, holiday({ id: 'a', holiday_date: '2026-12-26', name: 'Sant Esteve' })).filter(h => h.id === 'a')).toHaveLength(1)
    expect(removeHoliday(list, 'a').map(h => h.id)).toEqual(['b', 'c', 'd'])
  })
})

describe('formulario', () => {
  it('normaliza los valores', () => {
    expect(normalizeHolidayInput({ holiday_date: ' 2026-12-08 ', name: '  Inmaculada\n Concepción ', scope: 'national', notes: '  ' }))
      .toEqual({ holiday_date: '2026-12-08', name: 'Inmaculada Concepción', scope: 'national', notes: null })
  })

  it('propone el ámbito nacional para un festivo nuevo', () => {
    expect(toHolidayFormValues()).toEqual({ holiday_date: '', name: '', scope: 'national', notes: '' })
    expect(toHolidayFormValues(null, { defaultScope: 'local' }).scope).toBe('local')
  })

  it('exige fecha válida, nombre y ámbito', () => {
    expect(validateHolidayInput({}).map(e => e.name)).toEqual(['holiday_date', 'name', 'scope'])
    expect(validateHolidayInput({ holiday_date: '2026-02-30', name: 'X', scope: 'local' })).toEqual([
      { name: 'holiday_date', message: 'La fecha no es válida.' },
    ])
    expect(validateHolidayInput({ holiday_date: '2026-12-08', name: 'X', scope: 'municipal' }).map(e => e.name)).toEqual(['scope'])
    expect(validateHolidayInput({ holiday_date: '1999-12-31', name: 'X', scope: 'local' }).map(e => e.name)).toEqual(['holiday_date'])
    expect(validateHolidayInput({ holiday_date: '2027-03-19', name: 'San José', scope: 'regional' })).toEqual([])
  })

  it('avisa si la fecha ya tiene un festivo, salvo el que se edita', () => {
    expect(validateHolidayInput({ holiday_date: '2026-12-25', name: 'Otro', scope: 'local' }, { holidays: list })).toEqual([
      { name: 'holiday_date', message: 'Ya hay un festivo ese día: «Navidad».' },
    ])
    expect(validateHolidayInput({ holiday_date: '2026-12-25', name: 'Navidad', scope: 'national' }, { holidays: list, currentId: 'a' })).toEqual([])
  })

  it('limita la longitud del nombre y de las notas', () => {
    const name = 'n'.repeat(HOLIDAY_FIELD_LIMITS.name + 1)
    const notes = 'n'.repeat(HOLIDAY_FIELD_LIMITS.notes + 1)
    expect(validateHolidayInput({ holiday_date: '2026-05-01', name, scope: 'national', notes }).map(e => e.name)).toEqual(['name', 'notes'])
  })

  it('detecta cambios', () => {
    const current = holiday()
    expect(hasHolidayChanges(current, toHolidayFormValues(current))).toBe(false)
    expect(hasHolidayChanges(current, { ...toHolidayFormValues(current), scope: 'local' })).toBe(true)
    expect(hasHolidayChanges(current, { ...toHolidayFormValues(current), notes: 'x' })).toBe(true)
    expect(hasHolidayChanges(null, {})).toBe(true)
  })
})

describe('errores de la base de datos', () => {
  it('traduce la fecha repetida (409, 23505) a un error del campo fecha', () => {
    const feedback = getHolidayErrorFeedback({
      status: 409,
      error: { code: '23505', message: 'duplicate key value violates unique constraint "holidays_holiday_date_unique"' },
    })
    expect(feedback.message).toBe('Ya hay un festivo configurado ese día.')
    expect(feedback.fields).toEqual([{ name: 'holiday_date', message: feedback.message }])
  })

  it('relaciona las restricciones con sus campos', () => {
    expect(getHolidayFieldErrors({ code: '23514', message: 'violates check constraint "holidays_scope_valid"' })[0].name).toBe('scope')
    expect(getHolidayFieldErrors({ code: '23514', message: 'violates check constraint "holidays_name_not_blank"' })[0].name).toBe('name')
    expect(getHolidayFieldErrors({ code: '23502', message: 'null value in column "holiday_date"' })[0].name).toBe('holiday_date')
  })

  it('da mensajes comprensibles al eliminar', () => {
    expect(getHolidayErrorFeedback({ error: { code: 'PGRST116' }, status: 406 }, 'delete').message).toMatch(/ya se haya eliminado/)
    expect(getHolidayErrorFeedback({ error: new TypeError('Failed to fetch'), status: 0 }, 'delete').message).toMatch(/No se ha podido eliminar el festivo/)
    expect(getHolidayErrorFeedback({ error: { code: '42501' }, status: 403 }, 'delete').kind).toBe(DB_ERROR_KIND.PERMISSION)
  })
})
