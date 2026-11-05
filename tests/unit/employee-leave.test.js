import { describe, expect, it } from 'vitest'
import {
  REACTIVATION_OUTCOME,
  buildDeactivationPreview,
  buildReactivationPlan,
  describeDateRange,
  describeDayShifts,
  describeDeactivationResult,
  describeReactivationOutcome,
  getAbsenceTypeLabel,
  getDefaultReturnDate,
  getLastWeeklySchedule,
  getLeaveErrorFeedback,
  hasPlanning,
  hasWeeklySchedule,
  validateLastWorkingDate,
} from '../../app/utils/employee-leave.js'
import { DB_ERROR_KIND } from '../../app/utils/database-errors.js'

// Hoy: jueves 5 de noviembre de 2026 (semana del lunes 2 al domingo 8).
const TODAY = '2026-11-05'
const W1 = { 1: [{ start: '07:00', end: '14:00' }], 2: [{ start: '07:00', end: '14:00' }] }
const W2 = { 3: [{ start: '08:00', end: '12:00' }] }
const version = (validFrom, week = W1, kind = 'schedule') => ({ id: `v-${validFrom}`, valid_from: validFrom, kind, week: kind === 'end' ? null : week })
const override = (date, shifts = []) => ({ id: `o-${date}`, work_date: date, shifts })
const absence = (from, to, type = 'vacation') => ({ id: `a-${from}`, absence_type: type, start_date: from, end_date: to })

describe('textos', () => {
  it('tipos de ausencia y turnos de un día', () => {
    expect(getAbsenceTypeLabel('vacation')).toBe('Vacaciones')
    expect(getAbsenceTypeLabel('leave')).toBe('Permiso')
    expect(getAbsenceTypeLabel('other')).toBe('Otro')
    expect(getAbsenceTypeLabel('x')).toBe('Ausencia')
    expect(describeDayShifts([])).toBe('Libre')
    expect(describeDayShifts([{ start: '07:00', end: '14:00' }, { start: '17:00', end: '20:00' }])).toBe('07:00–14:00 · 17:00–20:00')
  })

  it('rangos de fechas', () => {
    expect(describeDateRange('2026-11-03', '2026-11-03')).toBe('el 3 nov 2026')
    expect(describeDateRange('2026-11-03', '2026-11-15')).toBe('del 3 nov 2026 al 15 nov 2026')
  })
})

describe('planificación registrada', () => {
  it('hasPlanning y hasWeeklySchedule', () => {
    expect(hasPlanning({})).toBe(false)
    expect(hasPlanning({ versions: [], overrides: [override('2026-10-01')], absences: [] })).toBe(true)
    expect(hasWeeklySchedule([version('2026-10-01', null, 'end')])).toBe(false)
    expect(hasWeeklySchedule([version('2026-10-01')])).toBe(true)
    expect(hasWeeklySchedule(null)).toBe(false)
  })

  it('último horario semanal (ignora los cierres)', () => {
    const versions = [version('2026-09-01', W2), version('2026-10-01', W1), version('2026-10-20', null, 'end')]
    expect(getLastWeeklySchedule(versions).valid_from).toBe('2026-10-01')
    expect(getLastWeeklySchedule([])).toBeNull()
  })
})

describe('validateLastWorkingDate', () => {
  const versions = [version('2026-09-01'), version('2026-11-02', W2)]

  it('hoy y fechas pasadas son válidas', () => {
    expect(validateLastWorkingDate({ lastWorkingDate: TODAY, versions, today: TODAY })).toBeNull()
    expect(validateLastWorkingDate({ lastWorkingDate: '2026-11-02', versions, today: TODAY })).toBeNull()
  })

  it('no puede ser posterior a hoy', () => {
    expect(validateLastWorkingDate({ lastWorkingDate: '2026-11-06', versions, today: TODAY })).toBe('El último día de trabajo no puede ser posterior a hoy.')
  })

  it('no puede ser anterior a un horario que ya ha empezado', () => {
    expect(validateLastWorkingDate({ lastWorkingDate: '2026-11-01', versions, today: TODAY }))
      .toBe('Tiene un horario que empezó el 2 nov 2026, después de esa fecha. Elige el 2 nov 2026 o un día posterior.')
  })

  it('una versión futura no impide una fecha pasada (se eliminará)', () => {
    expect(validateLastWorkingDate({ lastWorkingDate: '2026-10-30', versions: [version('2026-09-01'), version('2026-11-16')], today: TODAY })).toBeNull()
  })

  it('fecha no válida', () => {
    expect(validateLastWorkingDate({ lastWorkingDate: '', today: TODAY })).toBe('Indica una fecha válida.')
    expect(validateLastWorkingDate({ lastWorkingDate: '2026-02-30', today: TODAY })).toBe('Indica una fecha válida.')
  })
})

