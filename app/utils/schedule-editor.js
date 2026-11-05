// Lógica pura del editor del horario habitual (ficha de la empleada), sin
// dependencias de Nuxt ni de Supabase.
//
// Cada cambio crea una versión NUEVA de employee_schedules con los siete
// días; el historial no se sobrescribe. La versión anterior rige hasta el día
// antes de la nueva (así funcionan las versiones: ver schedules.js).
//
// Reutiliza las reglas de app/utils/schedules.js y aplica, antes de guardar,
// las mismas comprobaciones que hacen la tabla y su trigger (la base de datos
// las repite y tiene la última palabra):
//   - turnos de cada día: como mucho 3, HH:MM, inicio distinto de fin, sin
//     solapes (validateDayShifts);
//   - turnos nocturnos que pisan el día siguiente, también el domingo con el
//     lunes (validateWeekShifts);
//   - el primer día no puede chocar con un turno nocturno del día anterior
//     (PS003);
//   - solo se añaden versiones al final (PS001) y, salvo la primera, como
//     pronto desde el lunes de la semana actual (PS002);
//   - nada con la empleada de baja (PS006).
// Las horas que no existen por el cambio al horario de verano y los choques
// con cambios de un día ya guardados se avisan, pero no impiden guardar: un
// horario habitual se repite cada semana y esos casos afectan a días
// concretos, que se corrigen con un cambio de un día.

import { DB_ERROR_KIND, classifyDatabaseError } from './database-errors.js'
import { addDaysToDate, formatDuration, formatWorkDate, getTodayDate, isValidDate } from './overtime.js'
import { describeDayShifts, formatLeaveDate, getLastWeeklySchedule } from './employee-leave.js'
import { getShiftValidationMessage, sameShifts } from './schedule-exceptions.js'
import {
  CONFLICT_TYPE,
  SCHEDULE_KIND,
  SHIFT_ERROR,
  findShiftConflicts,
  getShiftDuration,
  getShiftNominalMinutes,
  getVersionForDate,
  getWeekStart,
  getWeekTemplateMinutes,
  getWeekdayShifts,
  isOvernightShift,
  listDates,
  resolveEmployeeDay,
  shiftsSpillConflict,
  sortScheduleVersions,
  sortShifts,
  validateDayShifts,
  validateWeekShifts,
} from './schedules.js'
import { WEEKDAYS } from './suppliers.js'

export const SCHEDULE_EDITOR_MODE = Object.freeze({
  // No tiene un horario semanal vigente ni próximo.
  CREATE: 'create',
  // Tiene uno: se crea una versión nueva desde una fecha.
  CHANGE: 'change',
})

// Como mucho, cuántos días después de la fecha de inicio se buscan choques
// con cambios de un día ya guardados.
const CONFLICT_HORIZON_DAYS = 366

const isWeekly = version => (version?.kind ?? SCHEDULE_KIND.SCHEDULE) === SCHEDULE_KIND.SCHEDULE
const rawShifts = day => (day?.shifts ?? []).map(({ start, end }) => ({ start, end }))
const capitalize = text => text.charAt(0).toLocaleUpperCase('es') + text.slice(1)
const longDate = date => formatWorkDate(date, 'long')
const WEEKDAY_LABELS = new Map(WEEKDAYS.map(day => [day.value, day.label]))

// --------------------------------------------------------------- Contexto

/**
 * Qué se puede hacer desde la ficha: crear o cambiar el horario, desde qué
 * fecha como pronto y con qué fecha propuesta.
 *
 * @param {object} params
 * @param {{ is_active?: boolean, last_working_date?: string | null }} params.employee
 * @param {object[]} [params.versions] versiones de la empleada
 * @returns {{
 *   mode: string, editable: boolean, blockedReason: string | null,
 *   latest: object | null, baseWeek: object | null, isFirst: boolean,
 *   minDate: string | null, defaultDate: string
 * }}
 */
export function getScheduleEditorContext({ employee, versions = [], today = getTodayDate() }) {
  const sorted = sortScheduleVersions(versions)
  const latest = sorted.at(-1) ?? null
  const current = getVersionForDate(sorted, today)
  const hasCurrentOrUpcoming = sorted.some(version => isWeekly(version) && (version === current || version.valid_from > today))
  const editable = employee?.is_active === true && !employee?.last_working_date

  // La primera versión puede tener cualquier fecha (carga inicial). Las
  // siguientes, después de la última y como pronto el lunes de esta semana.
  const monday = getWeekStart(today)
  const afterLatest = latest ? addDaysToDate(latest.valid_from, 1) : null
  const minDate = latest ? (afterLatest > monday ? afterLatest : monday) : null

  // Propuesta: el lunes siguiente (o el primer lunes que se pueda).
  let defaultDate = addDaysToDate(monday, 7)
  while (minDate && defaultDate < minDate) defaultDate = addDaysToDate(defaultDate, 7)

  return {
    mode: hasCurrentOrUpcoming ? SCHEDULE_EDITOR_MODE.CHANGE : SCHEDULE_EDITOR_MODE.CREATE,
    editable,
    blockedReason: editable ? null : 'Está de baja: actívala antes de registrar un horario habitual.',
    latest,
    baseWeek: getLastWeeklySchedule(sorted)?.week ?? null,
    isFirst: !latest,
    minDate,
    defaultDate,
  }
}

