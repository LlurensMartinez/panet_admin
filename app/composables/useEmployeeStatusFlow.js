/**
 * Flujo de desactivar y activar una empleada, compartido por el listado
 * (/empleados) y la ficha (/empleados/[id]) para que los dos usen
 * exactamente la misma lógica.
 *
 * Con la migración de horarios, la baja pide el último día de trabajo y
 * enseña qué planificación futura se eliminará:
 *   - con planificación (horarios, cambios o ausencias): public.deactivate_employee
 *     y public.reactivate_employee, cada una en una sola transacción;
 *   - sin planificación: una sola actualización de `employees`, como antes;
 *   - sin la migración: exactamente como antes (sin fecha).
 *
 * @param {object} deps
 * @param {Function} deps.setEmployeeActive de useEmployees
 * @param {Function} deps.replaceEmployee de useEmployees
 * @param {Function} deps.refresh de useEmployees
 * @param {Function} deps.showError muestra un error ({ kind, message })
 * @param {(employee: object, isActive: boolean) => void} [deps.onChanged]
 *   después de un cambio de estado correcto (resaltar, mover el foco…)
 */
export function useEmployeeStatusFlow({ setEmployeeActive, replaceEmployee, refresh, showError, onChanged = () => {} }) {
  const toast = useToast()
  const { loadLeaveContext, deactivateEmployee, reactivateEmployee, setStatusWithoutPlanning } = useEmployeeLeave()

  const pendingIds = ref([])
  const confirmOpen = ref(false)
  const employeeToDeactivate = ref(null)
  const deactivateContext = ref({ status: 'idle', data: null, message: '' })

  const reactivateOpen = ref(false)
  const employeeToReactivate = ref(null)
  const reactivateContext = ref(null)

  function setPending(id, value) {
    pendingIds.value = value
      ? [...pendingIds.value, id]
      : pendingIds.value.filter(pendingId => pendingId !== id)
  }

  const isPending = id => pendingIds.value.includes(id)

  function notifyStatus(employee, isActive, description) {
    const name = getEmployeeFullName(employee)
    toast.add({
      title: isActive ? `Se ha activado a ${name}` : `Se ha desactivado a ${name}`,
      description,
      color: 'success',
      icon: isActive ? 'i-lucide-circle-play' : 'i-lucide-circle-pause',
    })
  }

  function applyLeaveResult(result) {
    if (result.employee) replaceEmployee(result.employee)
    else refresh()
  }

  // ---------------------------------------------------------- Desactivar

  async function loadDeactivateContext(employee) {
    if (!employee) return
    deactivateContext.value = { status: 'loading', data: null, message: '' }
    const context = await loadLeaveContext(employee.id)
    // El diálogo puede haberse cerrado o abierto para otra empleada.
    if (employeeToDeactivate.value?.id !== employee.id) return
    deactivateContext.value = context.ok
      ? { status: 'ready', data: context, message: '' }
      : { status: 'error', data: null, message: context.message }
  }

  // Comportamiento anterior (migración de horarios sin aplicar).
  async function changeActive(employee, isActive) {
    if (isPending(employee.id)) return false
    setPending(employee.id, true)
    try {
      const result = await setEmployeeActive(employee.id, isActive)
      if (!result.ok) {
        showError(result)
        return false
      }
      notifyStatus(employee, isActive, isActive ? undefined : 'Su ficha y su historial se conservan en «Inactivos».')
      onChanged(result.employee ?? employee, isActive)
      return true
    }
    finally {
      setPending(employee.id, false)
    }
  }

  async function confirmDeactivate({ lastWorkingDate }) {
    const employee = employeeToDeactivate.value
    const context = deactivateContext.value.data
    if (!employee || !context || isPending(employee.id)) return false

    if (!context.available) {
      const done = await changeActive(employee, false)
      if (done) confirmOpen.value = false
      return done
    }

    setPending(employee.id, true)
    try {
      const result = hasPlanning(context)
        ? await deactivateEmployee(employee.id, lastWorkingDate)
        : await setStatusWithoutPlanning(employee.id, false, lastWorkingDate)
      if (!result.ok) {
        showError(result)
        // Si su planificación ha cambiado entretanto, se vuelve a comprobar.
        if (['PS007', 'PS009'].includes(result.code)) loadDeactivateContext(employee)
        return false
      }
      applyLeaveResult(result)
      notifyStatus(employee, false, result.result
        ? describeDeactivationResult(result.result)
        : `Último día: ${formatLeaveDate(lastWorkingDate)}. Su ficha y su historial se conservan en «Inactivos».`)
      confirmOpen.value = false
      onChanged(result.employee ?? employee, false)
      return true
    }
    finally {
      setPending(employee.id, false)
    }
  }

  // ------------------------------------------------------------- Activar

  async function startReactivation(employee) {
    if (isPending(employee.id)) return
    setPending(employee.id, true)
    let context
    try {
      context = await loadLeaveContext(employee.id, { withLastWorkingDate: true })
    }
    finally {
      setPending(employee.id, false)
    }

    if (!context.ok) {
      showError(context)
      return
    }
    if (!context.available) {
      await changeActive(employee, true)
      return
    }
    // Con horario habitual: se pregunta la fecha de vuelta y si se copia.
    if (hasWeeklySchedule(context.versions)) {
      employeeToReactivate.value = employee
      reactivateContext.value = context
      reactivateOpen.value = true
      return
    }

    // Sin horario: se activa directamente, como antes.
    setPending(employee.id, true)
    try {
      const result = await setStatusWithoutPlanning(employee.id, true)
      if (!result.ok) {
        showError(result)
        return
      }
      applyLeaveResult(result)
      notifyStatus(employee, true)
      onChanged(result.employee ?? employee, true)
    }
    finally {
      setPending(employee.id, false)
    }
  }

  async function confirmReactivate({ returnDate, copySchedule }) {
    const employee = employeeToReactivate.value
    if (!employee || isPending(employee.id)) return
    setPending(employee.id, true)
    try {
      const result = await reactivateEmployee(employee.id, returnDate, copySchedule)
      if (!result.ok) {
        showError(result)
        return
      }
      applyLeaveResult(result)
      const outcome = result.result?.restored_previous_schedule
        ? 'Se ha anulado la baja: sigue con su horario de antes.'
        : result.result?.copied_schedule
          ? `Desde el ${formatLeaveDate(returnDate)} tiene su último horario habitual.`
          : 'Todavía no tiene horario desde su vuelta.'
      notifyStatus(employee, true, outcome)
      reactivateOpen.value = false
      onChanged(result.employee ?? employee, true)
    }
    finally {
      setPending(employee.id, false)
    }
  }

  /** Desactivar (abre el diálogo) o activar, según el estado actual. */
  function toggleActive(employee) {
    if (employee.is_active) {
      employeeToDeactivate.value = employee
      confirmOpen.value = true
      loadDeactivateContext(employee)
      return
    }
    startReactivation(employee)
  }

  const deactivatePending = computed(() => Boolean(employeeToDeactivate.value && isPending(employeeToDeactivate.value.id)))
  const reactivatePending = computed(() => Boolean(employeeToReactivate.value && isPending(employeeToReactivate.value.id)))

  return {
    pendingIds,
    isPending,
    toggleActive,
    // Diálogo de baja
    confirmOpen,
    employeeToDeactivate,
    deactivateContext,
    deactivatePending,
    loadDeactivateContext,
    confirmDeactivate,
    // Diálogo de reactivación
    reactivateOpen,
    employeeToReactivate,
    reactivateContext,
    reactivatePending,
    confirmReactivate,
  }
}
