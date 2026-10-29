/**
 * Pedidos de la agenda y acciones sobre ellos (public.orders).
 *
 * - Leer la agenda NUNCA escribe: carga los pedidos guardados de las fechas de
 *   la agenda y la página calcula las previsiones con buildAgenda()
 *   (app/utils/orders.js). Recargar o cambiar de día no crea filas.
 * - Una previsión se guarda (INSERT con su scheduled_delivery_date) solo
 *   cuando la encargada actúa sobre ella. Se usa INSERT y no UPSERT para no
 *   sobrescribir lo que otro dispositivo haya guardado: si la previsión ya
 *   existe, la base de datos responde 23505 y la agenda se recarga.
 * - Los UPDATE solo envían las columnas permitidas (fechas, estado y notas).
 * - Solo se eliminan pedidos pendientes (política RLS). Si el pedido ya no es
 *   pendiente o ya no existe, la respuesta no tiene filas (PGRST116).
 *
 * Usa el cliente de Supabase con la clave publicable y el JWT de la sesión.
 *
 * @param {import('vue').Ref<string>} today Fecha de hoy (YYYY-MM-DD, tienda).
 */
export function useOrders(today) {
  const supabase = useSupabaseClient()

  async function request(run) {
    try {
      return await run()
    }
    catch (error) {
      return { data: null, error, status: 0 }
    }
  }

  async function fetchAgendaOrders() {
    const { from, to, deliveryTo } = getAgendaQueryRange(today.value)
    const response = await request(() => supabase
      .from('orders')
      .select(ORDER_COLUMNS)
      .or([
        `and(prepare_date.gte.${from},prepare_date.lte.${to})`,
        `and(scheduled_delivery_date.gte.${from},scheduled_delivery_date.lte.${deliveryTo})`,
        `and(delivery_date.gte.${from},delivery_date.lte.${deliveryTo})`,
      ].join(','))
      .order('prepare_date')
      .order('id'))

    if (response.error) {
      const feedback = getOrderErrorFeedback(response, 'load')
      throw createError({
        statusCode: response.status || 500,
        statusMessage: 'Orders load failed',
        data: { kind: feedback.kind, message: feedback.message },
      })
    }
    return response.data ?? []
  }

  const {
    data: orders,
    status,
    error,
    refresh,
  } = useLazyAsyncData('orders-agenda', fetchAgendaOrders, { default: () => [], watch: [today] })

  const loadError = computed(() => {
    if (!error.value) return null
    const data = typeof error.value.data === 'string' ? safeParse(error.value.data) : error.value.data
    return {
      kind: data?.kind ?? DB_ERROR_KIND.UNKNOWN,
      message: data?.message ?? getOrderErrorFeedback({ error: {} }, 'load').message,
    }
  })

  function applyResult(response, action, insert = null) {
    if (response.error) {
      const feedback = getOrderErrorFeedback(response, action, { insert })
      // El pedido ha cambiado en otro dispositivo: se recarga la agenda.
      if (feedback.conflict) refresh()
      return { ok: false, ...feedback }
    }
    orders.value = upsertOrder(orders.value, response.data)
    return { ok: true, order: response.data }
  }

  function insertOrder(payload, action) {
    return request(() => supabase
      .from('orders')
      .insert(payload)
      .select(ORDER_COLUMNS)
      .single())
      .then(response => applyResult(response, action, payload))
  }

  function updateOrder(id, changes, action) {
    return request(() => supabase
      .from('orders')
      .update(buildOrderUpdate(changes))
      .eq('id', id)
      .select(ORDER_COLUMNS)
      .single())
      .then(response => applyResult(response, action))
  }

  /** Cambia el estado. Una previsión se guarda con ese estado. */
  function setStatus(item, nextStatus) {
    return item.isForecast
      ? insertOrder(buildForecastInsert(item, { status: nextStatus }), 'status')
      : updateOrder(item.id, { status: nextStatus }, 'status')
  }

  /** Guarda fechas y notas. Una previsión se guarda como pedido pendiente. */
  function saveDetails(item, values) {
    const data = normalizeOrderInput(values)
    const changes = { delivery_date: data.delivery_date, prepare_date: data.prepare_date, notes: data.notes }
    return item.isForecast
      ? insertOrder(buildForecastInsert(item, changes), 'save')
      : updateOrder(item.id, changes, 'save')
  }

  function createManualOrder(values) {
    return insertOrder(buildManualInsert(values), 'save')
  }

  async function deleteOrder(id) {
    const response = await request(() => supabase
      .from('orders')
      .delete()
      .eq('id', id)
      .select('id')
      .single())
    if (response.error) {
      const feedback = getOrderErrorFeedback(response, 'delete')
      if (feedback.conflict) refresh()
      return { ok: false, ...feedback }
    }
    orders.value = removeOrder(orders.value, id)
    return { ok: true }
  }

  return {
    orders,
    status,
    loadError,
    refresh,
    setStatus,
    saveDetails,
    createManualOrder,
    deleteOrder,
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