// ------------------------------------------------------- Días del editor

/**
 * Los siete días del editor a partir de una semana guardada (o vacía): cada
 * uno con si es laborable y sus turnos ordenados.
 *
 * @returns {{ weekday: number, label: string, works: boolean, shifts: { start: string, end: string }[] }[]}
 */
export function createEditorDays(week = null) {
  return WEEKDAYS.map(({ value, label }) => {
    const shifts = sortShifts(getWeekdayShifts(week, value)).map(({ start, end }) => ({ start, end }))
    return { weekday: value, label: capitalize(label), works: shifts.length > 0, shifts }
  })
}

/** Semana para guardar: los siete días («1»…«7»); [] en los de descanso. */
export function editorDaysToWeek(days) {
  return Object.fromEntries((days ?? []).map(day => [
    String(day.weekday),
    day.works ? sortShifts(day.shifts).map(({ start, end }) => ({ start: start ?? '', end: end ?? '' })) : [],
  ]))
}

/** Total nominal de un día del editor (turnos completos y válidos). */
export function getEditorDayMinutes(day) {
  if (!day?.works) return 0
  return (day.shifts ?? []).reduce((total, shift) => total + (getShiftNominalMinutes(shift) ?? 0), 0)
}

/** true si la semana del editor es igual a otra guardada. */
export function sameWeek(a, b) {
  return WEEKDAYS.every(({ value }) => sameShifts(getWeekdayShifts(a, value), getWeekdayShifts(b, value)))
}

// ------------------------------------------------------- Cambio de hora

function lastSundayOf(year, month) {
  const last = new Date(Date.UTC(year, month, 0))
  last.setUTCDate(last.getUTCDate() - last.getUTCDay())
  return last.toISOString().slice(0, 10)
}

function nextLastSunday(month, from) {
  const year = Number(from.slice(0, 4))
  const sunday = lastSundayOf(year, month)
  return sunday >= from ? sunday : lastSundayOf(year + 1, month)
}

/**
 * Avisos por los próximos cambios de hora (último domingo de marzo y de
 * octubre) desde la fecha de inicio: horas que no existen (avisos) y turnos
 * que duran más o menos horas reales ese día (información). Se revisan el
 * sábado y el domingo, por los turnos nocturnos.
 *
 * @returns {{ warnings: string[], notices: string[] }}
 */
export function getScheduleDstNotices(week, validFrom) {
  const result = { warnings: [], notices: [] }
  if (!isValidDate(validFrom)) return result
  const sundays = [nextLastSunday(3, validFrom), nextLastSunday(10, validFrom)].sort()
  for (const sunday of sundays) {
    for (const date of [addDaysToDate(sunday, -1), sunday]) {
      if (date < validFrom) continue
      const weekday = date === sunday ? 7 : 6
      for (const shift of sortShifts(getWeekdayShifts(week, weekday))) {
        const nominal = getShiftNominalMinutes(shift)
        if (nominal === null) continue
        const duration = getShiftDuration(date, shift)
        if (duration.error?.code === SHIFT_ERROR.NONEXISTENT_TIME) {
          result.warnings.push(`El ${longDate(date)} la hora ${duration.error.time} no existe por el cambio al horario de verano: ese día el turno ${shift.start}–${shift.end} aparecerá con un aviso en el calendario. Corrígelo con un cambio de un día.`)
        }
        else if (!duration.error && duration.minutes !== nominal) {
          result.notices.push(`El ${longDate(date)}, por el cambio de hora, el turno ${shift.start}–${shift.end} dura ${formatDuration(duration.minutes)} reales (en lugar de ${formatDuration(nominal)}).`)
        }
      }
    }
  }
  return result
}

// ------------------------------------------------------------- Validación

function nextWeekdayLabel(weekday) {
  return weekday === 7 ? 'lunes siguiente' : WEEKDAY_LABELS.get(weekday + 1)
}

/**
 * Comprueba el horario antes de guardarlo.
 *
 * @param {object} params
 * @param {object} params.employee
 * @param {object} params.context resultado de getScheduleEditorContext
 * @param {object[]} params.days días del editor (createEditorDays)
 * @param {string} params.validFrom YYYY-MM-DD
 * @param {object[]} [params.versions] versiones de la empleada
 * @param {object[]} [params.overrides] cambios de un día de la empleada
 * @param {object[]} [params.absences] ausencias de la empleada
 * @returns {{
 *   valid: boolean, errors: string[], dateError: string | null,
 *   dayErrors: Record<number, string[]>, shiftErrors: Record<string, string>,
 *   warnings: string[], notices: string[], week: object,
 *   dayMinutes: Record<number, number>, weekMinutes: number
 * }}
 */
