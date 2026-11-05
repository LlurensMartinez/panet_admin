/**
 * Datos de public.employees: lectura, alta, edición y activación/desactivación.
 *
 * Usa el cliente de Supabase ya configurado (clave publicable + JWT de la
 * sesión). Las políticas RLS deciden qué puede leer y escribir la cuenta: si
 * no está autorizada, la lectura devuelve una lista vacía y las escrituras
 * fallan. Nunca se usa una clave secreta.
 *
 * No existe ninguna operación de borrado: los empleados se desactivan
 * (is_active = false) para conservar su historial de horas extra.
 *
 * Se cargan todos los empleados de una vez (volumen de una sola tienda) y la
 * búsqueda y los filtros se aplican en el navegador con las funciones de
 * app/utils/employees.js. Si el volumen creciera, bastaría con trasladar los
 * filtros a la consulta de `fetchEmployees`.
 */
export function useEmployees() {
  const supabase = useSupabaseClient()

  async function request(run) {
    try {
      return await run()
    }
    catch (error) {
      // supabase-js devuelve los errores en `error`, pero un fallo de red
      // puede llegar como excepción.
      return { data: null, error, status: 0 }
    }
  }

  async function fetchEmployees() {
    const response = await request(() => supabase
      .from('employees')
      .select(EMPLOYEE_COLUMNS)
      .order('first_name')
      .order('last_name'))

    if (response.error) {
      const feedback = getEmployeeErrorFeedback(response, 'load')
      throw createError({
        statusCode: response.status || 500,
        statusMessage: 'Employees load failed',
        data: { kind: feedback.kind, message: feedback.message },
      })
    }

    return sortEmployees(response.data)
  }

  const {
    data: employees,
    status,
    error,
    refresh,
  } = useLazyAsyncData('employees', fetchEmployees, { default: () => [] })

  const loadError = computed(() => {
    if (!error.value) return null
    const data = typeof error.value.data === 'string'
      ? safeParse(error.value.data)
      : error.value.data
    return {
      kind: data?.kind ?? DB_ERROR_KIND.UNKNOWN,
      message: data?.message ?? getEmployeeErrorFeedback({ error: {} }, 'load').message,
    }
  })

  function applyResult(response, action) {
    if (response.error) {
      return { ok: false, ...getEmployeeErrorFeedback(response, action) }
    }
    employees.value = upsertEmployee(employees.value, response.data)
    return { ok: true, employee: response.data }
  }

  async function createEmployee(values) {
    const response = await request(() => supabase
      .from('employees')
      .insert(normalizeEmployeeInput(values))
      .select(EMPLOYEE_COLUMNS)
      .single())
    return applyResult(response, 'save')
  }

  async function updateEmployee(id, values) {
    const response = await request(() => supabase
      .from('employees')
      .update(normalizeEmployeeInput(values))
      .eq('id', id)
      .select(EMPLOYEE_COLUMNS)
      .single())
    return applyResult(response, 'save')
  }

  async function setEmployeeActive(id, isActive) {
    const response = await request(() => supabase
      .from('employees')
      .update({ is_active: isActive })
      .eq('id', id)
      .select(EMPLOYEE_COLUMNS)
      .single())
    return applyResult(response, 'status')
  }

  /** Sustituye una ficha de la lista (por ejemplo, tras una baja con fecha). */
  function replaceEmployee(employee) {
    if (employee) employees.value = upsertEmployee(employees.value, employee)
  }

  return {
    employees,
    status,
    loadError,
    refresh,
    createEmployee,
    updateEmployee,
    setEmployeeActive,
    replaceEmployee,
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
