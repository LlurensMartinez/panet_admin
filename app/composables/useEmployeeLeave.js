/**
 * Baja y reactivación de empleadas con fecha (migración de horarios,
 * 20261105100000_employee_schedules.sql).
 *
 * - `loadLeaveContext`: lee la fecha de baja de la empleada y su
 *   planificación (versiones del horario, cambios de un día y ausencias) para
 *   la vista previa. Si la migración todavía no está aplicada, devuelve
 *   `available: false` y la app desactiva y activa como antes.
 * - `deactivateEmployee` / `reactivateEmployee`: llaman a las funciones de la
 *   base de datos, que hacen cada operación en una sola transacción (si algo
 *   falla, no cambia nada). Después leen la ficha actualizada.
 *
 * - `setStatusWithoutPlanning`: empleadas sin planificación. Una sola
 *   actualización de `employees` (estado y fecha de baja), como antes. La base
 *   de datos la rechaza si, entretanto, se le ha registrado algún horario.
 *
 * Si la migración no está aplicada, la página usa
 * useEmployees().setEmployeeActive, igual que antes.
 */
export function useEmployeeLeave() {
  const supabase = useSupabaseClient()

  async function request(run) {
    try {
      return await run()
    }
    catch (error) {
      return { data: null, error, status: 0 }
    }
  }

  const isMissing = response => getLeaveErrorFeedback(response, 'load').kind === DB_ERROR_KIND.MISSING

  /**
   * @param {string} employeeId
   * @param {{ withLastWorkingDate?: boolean }} [options] la reactivación
   *   necesita además la fecha de baja; la baja no (la empleada está activa).
   */
  async function loadLeaveContext(employeeId, { withLastWorkingDate = false } = {}) {
    const [employee, versions, overrides, absences] = await Promise.all([
      withLastWorkingDate
        ? request(() => supabase.from('employees').select(LEAVE_EMPLOYEE_COLUMNS).eq('id', employeeId).single())
        : { data: null, error: null },
      request(() => supabase.from('employee_schedules').select(LEAVE_SCHEDULE_COLUMNS).eq('employee_id', employeeId).order('valid_from')),
      request(() => supabase.from('employee_day_overrides').select(LEAVE_OVERRIDE_COLUMNS).eq('employee_id', employeeId).order('work_date')),
      request(() => supabase.from('employee_absences').select(LEAVE_ABSENCE_COLUMNS).eq('employee_id', employeeId).order('start_date')),
    ])
    const responses = [employee, versions, overrides, absences]

    // Migración sin aplicar: se mantiene el comportamiento anterior.
    if (responses.some(response => response.error && isMissing(response))) {
      return { ok: true, available: false, lastWorkingDate: null, versions: [], overrides: [], absences: [] }
    }
    const failed = responses.find(response => response.error)
    if (failed) return { ok: false, ...getLeaveErrorFeedback(failed, 'load') }

    return {
      ok: true,
      available: true,
      lastWorkingDate: employee.data?.last_working_date ?? null,
      versions: versions.data ?? [],
      overrides: overrides.data ?? [],
      absences: absences.data ?? [],
    }
  }

  async function fetchEmployee(id) {
    return request(() => supabase.from('employees').select(EMPLOYEE_COLUMNS).eq('id', id).single())
  }

  async function runAndReload(id, action, call) {
    const today = getTodayDate()
    const response = await request(call)
    if (response.error) return { ok: false, code: String(response.error.code ?? ''), ...getLeaveErrorFeedback(response, action, { today }) }

    const reloaded = await fetchEmployee(id)
    // La operación ya se ha guardado: si falla solo la relectura, se avisa
    // como correcta y la lista se actualizará al recargar.
    return { ok: true, result: response.data, employee: reloaded.error ? null : reloaded.data }
  }

  function deactivateEmployee(id, lastWorkingDate) {
    return runAndReload(id, 'deactivate', () => supabase.rpc('deactivate_employee', {
      p_employee_id: id,
      p_last_working_date: lastWorkingDate,
    }))
  }

  function reactivateEmployee(id, returnDate, copySchedule) {
    return runAndReload(id, 'reactivate', () => supabase.rpc('reactivate_employee', {
      p_employee_id: id,
      p_return_date: returnDate,
      p_copy_schedule: Boolean(copySchedule),
    }))
  }

  async function setStatusWithoutPlanning(id, isActive, lastWorkingDate) {
    const today = getTodayDate()
    const response = await request(() => supabase
      .from('employees')
      .update({ is_active: isActive, last_working_date: isActive ? null : lastWorkingDate })
      .eq('id', id)
      .select(EMPLOYEE_COLUMNS)
      .single())
    if (response.error) return { ok: false, code: String(response.error.code ?? ''), ...getLeaveErrorFeedback(response, isActive ? 'reactivate' : 'deactivate', { today }) }
    return { ok: true, result: null, employee: response.data }
  }

  return { loadLeaveContext, deactivateEmployee, reactivateEmployee, setStatusWithoutPlanning }
}
