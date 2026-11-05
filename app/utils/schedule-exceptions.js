// Lógica pura de las excepciones del calendario (cambios de un día y
// ausencias), sin dependencias de Nuxt ni de Supabase.
//
// Reutiliza las reglas de app/utils/schedules.js y aplica, antes de guardar,
// las mismas comprobaciones que hacen los triggers de la migración de
// horarios (la base de datos las vuelve a hacer y tiene la última palabra):
//   - como mucho 3 turnos por día, formato HH:MM, inicio distinto de fin y sin
//     solapes en el día (validateDayShifts);
//   - ningún turno nocturno pisa el día siguiente, ni lo pisa el del día
//     anterior (shiftsSpillConflict sobre los días ya resueltos);
//   - ninguna hora que no exista por el cambio al horario de verano;
//   - ausencias sin solapes y con fin igual o posterior al inicio;
//   - nada fuera de los periodos laborales: ni con la empleada desactivada,
//     ni después de su último día, ni en un periodo de baja anterior.
//
// Las excepciones nunca modifican las versiones del horario habitual.

import { DB_ERROR_KIND, classifyDatabaseError } from './database-errors.js'
import { addDaysToDate, formatWorkDate, isValidDate } from './overtime.js'
import { describeDateRange, describeDayShifts, getAbsenceTypeLabel } from './employee-leave.js'
import {
  ABSENCE_TYPES,
  MAX_SHIFTS_PER_DAY,
  SCHEDULE_KIND,
  SHIFT_ERROR,
  describeShiftError,
  findAbsenceForDate,
  findOverrideForDate,
  getShiftDuration,
  getVersionPeriods,
  resolveEmployeeDay,
  shiftsSpillConflict,
  sortShifts,
  validateDayShifts,
} from './schedules.js'

export const OVERRIDE_COLUMNS = 'id, employee_id, work_date, shifts, notes'
export const ABSENCE_COLUMNS = 'id, employee_id, absence_type, start_date, end_date, notes'
export const ABSENCE_NOTES_MAX_LENGTH = 500

const rawShifts = day => (day?.shifts ?? []).map(({ start, end }) => ({ start, end }))
const formatDay = date => formatWorkDate(date, 'long')

// ------------------------------------------------------- Periodo laboral

/**
 * ¿Se puede modificar la planificación de este día? Mismas condiciones que
 * los triggers: la empleada debe estar activa y el día no puede caer después
 * de su último día ni en un periodo de baja anterior.
 *
 * @returns {{ editable: boolean, reason: string | null }}
 */
export function getDayEditability({ employee, date, versions = [] }) {
  if (!employee?.is_active) {
    return { editable: false, reason: 'Está de baja: su planificación no se puede modificar.' }
  }
  if (employee.last_working_date && date > employee.last_working_date) {
    return { editable: false, reason: 'Ese día es posterior a su último día de trabajo.' }
  }
  if (findLeavePeriodOverlap(versions, date, date)) {
    return { editable: false, reason: 'Ese día no tenía horario por una baja anterior.' }
  }
  return { editable: true, reason: null }
}

/** Periodo sin horario por baja (versión «end») que se solapa con [from, to], o null. */
export function findLeavePeriodOverlap(versions, from, to) {
  return getVersionPeriods(versions)
    .find(period => period.kind === SCHEDULE_KIND.END && period.from <= to && (!period.to || period.to >= from)) ?? null
}

// ------------------------------------------------------- Cambio de un día

/** Turnos con los que se abre el editor: los del cambio si existe; si no, los habituales del día. */
export function getInitialDayShifts(day) {
  return sortShifts(rawShifts(day))
}

const SHIFT_MESSAGES = {
  [SHIFT_ERROR.TOO_MANY]: `Como mucho ${MAX_SHIFTS_PER_DAY} turnos por día.`,
  [SHIFT_ERROR.INVALID_TIME]: 'Indica la hora de inicio y de fin de cada turno (HH:MM).',
  [SHIFT_ERROR.SAME_START_END]: 'Un turno no puede empezar y acabar a la misma hora.',
  [SHIFT_ERROR.OVERLAP]: 'Hay turnos que se solapan.',
}

/**
 * Comprueba un cambio de un día antes de guardarlo.
 *
 * @param {object} params
 * @param {object} params.employee con is_active y last_working_date
 * @param {string} params.date YYYY-MM-DD
 * @param {{ start: string, end: string }[]} params.shifts [] = día libre
 * @param {object[]} params.versions versiones del horario de la empleada
 * @param {object[]} params.overrides cambios de un día de la empleada (incluye los días vecinos)
 * @param {object[]} params.absences ausencias de la empleada (incluye los días vecinos)
 * @returns {{ errors: string[], shiftErrors: { index: number, message: string }[], minutes: number, overnight: boolean }}
 */