export function validateScheduleDraft({ employee, context, days, validFrom, versions = [], overrides = [], absences = [] }) {
  const errors = []
  const dayErrors = {}
  const shiftErrors = {}
  const warnings = []
  const notices = []
  let dateError = null
  const addDayError = (weekday, message) => {
    dayErrors[weekday] = dayErrors[weekday] ?? []
    if (!dayErrors[weekday].includes(message)) dayErrors[weekday].push(message)
  }

  const week = editorDaysToWeek(days)
  const dayMinutes = Object.fromEntries((days ?? []).map(day => [day.weekday, getEditorDayMinutes(day)]))

  if (!context?.editable) errors.push(context?.blockedReason ?? 'No se puede registrar un horario para esta empleada.')

  // Fecha de inicio.
  const latest = context?.latest ?? null
  if (!isValidDate(validFrom)) {
    dateError = 'Indica desde qué fecha rige el horario.'
  }
  else if (latest && validFrom <= latest.valid_from) {
    dateError = `Ya tiene un horario registrado desde el ${formatLeaveDate(latest.valid_from)}: el nuevo debe empezar después (como pronto, el ${formatLeaveDate(context.minDate)}).`
  }
  else if (context?.minDate && validFrom < context.minDate) {
    dateError = `No puede empezar antes del lunes ${formatLeaveDate(context.minDate)}: las semanas anteriores ya forman parte del historial.`
  }

  // Turnos de cada día.
  for (const day of days ?? []) {
    if (!day.works) continue
    if (!day.shifts?.length) {
      addDayError(day.weekday, 'Añade al menos un turno o marca el día como descanso.')
      continue
    }
    for (const error of validateDayShifts(day.shifts).errors) {
      const message = getShiftValidationMessage(error.code)
      addDayError(day.weekday, message)
      for (const index of [error.index, error.other]) {
        if (index !== undefined) shiftErrors[`${day.weekday}:${index}`] = message
      }
    }
  }

  // Turnos nocturnos que pisan el día siguiente (también domingo → lunes).
  const daysValid = Object.keys(dayErrors).length === 0
  if (daysValid) {
    for (const error of validateWeekShifts(week).errors) {
      if (error.code !== SHIFT_ERROR.NEXT_DAY_OVERLAP) continue
      addDayError(error.weekday, `El turno nocturno se solapa con los turnos del ${nextWeekdayLabel(error.weekday)}.`)
    }
  }

  const ready = !errors.length && !dateError && Object.keys(dayErrors).length === 0
  if (ready) {
    // El primer día no puede chocar con un turno nocturno del día anterior.
    const draft = { id: '__draft__', employee_id: employee?.id, valid_from: validFrom, kind: SCHEDULE_KIND.SCHEDULE, week }
    const withDraft = [...versions, draft]
    const planning = { employee, versions: withDraft, overrides, absences }
    const previous = resolveEmployeeDay({ ...planning, date: addDaysToDate(validFrom, -1) })
    const first = resolveEmployeeDay({ ...planning, date: validFrom })
    if (shiftsSpillConflict(rawShifts(previous), rawShifts(first))) {
      dateError = `El primer día (${longDate(validFrom)}) se solapa con el turno nocturno del día anterior (${describeDayShifts(rawShifts(previous))}). Elige otra fecha o cambia los turnos.`
    }
    else {
      // Choques con cambios de un día ya guardados (no impiden guardar).
      const lastOverride = overrides
        .map(item => item.work_date)
        .filter(date => date >= validFrom)
        .sort()
        .at(-1)
      if (lastOverride) {
        const until = [addDaysToDate(lastOverride, 1), addDaysToDate(validFrom, CONFLICT_HORIZON_DAYS)].sort()[0]
        const resolved = listDates(validFrom, until).map(date => resolveEmployeeDay({ ...planning, date }))
        const overrideDates = new Set(overrides.map(item => item.work_date))
        for (const conflict of findShiftConflicts(resolved)) {
          const date = overrideDates.has(conflict.date) ? conflict.date : conflict.nextDate
          if (!overrideDates.has(date)) continue
          warnings.push(conflict.type === CONFLICT_TYPE.NEXT_DAY
            ? `Choca con el cambio de un día del ${longDate(date)} (turnos nocturnos que se solapan). Revisa ese día en el calendario.`
            : `Choca con el cambio de un día del ${longDate(date)}. Revisa ese día en el calendario.`)
        }
      }
    }
  }

  if (ready && !dateError) {
    const dst = getScheduleDstNotices(week, validFrom)
    warnings.push(...dst.warnings)
    notices.push(...dst.notices)
    if (context?.baseWeek && sameWeek(week, context.baseWeek)) {
      notices.push('Es igual que su último horario habitual.')
    }
  }

  return {
    valid: !errors.length && !dateError && Object.keys(dayErrors).length === 0,
    errors,
    dateError,
    dayErrors,
    shiftErrors,
    warnings,
    notices,
    week,
    dayMinutes,
    weekMinutes: getWeekTemplateMinutes(week),
  }
}

