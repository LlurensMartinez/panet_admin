/**
 * Datos de public.suppliers: lectura, alta, edición y activación/desactivación.
 *
 * Usa el cliente de Supabase ya configurado (clave publicable + JWT de la
 * sesión). Las políticas RLS deciden qué puede leer y escribir la cuenta.
 * Nunca se usa una clave secreta.
 *
 * No existe ninguna operación de borrado: los proveedores se desactivan
 * (is_active = false) para conservar sus pedidos.
 *
 * Se cargan todos los proveedores de una vez (volumen de una sola tienda) y
 * la búsqueda y los filtros se aplican en el navegador con las funciones de
 * app/utils/suppliers.js.
 */
export function useSuppliers() {
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

  async function fetchSuppliers() {
    const response = await request(() => supabase
      .from('suppliers')
      .select(SUPPLIER_COLUMNS)
      .order('name'))

    if (response.error) {
      const feedback = getSupplierErrorFeedback(response, 'load')
      throw createError({
        statusCode: response.status || 500,
        statusMessage: 'Suppliers load failed',
        data: { kind: feedback.kind, message: feedback.message },
      })
    }

    return sortSuppliers(response.data)
  }

  const {
    data: suppliers,
    status,
    error,
    refresh,
  } = useLazyAsyncData('suppliers', fetchSuppliers, { default: () => [] })

  const loadError = computed(() => {
    if (!error.value) return null
    const data = typeof error.value.data === 'string'
      ? safeParse(error.value.data)
      : error.value.data
    return {
      kind: data?.kind ?? DB_ERROR_KIND.UNKNOWN,
      message: data?.message ?? getSupplierErrorFeedback({ error: {} }, 'load').message,
    }
  })

  function applyResult(response, action) {
    if (response.error) {
      return { ok: false, ...getSupplierErrorFeedback(response, action) }
    }
    suppliers.value = upsertSupplier(suppliers.value, response.data)
    return { ok: true, supplier: response.data }
  }

  async function createSupplier(values) {
    const response = await request(() => supabase
      .from('suppliers')
      .insert(normalizeSupplierInput(values))
      .select(SUPPLIER_COLUMNS)
      .single())
    return applyResult(response, 'save')
  }

  async function updateSupplier(id, values) {
    const response = await request(() => supabase
      .from('suppliers')
      .update(normalizeSupplierInput(values))
      .eq('id', id)
      .select(SUPPLIER_COLUMNS)
      .single())
    return applyResult(response, 'save')
  }

  async function setSupplierActive(id, isActive) {
    const response = await request(() => supabase
      .from('suppliers')
      .update({ is_active: isActive })
      .eq('id', id)
      .select(SUPPLIER_COLUMNS)
      .single())
    return applyResult(response, 'status')
  }

  return {
    suppliers,
    status,
    loadError,
    refresh,
    createSupplier,
    updateSupplier,
    setSupplierActive,
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
