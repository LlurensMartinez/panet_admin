/**
 * Datos de una semana del calendario de horarios (solo lectura):
 *   - empleadas, con su fecha de baja (`last_working_date`);
 *   - versiones del horario habitual de todas ellas;
 *   - cambios de un día y ausencias de esa semana (y del día anterior y el
 *     siguiente, para detectar turnos nocturnos que pisan el lunes o vienen
 *     del domingo).
 *
 * Si la migración de horarios no está aplicada, `available` es false y la
 * página lo indica. La resolución de cada día la hace buildWeekPlan
 * (app/utils/schedules.js).
 *
 * @param {import('vue').Ref<string>} weekStart lunes de la semana
 */
export function useWeekPlan(weekStart) {
  const supabase = useSupabaseClient()
  const state = ref({ status: 'idle', available: true, data: null, kind: null, message: '' })
  let requestId = 0

  async function request(run) {
    try {
      return await run()
    }
    catch (error) {
      return { data: null, error, status: 0 }
    }
  }

  async function load() {
    const start = weekStart.value
    if (!start) return
    const id = ++requestId
    const from = addDaysToDate(start, -1)
    const to = addDaysToDate(start, 7)
    state.value = { ...state.value, status: 'loading' }

    const responses = await Promise.all([
      request(() => supabase.from('employees').select(WEEK_PLAN_EMPLOYEE_COLUMNS)),
      request(() => supabase.from('employee_schedules').select(LEAVE_SCHEDULE_COLUMNS).order('valid_from')),
      request(() => supabase.from('employee_day_overrides').select(LEAVE_OVERRIDE_COLUMNS).gte('work_date', from).lte('work_date', to)),
      request(() => supabase.from('employee_absences').select(LEAVE_ABSENCE_COLUMNS).lte('start_date', to).gte('end_date', from)),
    ])
    // Una respuesta de una semana anterior que llega tarde no pisa la actual.
    if (id !== requestId) return

    const missing = responses.find(response => response.error && getLeaveErrorFeedback(response, 'load').kind === DB_ERROR_KIND.MISSING)
    if (missing) {
      state.value = { status: 'ready', available: false, data: null, kind: DB_ERROR_KIND.MISSING, message: '' }
      return
    }
    const failed = responses.find(response => response.error)
    if (failed) {
      const feedback = getLeaveErrorFeedback(failed, 'load')
      state.value = { status: 'error', available: true, data: state.value.data, kind: feedback.kind, message: getWeekPlanLoadMessage(feedback) }
      return
    }

    const [employees, versions, overrides, absences] = responses.map(response => response.data ?? [])
    state.value = {
      status: 'ready',
      available: true,
      data: { weekStart: start, employees, versions, overrides, absences },
      kind: null,
      message: '',
    }
  }

  onMounted(load)
  watch(weekStart, load)

  return { state, reload: load }
}
