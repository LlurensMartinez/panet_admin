<script setup>
// Gestión de empleados: listado, búsqueda, filtro por estado, alta, edición y
// activación/desactivación. No hay borrado: las fichas se desactivan para
// conservar su historial.
//
// El acceso a la página lo controla app/middleware/auth.global.js (sesión +
// cuenta autorizada). Los datos los protege la RLS de Supabase.
useHead({ title: 'Empleados · Panet Admin' })

const toast = useToast()
const {
  employees,
  status,
  loadError,
  refresh,
  createEmployee,
  updateEmployee,
  setEmployeeActive,
} = useEmployees()

// ------------------------------------------------------------------ Listado
const statusFilter = ref(EMPLOYEE_STATUS_FILTER.ACTIVE)
const search = ref('')
const listRegion = useTemplateRef('listRegion')

const hasLoaded = computed(() => status.value === 'success' || employees.value.length > 0)
const isInitialLoading = computed(() => !hasLoaded.value && !loadError.value)
const counts = computed(() => countEmployees(employees.value))
const visibleEmployees = computed(() => filterEmployees(employees.value, {
  status: statusFilter.value,
  query: search.value,
}))
const searchQuery = computed(() => search.value.trim())

// Coincidencias de la búsqueda que el filtro de estado está ocultando.
const hiddenMatches = computed(() => {
  if (!searchQuery.value || statusFilter.value === EMPLOYEE_STATUS_FILTER.ALL) return 0
  return filterEmployees(employees.value, { status: EMPLOYEE_STATUS_FILTER.ALL, query: search.value }).length
    - visibleEmployees.value.length
})

const resultsSummary = computed(() => {
  const n = visibleEmployees.value.length
  if (searchQuery.value) {
    return n === 1 ? '1 resultado' : `${n} resultados`
  }
  const noun = n === 1 ? 'empleado' : 'empleados'
  if (statusFilter.value === EMPLOYEE_STATUS_FILTER.ACTIVE) return `${n} ${noun} ${n === 1 ? 'activo' : 'activos'}`
  if (statusFilter.value === EMPLOYEE_STATUS_FILTER.INACTIVE) return `${n} ${noun} ${n === 1 ? 'inactivo' : 'inactivos'}`
  return `${n} ${noun}`
})

const emptyState = computed(() => {
  if (counts.value.all === 0) {
    return {
      icon: 'i-lucide-users-round',
      title: 'Todavía no hay empleados',
      description: 'Añade las fichas del personal de la tienda para poder registrar después sus horas extra.',
      action: 'create',
    }
  }
  if (searchQuery.value) {
    return {
      icon: 'i-lucide-search-x',
      title: `Ningún resultado para «${searchQuery.value}»`,
      description: hiddenMatches.value > 0
        ? `Hay ${hiddenMatches.value === 1 ? '1 coincidencia' : `${hiddenMatches.value} coincidencias`} en otro estado.`
        : 'Revisa cómo está escrito o busca por otra parte del nombre o los apellidos.',
      action: 'clear-search',
    }
  }
  if (statusFilter.value === EMPLOYEE_STATUS_FILTER.INACTIVE) {
    return {
      icon: 'i-lucide-archive',
      title: 'No hay empleados inactivos',
      description: 'Cuando desactives una ficha, aparecerá aquí con todo su historial.',
      action: 'show-active',
    }
  }
  return {
    icon: 'i-lucide-user-round-x',
    title: 'No hay empleados activos',
    description: 'Todas las fichas están desactivadas. Puedes activarlas desde «Inactivos».',
    action: 'show-inactive',
  }
})

function clearSearch() {
  search.value = ''
}

// Aviso si falla una recarga cuando ya se ve la lista.
watch(loadError, (error) => {
  if (error && employees.value.length) {
    toast.add({
      title: 'No se ha podido actualizar la lista',
      description: error.message,
      color: 'error',
      icon: 'i-lucide-circle-alert',
    })
  }
})

// Recarga completa: el middleware vuelve a comprobar la sesión en el
// servidor y, si ha caducado, lleva al inicio de sesión.
function reloadPage() {
  reloadNuxtApp({ path: '/empleados', force: true })
}

