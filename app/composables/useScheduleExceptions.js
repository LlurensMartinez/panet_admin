/**
 * Excepciones del calendario: cambios de un día (employee_day_overrides) y
 * ausencias (employee_absences). Cada operación es una sola sentencia, así
 * que, si falla, no cambia nada.
 *
 * Nunca escribe en employee_schedules: el horario habitual y su historial no
 * se modifican. Las reglas (turnos, solapes, cambios de hora, periodos
 * laborales) se comprueban antes en app/utils/schedule-exceptions.js y la
 * base de datos las vuelve a comprobar.
 */
export function useScheduleExceptions() {
  const supabase = useSupabaseClient()

  async function request(run) {
    try {
      return await run()
    }
    catch (error) {
      return { data: null, error, status: 0 }
    }
  }

  function result(response, target) {
    if (response.error) {
      return { ok: false, code: String(response.error.code ?? ''), ...getExceptionErrorFeedback(response, target) }
    }
    return { ok: true, data: response.data }
  }

  // ----------------------------------------------------- Cambios de un día

  /** Guarda los turnos de un día (nuevo cambio o el existente). [] = día libre. */
  async function saveDayOverride({ employeeId, date, shifts, existingId = null }) {
    const clean = shifts.map(({ start, end }) => ({ start, end }))
    const response = await request(() => existingId
      ? supabase.from('employee_day_overrides').update({ shifts: clean }).eq('id', existingId).select(OVERRIDE_COLUMNS).single()
      : supabase.from('employee_day_overrides').insert({ employee_id: employeeId, work_date: date, shifts: clean }).select(OVERRIDE_COLUMNS).single())
    return result(response, 'override')
  }

  /** Quita el cambio: el día vuelve al horario habitual. */
  async function deleteDayOverride(id) {
    const response = await request(() => supabase.from('employee_day_overrides').delete().eq('id', id).select('id'))
    return result(response, 'override')
  }

  // ------------------------------------------------------------- Ausencias

  /** Todas las ausencias de una empleada (para la lista y los solapes). */
  async function loadEmployeeAbsences(employeeId) {
    const response = await request(() => supabase
      .from('employee_absences')
      .select(ABSENCE_COLUMNS)
      .eq('employee_id', employeeId)
      .order('start_date', { ascending: false }))
    return result(response, 'load')
  }

  async function saveAbsence({ employeeId, values }) {
    const data = normalizeAbsenceInput(values)
    const response = await request(() => values.id
      ? supabase.from('employee_absences').update(data).eq('id', values.id).select(ABSENCE_COLUMNS).single()
      : supabase.from('employee_absences').insert({ ...data, employee_id: employeeId }).select(ABSENCE_COLUMNS).single())
    return result(response, 'absence')
  }

  async function deleteAbsence(id) {
    const response = await request(() => supabase.from('employee_absences').delete().eq('id', id).select('id'))
    return result(response, 'absence')
  }

  return { saveDayOverride, deleteDayOverride, loadEmployeeAbsences, saveAbsence, deleteAbsence }
}
