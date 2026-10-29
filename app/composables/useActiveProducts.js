/**
 * Productos habituales ACTIVOS de todos los proveedores (solo lectura), para
 * el resumen de Inicio.
 *
 * - Una única consulta (is_active = true); el agrupado por proveedor lo hace
 *   buildHomeSummary() (app/utils/home.js).
 * - No expone ninguna operación de escritura: Inicio no crea, modifica ni
 *   borra nada. Para editar productos está la ficha de cada proveedor.
 *
 * Usa el cliente de Supabase ya configurado (clave publicable + JWT de la
 * sesión). Las políticas RLS deciden qué puede leer la cuenta.
 */
export function useActiveProducts() {
  const supabase = useSupabaseClient()

  async function fetchActiveProducts() {
    let response
    try {
      response = await supabase
        .from('supplier_products')
        .select(PRODUCT_COLUMNS)
        .eq('is_active', true)
        .order('name')
    }
    catch (error) {
      response = { data: null, error, status: 0 }
    }

    if (response.error) {
      const feedback = getProductErrorFeedback(response, 'load')
      throw createError({
        statusCode: response.status || 500,
        statusMessage: 'Active products load failed',
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
  } = useLazyAsyncData('supplier-products:active', fetchActiveProducts, { default: () => [] })

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

  return { products, status, loadError, refresh }
}

function safeParse(value) {
  try {
    return JSON.parse(value)
  }
  catch {
    return null
  }
}