function showError(feedback) {
  toast.add({
    title: feedback.message,
    color: 'error',
    icon: 'i-lucide-circle-alert',
    actions: feedback.kind === DB_ERROR_KIND.EXPIRED
      ? [{ label: 'Volver a iniciar sesión', color: 'neutral', variant: 'outline', onClick: reloadPage }]
      : undefined,
  })
}

// Resalta durante un momento la fila creada o modificada.
const highlightedId = ref(null)
let highlightTimer
function highlight(id) {
  clearTimeout(highlightTimer)
  highlightedId.value = id
  highlightTimer = setTimeout(() => {
    highlightedId.value = null
  }, 2400)
}
onBeforeUnmount(() => clearTimeout(highlightTimer))

// --------------------------------------------------------- Alta y edición
const formOpen = ref(false)
const editingEmployee = ref(null)

function openCreate() {
  editingEmployee.value = null
  formOpen.value = true
}

function openEdit(employee) {
  editingEmployee.value = employee
  formOpen.value = true
}

function submitForm(values) {
  return editingEmployee.value
    ? updateEmployee(editingEmployee.value.id, values)
    : createEmployee(values)
}

function onSaved(employee) {
  const created = !editingEmployee.value
  const name = getEmployeeFullName(employee)

  // Que la ficha guardada quede a la vista.
  if (!filterEmployees([employee], { status: statusFilter.value, query: search.value }).length) {
    search.value = ''
    if (!matchesEmployeeStatus(employee, statusFilter.value)) {
      statusFilter.value = EMPLOYEE_STATUS_FILTER.ALL
    }
  }

  highlight(employee.id)
  toast.add({
    title: created ? 'Empleado añadido' : 'Cambios guardados',
    description: created ? `${name} ya aparece en la lista.` : `Se ha actualizado la ficha de ${name}.`,
    color: 'success',
    icon: 'i-lucide-circle-check',
  })
}

// ------------------------------------------------- Activar y desactivar
const pendingIds = ref([])
const confirmOpen = ref(false)
const employeeToDeactivate = ref(null)

function onToggleActive(employee) {
  if (employee.is_active) {
    employeeToDeactivate.value = employee
    confirmOpen.value = true
    return
  }
  changeActive(employee, true)
}

async function changeActive(employee, isActive) {
  if (pendingIds.value.includes(employee.id)) return
  pendingIds.value = [...pendingIds.value, employee.id]

  try {
    const result = await setEmployeeActive(employee.id, isActive)
    const name = getEmployeeFullName(employee)

    if (!result.ok) {
      showError(result)
      return false
    }

    if (isActive) highlight(employee.id)
    toast.add({
      title: isActive ? `Se ha activado a ${name}` : `Se ha desactivado a ${name}`,
      description: isActive ? undefined : 'Su ficha y su historial se conservan en «Inactivos».',
      color: 'success',
      icon: isActive ? 'i-lucide-circle-play' : 'i-lucide-circle-pause',
    })
    return true
  }
  finally {
    pendingIds.value = pendingIds.value.filter(id => id !== employee.id)
  }
}

async function confirmDeactivate() {
  const employee = employeeToDeactivate.value
  if (!employee) return
  const done = await changeActive(employee, false)
  if (done) {
    confirmOpen.value = false
    // La fila puede desaparecer del filtro actual: el foco vuelve al listado.
    nextTick(() => listRegion.value?.focus())
  }
}

const deactivatePending = computed(() =>
  Boolean(employeeToDeactivate.value && pendingIds.value.includes(employeeToDeactivate.value.id)),
)
</script>

