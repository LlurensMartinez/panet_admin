/**
 * Productos habituales de UN proveedor (public.supplier_products): lectura,
 * alta, edición y activación/desactivación.
 *
 * - Solo se leen los productos del proveedor indicado: los de un proveedor
 *   nunca aparecen en la ficha de otro.
 * - No existe ninguna operación de borrado: los productos se desactivan
 *   (is_active = false), igual que los proveedores.
 * - Los UPDATE nunca envían supplier_id: un producto no cambia de proveedor
 *   (la base de datos tampoco lo permite).
 *
 * Usa el cliente de Supabase ya configurado (clave publicable + JWT de la
 * sesión). Las políticas RLS deciden qué puede leer y escribir la cuenta.
 *
 * @param {string} supplierId
 */
export function useSupplierProducts(supplierId) {
  const supabase = useSupabaseClient()

  async function request(run) {
    try {
      return await run()
    }
    catch (error) {
      return { data: null, error, status: 0 }
    }
  }

  async function fetchProducts() {
    // Identificador mal formado en la URL: no hay nada que consultar.
    if (!isUuid(supplierId)) return []
    const response = await request(() => supabase
      .from('supplier_products')
      .select(PRODUCT_COLUMNS)
      .eq('supplier_id', supplierId)
      .order('name'))

    if (response.error) {
      const feedback = getProductErrorFeedback(response, 'load')
      throw createError({
        statusCode: response.status || 500,
        statusMessage: 'Supplier products load failed',
        data: { kind: feedback.kind, message: feedback.message },
      })
    }

    return sortProducts(response.data)
  }

  const {
    data: products,
    status,
    error,
    refresh,
  } = useLazyAsyncData(`supplier-products:${supplierId}`, fetchProducts, { default: () => [] })

  const loadError = computed(() => {
    if (!error.value) return null
    const data = typeof error.value.data === 'string'
      ? safeParse(error.value.data)
      : error.value.data
    return {
      kind: data?.kind ?? DB_ERROR_KIND.UNKNOWN,
      message: data?.message ?? getProductErrorFeedback({ error: {} }, 'load').message,
    }
  })

  function applyResult(response, action) {
    if (response.error) {
      return { ok: false, ...getProductErrorFeedback(response, action) }
    }
    products.value = upsertProduct(products.value, response.data)
    return { ok: true, product: response.data }
  }

  async function createProduct(values) {
    const response = await request(() => supabase
      .from('supplier_products')
      .insert({ supplier_id: supplierId, ...normalizeProductInput(values) })
      .select(PRODUCT_COLUMNS)
      .single())
    return applyResult(response, 'save')
  }

  async function updateProduct(id, values) {
    const response = await request(() => supabase
      .from('supplier_products')
      .update(normalizeProductInput(values))
      .eq('id', id)
      .select(PRODUCT_COLUMNS)
      .single())
    return applyResult(response, 'save')
  }

  async function setProductActive(id, isActive) {
    const response = await request(() => supabase
      .from('supplier_products')
      .update({ is_active: isActive })
      .eq('id', id)
      .select(PRODUCT_COLUMNS)
      .single())
    return applyResult(response, 'status')
  }

  return {
    products,
    status,
    loadError,
    refresh,
    createProduct,
    updateProduct,
    setProductActive,
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
