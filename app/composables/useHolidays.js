/**
 * Datos de public.holidays: lectura, alta, edición y eliminación.
 *
 * Usa el cliente de Supabase ya configurado (clave publicable + JWT de la
 * sesión). Las políticas RLS deciden qué puede leer y escribir la cuenta.
 *
 * Se cargan todos los festivos de una vez: son pocas fechas al año, y así se
 * puede cambiar de año sin nuevas consultas y comprobar fechas repetidas de
 * cualquier año antes de guardar.
 */
export function useHolidays() {
  const supabase = useSupabaseClient()

  async function request(run) {
    try {
      return await run()
    }
    catch (error) {
      return { data: null, error, status: 0 }
    }
  }

  async function fetchHolidays() {
    const response = await request(() => supabase
      .from('holidays')
      .select(HOLIDAY_COLUMNS)
      .order('holiday_date'))

    if (response.error) {
      const feedback = getHolidayErrorFeedback(response, 'load')
      throw createError({
        statusCode: response.status || 500,
        statusMessage: 'Holidays load failed',
        data: { kind: feedback.kind, message: feedback.message },
      })
    }

    return sortHolidays(response.data)
  }

  const {
    data: holidays,
    status,
    error,
    refresh,
  } = useLazyAsyncData('holidays', fetchHolidays, { default: () => [] })

  const loadError = computed(() => {
    if (!error.value) return null
    const data = typeof error.value.data === 'string'
      ? safeParse(error.value.data)
      : error.value.data
    return {
      kind: data?.kind ?? DB_ERROR_KIND.UNKNOWN,
      message: data?.message ?? getHolidayErrorFeedback({ error: {} }, 'load').message,
    }
  })

  function applyResult(response, action) {
    if (response.error) {
      return { ok: false, ...getHolidayErrorFeedback(response, action) }
    }
    holidays.value = upsertHoliday(holidays.value, response.data)
    return { ok: true, holiday: response.data }
  }

  async function createHoliday(values) {
    const response = await request(() => supabase
      .from('holidays')
      .insert(normalizeHolidayInput(values))
      .select(HOLIDAY_COLUMNS)
      .single())
    return applyResult(response, 'save')
  }

  async function updateHoliday(id, values) {
    const response = await request(() => supabase
      .from('holidays')
      // Al editar un festivo oficial pasa a ser manual: la actualización
      // automática ya no lo cambia ni lo retira.
      .update({ ...normalizeHolidayInput(values), source: 'manual' })
      .eq('id', id)
      .select(HOLIDAY_COLUMNS)
      .single())
    return applyResult(response, 'save')
  }

  // Con .select().single(), si la fila no existe o RLS no la deja ver, la
  // respuesta es un error PGRST116 (no encontrado) en lugar de un éxito vacío.
  async function deleteHoliday(id) {
    const response = await request(() => supabase
      .from('holidays')
      .delete()
      .eq('id', id)
      .select('id')
      .single())
    if (response.error) {
      return { ok: false, ...getHolidayErrorFeedback(response, 'delete') }
    }
    holidays.value = removeHoliday(holidays.value, id)
    return { ok: true }
  }

  // Sustituye la lista cargada (tras actualizar los festivos oficiales).
  function setHolidays(list) {
    holidays.value = sortHolidays(list)
  }

  return {
    holidays,
    setHolidays,
    status,
    loadError,
    refresh,
    createHoliday,
    updateHoliday,
    deleteHoliday,
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