describe('buildDeactivationPreview', () => {
  const versions = [version('2026-09-01'), version('2026-11-16', W2)]
  const overrides = [override('2026-11-03'), override('2026-11-05'), override('2026-11-06'), override('2026-11-20', [{ start: '08:00', end: '12:00' }])]
  const absences = [absence('2026-10-01', '2026-10-03'), absence('2026-11-04', '2026-11-10'), absence('2026-11-25', '2026-11-27', 'leave')]

  it('baja hoy: se elimina solo lo posterior a hoy y se acortan las ausencias en curso', () => {
    const preview = buildDeactivationPreview({ versions, overrides, absences, lastWorkingDate: TODAY, today: TODAY })
    expect(preview.error).toBeNull()
    expect(preview.removed.versions.map(v => v.valid_from)).toEqual(['2026-11-16'])
    expect(preview.removed.overrides.map(o => o.work_date)).toEqual(['2026-11-06', '2026-11-20'])
    expect(preview.removed.absences.map(a => a.start_date)).toEqual(['2026-11-25'])
    expect(preview.removedCount).toBe(4)
    expect(preview.shortened).toEqual([{ absence: absences[1], newEndDate: TODAY }])
    expect(preview.kept).toEqual({ versions: 1, overrides: 2, absences: 2, ignoredAfterLastDay: 0 })
    expect(preview.closesScheduleFrom).toBe('2026-11-06')
    expect(preview.hasPlanning).toBe(true)
  })

  it('baja con fecha pasada: lo que hay entre el último día y hoy se conserva pero ya no cuenta', () => {
    const preview = buildDeactivationPreview({ versions, overrides, absences, lastWorkingDate: '2026-11-02', today: TODAY })
    expect(preview.error).toBeNull()
    // Lo que se elimina no cambia: sigue siendo solo lo posterior a hoy.
    expect(preview.removedCount).toBe(4)
    expect(preview.kept.overrides).toBe(2)
    // Cambios del 3 y del 5, y la ausencia que empieza el 4.
    expect(preview.kept.ignoredAfterLastDay).toBe(3)
    expect(preview.closesScheduleFrom).toBe('2026-11-03')
  })

  it('no elimina nunca versiones vigentes o pasadas', () => {
    const preview = buildDeactivationPreview({ versions, overrides: [], absences: [], lastWorkingDate: TODAY, today: TODAY })
    expect(preview.removed.versions.every(v => v.valid_from > TODAY)).toBe(true)
    expect(preview.kept.versions).toBe(1)
  })

  it('sin horario semanal no hay nada que cerrar', () => {
    const preview = buildDeactivationPreview({ overrides: [override('2026-11-20')], lastWorkingDate: TODAY, today: TODAY })
    expect(preview.closesScheduleFrom).toBeNull()
    expect(preview.removedCount).toBe(1)
  })

  it('con el horario ya cerrado no se vuelve a cerrar', () => {
    const preview = buildDeactivationPreview({ versions: [version('2026-09-01'), version('2026-10-01', null, 'end')], lastWorkingDate: TODAY, today: TODAY })
    expect(preview.closesScheduleFrom).toBeNull()
  })

  it('horario que empieza mañana con baja hoy: se elimina y se cierra el anterior', () => {
    const preview = buildDeactivationPreview({ versions: [version('2026-09-01'), version('2026-11-06', W2)], lastWorkingDate: TODAY, today: TODAY })
    expect(preview.removed.versions.map(v => v.valid_from)).toEqual(['2026-11-06'])
    expect(preview.closesScheduleFrom).toBe('2026-11-06')
  })

  it('sin planificación: nada que eliminar ni cerrar', () => {
    const preview = buildDeactivationPreview({ lastWorkingDate: TODAY, today: TODAY })
    expect(preview).toMatchObject({ error: null, hasPlanning: false, removedCount: 0, shortened: [], closesScheduleFrom: null })
  })

  it('fecha no válida: error y sin cierre', () => {
    const preview = buildDeactivationPreview({ versions, lastWorkingDate: '2026-11-06', today: TODAY })
    expect(preview.error).toBe('El último día de trabajo no puede ser posterior a hoy.')
    expect(preview.closesScheduleFrom).toBeNull()
  })

  it('no modifica los datos de entrada', () => {
    const input = { versions: structuredClone(versions), overrides: structuredClone(overrides), absences: structuredClone(absences) }
    buildDeactivationPreview({ ...input, lastWorkingDate: TODAY, today: TODAY })
    expect(input).toEqual({ versions, overrides, absences })
  })
})