<template>
  <div class="space-y-8">
    <PageHeader
      title="Empleados"
      description="Fichas del personal de la tienda. Al desactivar a alguien, su historial se conserva."
    >
      <template #actions>
        <UButton
          label="Añadir empleado"
          icon="i-lucide-plus"
          size="lg"
          :disabled="!hasLoaded"
          @click="openCreate"
        />
      </template>
    </PageHeader>

    <section
      ref="listRegion"
      aria-labelledby="employees-list-title"
      tabindex="-1"
      class="space-y-4 focus:outline-none"
    >
      <h2
        id="employees-list-title"
        class="sr-only"
      >
        Listado de empleados
      </h2>

      <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <EmployeeStatusFilter
          v-model="statusFilter"
          :counts="counts"
          :loading="isInitialLoading"
          :unavailable="Boolean(loadError && !employees.length)"
        />

        <UInput
          v-model="search"
          type="search"
          icon="i-lucide-search"
          placeholder="Buscar por nombre o apellidos"
          aria-label="Buscar por nombre o apellidos"
          autocomplete="off"
          size="lg"
          class="w-full sm:w-80"
          :ui="{ trailing: 'pe-1' }"
          @keydown.esc="clearSearch"
        >
          <template
            v-if="search"
            #trailing
          >
            <UButton
              color="neutral"
              variant="link"
              size="sm"
              icon="i-lucide-x"
              aria-label="Borrar búsqueda"
              @click="clearSearch"
            />
          </template>
        </UInput>
      </div>

      <!-- Error al cargar (sin datos que mostrar) -->
      <div
        v-if="loadError && !employees.length"
        class="rounded-xl bg-default shadow-xs ring ring-default"
      >
        <EmptyState
          tone="error"
          icon="i-lucide-cloud-off"
          title="No se ha podido cargar la lista"
          :description="loadError.message"
        >
          <UButton
            v-if="loadError.kind === DB_ERROR_KIND.EXPIRED"
            label="Volver a iniciar sesión"
            icon="i-lucide-log-in"
            @click="reloadPage"
          />
          <UButton
            v-else
            label="Reintentar"
            icon="i-lucide-refresh-cw"
            color="neutral"
            variant="outline"
            :loading="status === 'pending'"
            @click="refresh()"
          />
        </EmptyState>
      </div>

      <EmployeeList
        v-else
        :employees="visibleEmployees"
        :loading="isInitialLoading"
        :pending-ids="pendingIds"
        :highlighted-id="highlightedId"
        @edit="openEdit"
        @toggle-active="onToggleActive"
      >
        <template #empty>
          <EmptyState
            :icon="emptyState.icon"
            :title="emptyState.title"
            :description="emptyState.description"
          >
            <UButton
              v-if="emptyState.action === 'create'"
              label="Añadir empleado"
              icon="i-lucide-plus"
              @click="openCreate"
            />
            <template v-else-if="emptyState.action === 'clear-search'">
              <UButton
                label="Borrar búsqueda"
                color="neutral"
                variant="outline"
                @click="clearSearch"
              />
              <UButton
                v-if="hiddenMatches > 0"
                label="Ver en todos"
                color="neutral"
                variant="ghost"
                @click="statusFilter = EMPLOYEE_STATUS_FILTER.ALL"
              />
            </template>
            <UButton
              v-else-if="emptyState.action === 'show-active'"
              label="Ver activos"
              color="neutral"
              variant="outline"
              @click="statusFilter = EMPLOYEE_STATUS_FILTER.ACTIVE"
            />
            <UButton
              v-else-if="emptyState.action === 'show-inactive'"
              label="Ver inactivos"
              color="neutral"
              variant="outline"
              @click="statusFilter = EMPLOYEE_STATUS_FILTER.INACTIVE"
            />
          </EmptyState>
        </template>
      </EmployeeList>

      <p
        v-if="hasLoaded && visibleEmployees.length"
        class="px-1 text-sm text-muted"
        aria-live="polite"
      >
        {{ resultsSummary }}
      </p>
      <p
        v-else-if="hasLoaded"
        class="sr-only"
        aria-live="polite"
      >
        {{ emptyState.title }}
      </p>
    </section>

    <EmployeeFormModal
      v-model:open="formOpen"
      :employee="editingEmployee"
      :submit="submitForm"
      @saved="onSaved"
    />

    <EmployeeDeactivateModal
      v-model:open="confirmOpen"
      :employee="employeeToDeactivate"
      :pending="deactivatePending"
      @confirm="confirmDeactivate"
    />
  </div>
</template>
