/**
 * Datos de public.overtime_entries: lectura, alta, edición y eliminación.
 *
 * Usa el cliente de Supabase ya configurado (clave publicable + JWT de la
 * sesión). La RLS decide qué puede leer y escribir la cuenta; nunca se usa
 * una clave secreta. Cada registro trae embebida la ficha del empleado a
 * través de la clave foránea employee_id → employees.id.
 *
 * Se cargan todos los registros (volumen de una sola tienda) y los filtros se
 * aplican en el navegador con app/utils/overtime.js, como en Empleados. La
 * carga se hace por páginas y comprueba el recuento total, para que el
 * límite de filas por respuesta de la API de Supabase (1000 por defecto) no
 * deje registros fuera de los totales.
 *
 * Eliminar un registro solo borra esa fila de overtime_entries; la ficha del
 * empleado no se modifica.
 */
const PAGE_SIZE = 1000

export function useOvertime() {
  const supabase = useSupabaseClient()

  async function request(run) {
    try {
      return await run()
    }
    catch (error) {
      // Un fallo de red puede llegar como excepción.
      return { data: null, error, status: 0 }
    }
  }

  async function fetchEntries() {
    const rows = []

    for (;;) {
      const from = rows.length
      const response = await request(() => supabase
        .from('overtime_entries')
        .select(OVERTIME_COLUMNS, { count: 'exact' })
        .order('work_date', { ascending: false })
        .order('created_at', { ascending: false })
        .order('id', { ascending: true })
        .range(from, from + PAGE_SIZE - 1))

      if (response.error) {
        const feedback = getOvertimeErrorFeedback(response, 'load')
        throw createError({
          statusCode: response.status || 500,
          statusMessage: 'Overtime load failed',
          data: { kind: feedback.kind, message: feedback.message },
        })
      }

      const page = response.data ?? []
      rows.push(...page)
      const total = response.count ?? rows.length
      if (page.length === 0 || rows.length >= total) break
    }

    return sortOvertimeEntries(rows)
  }

  const {
    data: entries,
    status,
    error,
    refresh,
  } = useLazyAsyncData('overtime-entries', fetchEntries, { default: () => [] })

  const loadError = computed(() => {
    if (!error.value) return null
    const data = typeof error.value.data === 'string' ? safeParse(error.value.data) : error.value.data
    return {
      kind: data?.kind ?? DB_ERROR_KIND.UNKNOWN,
      message: data?.message ?? getOvertimeErrorFeedback({ error: {} }, 'load').message,
    }
  })

  function applySaved(response) {
    if (response.error) return { ok: false, ...getOvertimeErrorFeedback(response, 'save') }
    entries.value = upsertOvertimeEntry(entries.value, response.data)
    return { ok: true, entry: response.data }
  }

  async function createEntry(values) {
    const response = await request(() => supabase
      .from('overtime_entries')
      .insert(normalizeOvertimeInput(values))
      .select(OVERTIME_COLUMNS)
      .single())
    return applySaved(response)
  }

  async function updateEntry(id, values) {
    const response = await request(() => supabase
      .from('overtime_entries')
      .update(normalizeOvertimeInput(values))
      .eq('id', id)
      .select(OVERTIME_COLUMNS)
      .single())
    return applySaved(response)
  }

  async function deleteEntry(id) {
    // .select().single(): si no se ha borrado ninguna fila (ya no existía o
    // la RLS no lo permite), Supabase devuelve un error en vez de un éxito.
    const response = await request(() => supabase
      .from('overtime_entries')
      .delete()
      .eq('id', id)
      .select('id')
      .single())
    if (response.error) return { ok: false, ...getOvertimeErrorFeedback(response, 'delete') }
    entries.value = removeOvertimeEntry(entries.value, id)
    return { ok: true }
  }

  return {
    entries,
    status,
    loadError,
    refresh,
    createEntry,
    updateEntry,
    deleteEntry,
  }
}

function safeParse(value) {
  try {
    return JSON.parse(value)
  }
  catch {
    return null
  }
}