describe('describeDeactivationResult', () => {
  it('resume lo que ha hecho la base de datos', () => {
    expect(describeDeactivationResult({ last_working_date: TODAY, deleted_schedules: 1, deleted_day_changes: 2, deleted_absences: 1, shortened_absences: 1 }))
      .toBe('Último día: 5 nov 2026. Se han eliminado 4 elementos de su planificación futura. Se ha acortado 1 ausencia. Su historial se conserva.')
    expect(describeDeactivationResult({ last_working_date: TODAY, deleted_schedules: 0, deleted_day_changes: 1, deleted_absences: 0, shortened_absences: 0 }))
      .toBe('Último día: 5 nov 2026. Se ha eliminado 1 elemento de su planificación futura. Su historial se conserva.')
    expect(describeDeactivationResult(null)).toBe('Su ficha y su historial se conservan en «Inactivos».')
  })
})

describe('reactivación', () => {
  it('fecha de vuelta propuesta: el lunes que viene', () => {
    expect(getDefaultReturnDate({ lastWorkingDate: TODAY, today: TODAY })).toBe('2026-11-09')
    expect(getDefaultReturnDate({ today: TODAY })).toBe('2026-11-09')
  })

  it('el domingo, con baja ese día: el lunes siguiente (al día siguiente de la baja)', () => {
    expect(getDefaultReturnDate({ lastWorkingDate: '2026-11-08', today: '2026-11-08' })).toBe('2026-11-09')
  })

  const closed = [version('2026-09-01', W1), version('2026-10-21', null, 'end')]

  it('copia el último horario desde la fecha de vuelta', () => {
    const plan = buildReactivationPlan({ versions: closed, lastWorkingDate: '2026-10-20', returnDate: '2026-11-09', copySchedule: true, today: TODAY })
    expect(plan).toMatchObject({ error: null, outcome: REACTIVATION_OUTCOME.COPY, weeklyMinutes: 14 * 60 })
    expect(plan.schedule.valid_from).toBe('2026-09-01')
    expect(describeReactivationOutcome(plan)).toBe('Desde el 9 nov 2026 tendrá su último horario habitual (14 h a la semana). El periodo de baja queda sin horario.')
  })

  it('sin copiar: queda sin horario', () => {
    const plan = buildReactivationPlan({ versions: closed, lastWorkingDate: '2026-10-20', returnDate: '2026-11-09', copySchedule: false, today: TODAY })
    expect(plan.outcome).toBe(REACTIVATION_OUTCOME.NONE)
    expect(describeReactivationOutcome(plan)).toContain('Quedará sin horario')
  })

  it('la vuelta debe ser posterior al último día', () => {
    expect(buildReactivationPlan({ versions: closed, lastWorkingDate: '2026-10-20', returnDate: '2026-10-20', today: TODAY }).error)
      .toBe('La fecha de vuelta debe ser posterior a su último día de trabajo (20 oct 2026).')
  })

  it('para copiar, la vuelta no puede ser antes del lunes de esta semana', () => {
    const plan = buildReactivationPlan({ versions: closed, lastWorkingDate: '2026-10-20', returnDate: '2026-11-01', copySchedule: true, today: TODAY })
    expect(plan.error).toBe('Para copiar su horario, la vuelta no puede ser antes del lunes 2 nov 2026.')
    expect(buildReactivationPlan({ versions: closed, lastWorkingDate: '2026-10-20', returnDate: '2026-11-01', copySchedule: false, today: TODAY }).error).toBeNull()
  })

  it('para copiar, la vuelta debe ser posterior al último registro de horario', () => {
    const versions = [version('2026-09-01'), version('2026-11-03', null, 'end')]
    const plan = buildReactivationPlan({ versions, lastWorkingDate: '2026-11-02', returnDate: '2026-11-03', copySchedule: true, today: TODAY })
    expect(plan.error).toBe('Ya tiene un horario registrado desde el 3 nov 2026. Elige una fecha de vuelta posterior.')
  })

  it('vuelta al día siguiente de una baja de hoy: se anula el cierre', () => {
    const versions = [version('2026-09-01'), version('2026-11-06', null, 'end')]
    const plan = buildReactivationPlan({ versions, lastWorkingDate: TODAY, returnDate: '2026-11-06', copySchedule: true, today: TODAY })
    expect(plan.outcome).toBe(REACTIVATION_OUTCOME.RESTORE)
    expect(buildReactivationPlan({ versions, lastWorkingDate: TODAY, returnDate: '2026-11-06', copySchedule: false, today: TODAY }).outcome).toBe(REACTIVATION_OUTCOME.RESTORE)
    expect(describeReactivationOutcome(plan)).toContain('se anula la baja')
  })

  it('horario sin cerrar (desactivada antes del módulo): sigue igual', () => {
    const plan = buildReactivationPlan({ versions: [version('2026-09-01')], lastWorkingDate: null, returnDate: TODAY, today: TODAY })
    expect(plan.outcome).toBe(REACTIVATION_OUTCOME.CONTINUES)
  })

  it('sin horario que copiar', () => {
    expect(buildReactivationPlan({ versions: [], lastWorkingDate: '2026-10-20', returnDate: '2026-11-09', today: TODAY }).outcome).toBe(REACTIVATION_OUTCOME.NONE)
  })

  it('fecha de vuelta no válida', () => {
    expect(buildReactivationPlan({ versions: closed, returnDate: '', today: TODAY }).error).toBe('Indica una fecha de vuelta válida.')
    expect(describeReactivationOutcome(null)).toBe('')
  })
})

