/**
 * Historial de pedidos guardados, con filtros y paginación en el servidor.
 *
 * Solo muestra pedidos guardados (preparados, descartados, editados o creados
 * a mano): las previsiones del calendario no se guardan.
 *
 * - Filtros: proveedor (incluidos los inactivos) y fecha de entrega
 *   («Desde» y «Hasta», ambos incluidos; un extremo vacío no limita).
 * - Orden: entrega más reciente primero.
 * - Páginas de HISTORY_PAGE_SIZE pedidos con el total exacto (count).
 *
 * @param {{ supplierId?: string, from: string, to: string }} filters reactivo
 * @param {import('vue').Ref<number>} page página (desde 0)
 * @param {import('vue').Ref<boolean>} enabled carga solo cuando se abre el historial
 */
export function useOrderHistory(filters, page, enabled) {
  const supabase = useSupabaseClient()

  async function fetchHistory() {
    if (!enabled.value || validateDateRange(filters)) return { rows: [], total: 0, skipped: true }

    const { start, end } = getHistoryRange(page.value)
    let query = supabase
      .from('orders')
      .select(ORDER_COLUMNS, { count: 'exact' })
    if (filters.supplierId) query = query.eq('supplier_id', filters.supplierId)
    if (filters.from) query = query.gte('delivery_date', filters.from)
    if (filters.to) query = query.lte('delivery_date', filters.to)

    let response
    try {
      response = await query
        .order('delivery_date', { ascending: false })
        .order('prepare_date', { ascending: false })
        .order('id')
        .range(start, end)
    }
    catch (error) {
      response = { data: null, error, status: 0 }
    }

    // Página fuera de rango (por ejemplo, tras eliminar el último pedido de
    // la última página): la página la corrige y vuelve a cargar.
    if (response.error?.code === 'PGRST103') return { rows: [], total: 0, outOfRange: true }

    if (response.error) {
      const feedback = getOrderErrorFeedback(response, 'load')
      throw createError({
        statusCode: response.status || 500,
        statusMessage: 'Order history load failed',
        data: { kind: feedback.kind, message: feedback.message },
      })
    }
    // `page`: la página de estas filas, para que el resumen («Mostrando 21–40»)
    // describa siempre lo que se ve, también mientras carga la siguiente.
    return { rows: response.data ?? [], total: response.count ?? 0, page: page.value }
  }

  const {
    data,
    status,
    error,
    refresh,
  } = useLazyAsyncData('orders-history', fetchHistory, {
    default: () => ({ rows: [], total: 0, skipped: true }),
    watch: [() => filters.supplierId, () => filters.from, () => filters.to, page, enabled],
  })

  const loadError = computed(() => {
    if (!error.value) return null
    const raw = error.value.data
    const parsed = typeof raw === 'string' ? safeParse(raw) : raw
    return {
      kind: parsed?.kind ?? DB_ERROR_KIND.UNKNOWN,
      message: parsed?.message ?? getOrderErrorFeedback({ error: {} }, 'load').message,
    }
  })

  /** Sustituye un pedido de la página actual tras modificarlo. */
  function replaceRow(order) {
    if (!data.value?.rows) return
    data.value = { ...data.value, rows: data.value.rows.map(row => row.id === order.id ? order : row) }
  }

  return { history: data, status, loadError, refresh, replaceRow }
}

function safeParse(value) {
  try {
    return JSON.parse(value)
  }
  catch {
    return null
  }
}