export function validateDayChange({ employee, date, shifts, versions = [], overrides = [], absences = [] }) {
  const errors = []
  const shiftErrors = []

  const editability = getDayEditability({ employee, date, versions })
  if (!editability.editable) return { errors: [editability.reason], shiftErrors, minutes: 0, overnight: false }

  const absence = findAbsenceForDate(absences, date)
  if (absence) {
    return {
      errors: [`Ese día tiene ${getAbsenceTypeLabel(absence.absence_type).toLocaleLowerCase('es')} (${describeDateRange(absence.start_date, absence.end_date)}). La ausencia prevalece: para cambiar sus turnos, modifica o quita la ausencia.`],
      shiftErrors,
      minutes: 0,
      overnight: false,
    }
  }

  const validation = validateDayShifts(shifts)
  for (const error of validation.errors) {
    const message = SHIFT_MESSAGES[error.code] ?? SHIFT_MESSAGES[SHIFT_ERROR.INVALID_TIME]
    if (error.index !== undefined) shiftErrors.push({ index: error.index, message })
    if (error.other !== undefined) shiftErrors.push({ index: error.other, message })
    if (!errors.includes(message)) errors.push(message)
  }
  if (!validation.valid) return { errors, shiftErrors, minutes: 0, overnight: false }

  // Horas reales y horas que no existen por el cambio de hora.
  let minutes = 0
  shifts.forEach((shift, index) => {
    const duration = getShiftDuration(date, shift)
    if (duration.error) {
      const message = describeShiftError(duration.error)
      shiftErrors.push({ index, message })
      errors.push(message)
    }
    else {
      minutes += duration.minutes
    }
  })

  // Días vecinos ya resueltos, sin el cambio que se está editando.
  const others = overrides.filter(item => item.work_date !== date)
  const context = { employee, versions, overrides: others, absences }
  const previous = resolveEmployeeDay({ ...context, date: addDaysToDate(date, -1) })
  const next = resolveEmployeeDay({ ...context, date: addDaysToDate(date, 1) })
  if (shiftsSpillConflict(rawShifts(previous), shifts)) {
    errors.push(`Se solapa con el turno nocturno del día anterior (${formatDay(previous.date)}: ${describeDayShifts(rawShifts(previous))}).`)
  }
  if (shiftsSpillConflict(shifts, rawShifts(next))) {
    errors.push(`El turno nocturno se solapa con los turnos del día siguiente (${formatDay(next.date)}: ${describeDayShifts(rawShifts(next))}).`)
  }

  return {
    errors,
    shiftErrors,
    minutes,
    overnight: shifts.some(shift => shift.end <= shift.start),
  }
}

/** true si los turnos editados son iguales a los guardados (o a los habituales). */
export function sameShifts(a, b) {
  const normalize = list => JSON.stringify(sortShifts(list ?? []).map(({ start, end }) => [start, end]))
  return normalize(a) === normalize(b)
}

// --------------------------------------------------------------- Ausencias

/** Ausencias ordenadas por fecha de inicio (la más reciente primero). */
export function sortAbsencesDesc(absences) {
  return [...(absences ?? [])].sort((a, b) => (a.start_date < b.start_date ? 1 : a.start_date > b.start_date ? -1 : 0))
}

/**
 * Comprueba una ausencia antes de guardarla.
 *
 * @param {object} params
 * @param {object} params.employee con is_active y last_working_date
 * @param {{ id?: string, absence_type: string, start_date: string, end_date: string, notes?: string }} params.values
 * @param {object[]} params.absences todas las ausencias de la empleada
 * @param {object[]} params.versions versiones del horario de la empleada
 * @returns {{ errors: { field: string | null, message: string }[] }}
 */
export function validateAbsence({ employee, values, absences = [], versions = [] }) {
  const errors = []
  const add = (field, message) => errors.push({ field, message })

  if (!employee?.is_active) {
    add(null, 'Está de baja: su planificación no se puede modificar.')
    return { errors }
  }
  if (!ABSENCE_TYPES.some(type => type.value === values?.absence_type)) add('absence_type', 'Elige el tipo de ausencia.')
  const start = values?.start_date
  const end = values?.end_date
  if (!isValidDate(start)) add('start_date', 'Indica una fecha de inicio válida.')
  if (!isValidDate(end)) add('end_date', 'Indica una fecha de fin válida.')
  if (String(values?.notes ?? '').length > ABSENCE_NOTES_MAX_LENGTH) {
    add('notes', `Como mucho ${ABSENCE_NOTES_MAX_LENGTH} caracteres.`)
  }
  if (errors.length) return { errors }

  if (end < start) {
    add('end_date', 'La fecha de fin no puede ser anterior a la de inicio.')
    return { errors }
  }
  if (employee.last_working_date && end > employee.last_working_date) {
    add('end_date', 'No puede acabar después de su último día de trabajo.')
  }
  const leave = findLeavePeriodOverlap(versions, start, end)
  if (leave) {
    add(null, 'Las fechas coinciden con un periodo en que no tenía horario por una baja.')
  }
  const overlap = (absences ?? []).find(other => other.id !== values.id && other.start_date <= end && other.end_date >= start)
  if (overlap) {
    add(null, `Se solapa con ${getAbsenceTypeLabel(overlap.absence_type).toLocaleLowerCase('es')} ${describeDateRange(overlap.start_date, overlap.end_date)}.`)
  }
  return { errors }
}