describe('getLeaveErrorFeedback', () => {
  const err = (code, details = null, status = 400) => ({ error: { code, details, message: 'técnico' }, status })

  it('códigos de la migración de horarios', () => {
    expect(getLeaveErrorFeedback(err('PS007', TODAY), 'deactivate', { today: TODAY }).message).toBe('El último día de trabajo no puede ser posterior a hoy.')
    expect(getLeaveErrorFeedback(err('PS007', '2026-11-02'), 'deactivate', { today: TODAY }).message).toContain('empezó el 2 nov 2026')
    expect(getLeaveErrorFeedback(err('PS007', '2026-10-20'), 'reactivate', { today: TODAY }).message).toBe('La fecha de vuelta debe ser posterior a su último día de trabajo (20 oct 2026).')
    expect(getLeaveErrorFeedback(err('PS008'), 'deactivate').message).toContain('ya está dada de baja')
    expect(getLeaveErrorFeedback(err('PS008'), 'reactivate').message).toContain('ya está activa')
    expect(getLeaveErrorFeedback(err('PS002', '2026-11-02'), 'reactivate').message).toBe('Para copiar su horario, la vuelta no puede ser antes del lunes 2 nov 2026.')
    expect(getLeaveErrorFeedback(err('PS001', '2026-11-03'), 'reactivate').message).toContain('desde el 3 nov 2026')
    expect(getLeaveErrorFeedback(err('PS003'), 'reactivate').message).toContain('turno nocturno')
    expect(getLeaveErrorFeedback(err('PS009'), 'deactivate').message).toContain('tiene horarios registrados')
    expect(getLeaveErrorFeedback(err('PS010'), 'reactivate').message).toContain('cerrar o reabrir')
    expect(getLeaveErrorFeedback(err('PS006'), 'deactivate').message).toContain('desactivada')
    expect(getLeaveErrorFeedback(err('P0002'), 'deactivate').kind).toBe(DB_ERROR_KIND.NOT_FOUND)
    expect(getLeaveErrorFeedback(err('22004'), 'deactivate').message).toBe('Falta la fecha.')
  })

  it('migración sin aplicar', () => {
    for (const code of ['PGRST202', '42883', '42703', 'PGRST205']) {
      const feedback = getLeaveErrorFeedback(err(code, null, 404), 'deactivate')
      expect(feedback.kind).toBe(DB_ERROR_KIND.MISSING)
      expect(feedback.message).toContain('sección 14')
    }
  })

  it('errores generales: nunca el mensaje técnico', () => {
    expect(getLeaveErrorFeedback({ error: { message: 'Failed to fetch' }, status: 0 }, 'deactivate').message).toContain('conexión a Internet')
    expect(getLeaveErrorFeedback({ error: { code: 'PGRST303' }, status: 401 }, 'reactivate').kind).toBe(DB_ERROR_KIND.EXPIRED)
    expect(getLeaveErrorFeedback({ error: { code: '42501' }, status: 403 }, 'deactivate').message).toBe('Esta cuenta no tiene permiso para gestionar empleados.')
    expect(getLeaveErrorFeedback({ error: { message: 'x' }, status: 503 }, 'deactivate').message).toBe('No se ha podido cambiar el estado. Vuelve a intentarlo.')
    expect(getLeaveErrorFeedback({ error: { message: 'x' }, status: 503 }, 'load').message).toBe('No se ha podido comprobar su planificación. Vuelve a intentarlo.')
    expect(getLeaveErrorFeedback(err('PS007', TODAY), 'deactivate', { today: TODAY }).message).not.toContain('técnico')
  })
})
