/**
 * Horas extra registradas en una semana, solo para mostrarlas en el resumen
 * de /horarios junto a las horas planificadas. Solo lectura: no modifica
 * public.overtime_entries ni cambia nada de la pantalla de horas extra.
 *
 * Se carga solo cuando `enabled` es true (vista «Resumen»). Si falla, el
 * resumen sigue mostrando las horas planificadas y avisa del error.
 *
 * @param {import('vue').Ref<string>} weekStart lunes de la semana
 * @param {import('vue').Ref<boolean>} enabled
 */
export function useWeekOvertime(weekStart, enabled) {
  const supabase = useSupabaseClient()
  const state = ref({ status: 'idle', weekStart: null, entries: [], kind: null, message: '' })
  let requestId = 0

  async function load() {
    const start = weekStart.value
    if (!enabled.value || !start) return
    const id = ++requestId
    state.value = { ...state.value, status: 'loading' }
    let response
    try {
      response = await supabase
        .from('overtime_entries')
        .select(WEEK_OVERTIME_COLUMNS)
        .gte('work_date', start)
        .lte('work_date', addDaysToDate(start, 6))
    }
    catch (error) {
      response = { data: null, error, status: 0 }
    }
    if (id !== requestId) return

    if (response.error) {
      const feedback = getOvertimeErrorFeedback(response, 'load')
      state.value = { status: 'error', weekStart: start, entries: [], kind: feedback.kind, message: feedback.message }
      return
    }
    state.value = { status: 'ready', weekStart: start, entries: response.data ?? [], kind: null, message: '' }
  }

  onMounted(load)
  watch([weekStart, enabled], load)

  return { state, reload: load }
}