/** Cambios de un día que quedarán sin efecto mientras dure la ausencia. */
export function countOverridesCoveredByAbsence(overrides, { start_date: start, end_date: end } = {}) {
  if (!isValidDate(start) || !isValidDate(end)) return 0
  return (overrides ?? []).filter(item => item.work_date >= start && item.work_date <= end).length
}

/** Valores del formulario de ausencia: los de una existente o, para una nueva, el día elegido. */
export function getAbsenceFormValues(absence, date) {
  return absence
    ? { id: absence.id, absence_type: absence.absence_type, start_date: absence.start_date, end_date: absence.end_date, notes: absence.notes ?? '' }
    : { id: null, absence_type: 'vacation', start_date: date, end_date: date, notes: '' }
}

/** Datos que se envían a la base de datos (sin la empleada ni el id). */
export function normalizeAbsenceInput(values) {
  const notes = String(values?.notes ?? '').trim()
  return {
    absence_type: values.absence_type,
    start_date: values.start_date,
    end_date: values.end_date,
    notes: notes || null,
  }
}

/** La ausencia que cubre un día, o null. */
export function getDayAbsence(absences, date) {
  return findAbsenceForDate(absences, date)
}

/** El cambio de un día guardado para esa fecha, o null. */
export function getDayOverride(overrides, date) {
  return findOverrideForDate(overrides, date)
}

// ------------------------------------------------------------- Errores

const COMMON = {
  [DB_ERROR_KIND.NETWORK]: 'No se ha podido guardar. Comprueba la conexión a Internet y vuelve a intentarlo.',
  [DB_ERROR_KIND.EXPIRED]: 'Tu sesión ha caducado. Vuelve a iniciar sesión para continuar.',
  [DB_ERROR_KIND.PERMISSION]: 'Esta cuenta no tiene permiso para modificar los horarios.',
  [DB_ERROR_KIND.MISSING]: 'La base de datos aún no está preparada para los horarios: falta aplicar su migración (SUPABASE_SETUP.md, sección 14).',
  [DB_ERROR_KIND.NOT_FOUND]: 'Ya no existe: recarga el calendario para ver los datos actuales.',
}

/**
 * Mensaje comprensible para un error al guardar o eliminar una excepción
 * (nunca el mensaje técnico). Reconoce los códigos de la migración de
 * horarios (PS003-PS006).
 *
 * @param {{ error?: any, status?: number }} response
 * @param {'override' | 'absence' | 'load'} target
 */
export function getExceptionErrorFeedback(response, target = 'override') {
  const code = String(response?.error?.code ?? '')
  const detail = String(response?.error?.details ?? '')
  const validation = message => ({ kind: DB_ERROR_KIND.VALIDATION, message })

  switch (code) {
    case 'PS003':
      return validation('Los turnos se solapan con un turno nocturno del día anterior o con los del día siguiente. Revisa las horas.')
    case 'PS004':
      return validation(isValidDate(detail.slice(0, 10)) && detail.length >= 16
        ? `La hora ${detail.slice(11, 16)} no existe el ${formatWorkDate(detail.slice(0, 10), 'compact')} por el cambio al horario de verano. Modifica el turno.`
        : 'Hay una hora que no existe ese día por el cambio al horario de verano. Modifica el turno.')
    case 'PS005':
      return validation('Se solapa con otra ausencia de esta empleada. Revisa las fechas.')
    case 'PS006':
      return validation('No se puede modificar: la empleada está de baja o esas fechas caen en un periodo de baja.')
    case '23505':
      return validation('Ese día ya tiene un cambio guardado. Recarga el calendario y vuelve a intentarlo.')
    case '23514':
      return validation(target === 'absence' ? 'Revisa las fechas y el tipo de ausencia.' : 'Revisa los turnos: formato HH:MM, como mucho 3 y sin solapes.')
    default:
      break
  }

  const kind = classifyDatabaseError(response) ?? DB_ERROR_KIND.UNKNOWN
  return {
    kind,
    message: COMMON[kind] ?? (target === 'load'
      ? 'No se han podido cargar las ausencias. Vuelve a intentarlo.'
      : 'No se ha podido guardar. Vuelve a intentarlo.'),
  }
}