// ------------------------------------------------------------- Textos

/**
 * Qué pasará con el horario anterior: «Su horario actual (desde el 1 oct
 * 2026) se aplicará hasta el 8 nov 2026. El nuevo rige desde el 9 nov 2026.»
 */
export function describeScheduleStart({ context, validFrom, today = getTodayDate() }) {
  if (!isValidDate(validFrom)) return ''
  const parts = []
  const latest = context?.latest ?? null
  if (!latest) parts.push(`Será su primer horario habitual, desde el ${formatLeaveDate(validFrom)}.`)
  else if (isWeekly(latest)) {
    parts.push(`Su horario anterior (desde el ${formatLeaveDate(latest.valid_from)}) se aplicará hasta el ${formatLeaveDate(addDaysToDate(validFrom, -1))}. El nuevo rige desde el ${formatLeaveDate(validFrom)}.`)
  }
  else {
    parts.push(`No tiene horario desde el ${formatLeaveDate(latest.valid_from)}. El nuevo rige desde el ${formatLeaveDate(validFrom)}.`)
  }
  if (validFrom < today) parts.push('Incluye días ya pasados: el calendario de esos días también cambiará.')
  return parts.join(' ')
}

/** true si algún turno del día acaba al día siguiente (cuenta entero en este día). */
export function hasOvernightShift(day) {
  return Boolean(day?.works && day.shifts?.some(isOvernightShift))
}

// ---------------------------------------------------------------- Errores

const SAVE_MESSAGES = {
  [DB_ERROR_KIND.NETWORK]: 'No se ha podido guardar el horario. Comprueba la conexión a Internet y vuelve a intentarlo.',
  [DB_ERROR_KIND.EXPIRED]: 'Tu sesión ha caducado. Vuelve a iniciar sesión para continuar.',
  [DB_ERROR_KIND.PERMISSION]: 'Esta cuenta no tiene permiso para modificar los horarios.',
  [DB_ERROR_KIND.MISSING]: 'La base de datos aún no está preparada para los horarios: falta aplicar su migración (SUPABASE_SETUP.md, sección 14).',
  [DB_ERROR_KIND.NOT_FOUND]: 'No se ha encontrado esta empleada. Recarga la ficha para ver los datos actuales.',
}

/**
 * Mensaje comprensible para un error al guardar una versión del horario
 * (nunca el mensaje técnico). Reconoce los códigos de la migración de
 * horarios (PS001, PS002, PS003, PS006).
 *
 * @param {{ error?: any, status?: number }} response
 * @returns {{ kind: string, message: string }}
 */
export function getScheduleSaveFeedback(response) {
  const code = String(response?.error?.code ?? '')
  const detail = String(response?.error?.details ?? response?.error?.detail ?? '').slice(0, 10)
  const date = isValidDate(detail) ? detail : null
  const validation = message => ({ kind: DB_ERROR_KIND.VALIDATION, message })

  switch (code) {
    case 'PS001':
      return validation(date
        ? `Ya tiene un horario registrado desde el ${formatLeaveDate(date)}: el nuevo debe empezar después. Recarga la ficha si no lo ves.`
        : 'Ya tiene un horario registrado en esa fecha o después: elige una fecha posterior.')
    case '23505':
      return validation('Ya tiene un horario que empieza ese mismo día: elige otra fecha.')
    case 'PS002':
      return validation(date
        ? `No puede empezar antes del lunes ${formatLeaveDate(date)}: las semanas anteriores ya forman parte del historial.`
        : 'No puede empezar antes del lunes de esta semana.')
    case 'PS003':
      return validation('El primer día del horario se solapa con un turno nocturno del día anterior. Elige otra fecha o cambia los turnos.')
    case 'PS006':
      return validation('Está de baja: actívala antes de registrar un horario habitual.')
    case '23514':
      return validation('Revisa los turnos: formato HH:MM, como mucho 3 por día y sin solapes (tampoco entre el domingo y el lunes).')
    default:
      break
  }

  const kind = classifyDatabaseError(response) ?? DB_ERROR_KIND.UNKNOWN
  return { kind, message: SAVE_MESSAGES[kind] ?? 'No se ha podido guardar el horario. Vuelve a intentarlo.' }
}
