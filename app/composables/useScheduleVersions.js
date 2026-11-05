/**
 * Versiones del horario habitual (employee_schedules) desde la ficha.
 *
 * `createScheduleVersion` añade una versión NUEVA con los siete días: nunca
 * modifica ni borra las anteriores, que siguen en el historial. La anterior
 * rige hasta el día antes de la nueva. Es una sola sentencia: si falla, no
 * cambia nada.
 *
 * No toca cambios de un día, ausencias ni horas extra. Las reglas se
 * comprueban antes en app/utils/schedule-editor.js y la base de datos las
 * vuelve a comprobar (PS001-PS003, PS006). Si la migración de horarios no está
 * aplicada, el error se muestra con un aviso claro.
 */
export function useScheduleVersions() {
  const supabase = useSupabaseClient()

  async function request(run) {
    try {
      return await run()
    }
    catch (error) {
      return { data: null, error, status: 0 }
    }
  }

  /**
   * @param {{ employeeId: string, validFrom: string, week: object }} params
   *   week con las claves «1»…«7» ([] = descanso)
   */
  async function createScheduleVersion({ employeeId, validFrom, week }) {
    const response = await request(() => supabase
      .from('employee_schedules')
      .insert({ employee_id: employeeId, valid_from: validFrom, kind: SCHEDULE_KIND.SCHEDULE, week })
      .select(LEAVE_SCHEDULE_COLUMNS)
      .single())
    if (response.error) {
      return { ok: false, code: String(response.error.code ?? ''), ...getScheduleSaveFeedback(response) }
    }
    return { ok: true, data: response.data }
  }

  return { createScheduleVersion }
}
