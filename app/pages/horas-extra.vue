<script setup>
// Horas extra: registro, consulta con filtros y total, edición y eliminación.
// Eliminar un registro solo borra esa fila de overtime_entries; nunca toca la
// ficha del empleado.
//
// El acceso a la página lo controla app/middleware/auth.global.js (sesión +
// cuenta autorizada). Los datos los protege la RLS de Supabase.
useHead({ title: 'Horas extra · Panet Admin' })

const toast = useToast()
const {
  entries,
  status,
  loadError,
  refresh,
  createEntry,
  updateEntry,
  deleteEntry,
} = useOvertime()
const {
  employees,
  status: employeesStatus,
  loadError: employeesError,
  refresh: refreshEmployees,
} = useEmployees()

// ------------------------------------------------------------------ Estado
const hasLoaded = computed(() => status.value === 'success' || entries.value.length > 0)
const employeesLoaded = computed(() => employeesStatus.value === 'success' || employees.value.length > 0)
const pageError = computed(() => {
  if (loadError.value && !entries.value.length) return loadError.value
  if (employeesError.value && !employees.value.length) return employeesError.value
  return null
})
const isInitialLoading = computed(() => !pageError.value && (!hasLoaded.value || !employeesLoaded.value))

function retry() {
  refresh()
  if (employeesError.value) refreshEmployees()
}

// ------------------------------------------------------------- Pestañas
const TABS = [
  { label: 'Registros', icon: 'i-lucide-list', value: 'records', slot: 'records' },
  // En pantallas estrechas se muestra solo «Resumen» para que no se corte.
  { label: 'Resumen', labelDetail: 'por empleado', icon: 'i-lucide-users-round', value: 'summary', slot: 'summary' },
]
const activeTab = ref('records')

// «Hoy» en la zona horaria de la tienda; se actualiza al abrir el resumen.
const today = ref(getTodayDate())
watch(activeTab, (tab) => {
  if (tab === 'summary') today.value = getTodayDate()
})

// ------------------------------------------------------ Resumen por empleado
// Periodo propio del resumen (semana o mes que contiene `summaryAnchor`). No
// lo cambian los filtros del listado.
const summaryView = ref(OVERTIME_PERIOD.WEEK)
const summaryAnchor = ref(today.value)

// «Ver registros» desde el resumen: lleva al listado con ese empleado y ese
// periodo (si coincide con un periodo rápido, se marca; si no, Personalizado).
async function showRecordsFor({ employeeId, from, to }) {
  filters.employeeId = employeeId
  filters.from = from
  filters.to = to
  filters.period = detectOvertimePeriod({ from, to }, getTodayDate())
  activeTab.value = 'records'
  await nextTick()
  await nextTick()
  listRegion.value?.focus()
}

// ----------------------------------------------------------------- Filtros
// period: periodo rápido elegido (OVERTIME_PERIOD) o null = todas las fechas.
// El listado se filtra siempre por from/to, que el periodo rellena.
const filters = reactive({ employeeId: undefined, period: null, from: '', to: '' })
const rangeError = computed(() => validateDateRange(filters))
const hasFilters = computed(() => Boolean(filters.employeeId || filters.period || filters.from || filters.to))

const visibleEntries = computed(() => rangeError.value
  ? []
  : filterOvertimeEntries(entries.value, filters))
const totalMinutes = computed(() => sumDurationMinutes(visibleEntries.value))

const filterEmployeeName = computed(() => {
  const employee = employees.value.find(e => e.id === filters.employeeId)
  return employee ? getEmployeeFullName(employee) : ''
})
const scopeText = computed(() => describeOvertimeFilters({ employeeName: filterEmployeeName.value, ...filters }))

function clearFilters() {
  filters.employeeId = undefined
  filters.period = null
  filters.from = ''
  filters.to = ''
}

const emptyState = computed(() => {
  if (rangeError.value) {
    return {
      icon: 'i-lucide-calendar-x',
      title: 'El periodo no es válido',
      description: 'Corrige las fechas «Desde» y «Hasta», o limpia los filtros.',
      action: 'clear',
    }
  }
  if (!entries.value.length) {
    return {
      icon: 'i-lucide-clock',
      title: 'Todavía no hay horas extra registradas',
      description: 'Registra la primera para empezar a llevar el control del personal.',
      action: 'create',
    }
  }
  return {
    icon: 'i-lucide-search-x',
    title: 'No hay registros con estos filtros',
    description: `${scopeText.value}. Prueba con otro periodo u otro empleado.`,
    action: 'clear',
  }
})

// Aviso si falla una recarga cuando ya se ve la lista.
watch(loadError, (error) => {
  if (error && entries.value.length) {
    toast.add({ title: 'No se ha podido actualizar la lista', description: error.message, color: 'error', icon: 'i-lucide-circle-alert' })
  }
})

// Recarga completa: el middleware vuelve a comprobar la sesión en el
// servidor y, si ha caducado, lleva al inicio de sesión.
function reloadPage() {
  reloadNuxtApp({ path: '/horas-extra', force: true })
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

// Resalta durante un momento el registro creado o modificado.
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
const editingEntry = ref(null)

function openCreate() {
  editingEntry.value = null
  formOpen.value = true
}

function openEdit(entry) {
  editingEntry.value = entry
  formOpen.value = true
}

function submitForm(values) {
  return editingEntry.value
    ? updateEntry(editingEntry.value.id, values)
    : createEntry(values)
}

function onSaved(entry) {
  const created = !editingEntry.value
  const hiddenByFilters = !filterOvertimeEntries([entry], filters).length || Boolean(rangeError.value)
  const what = `${formatDuration(entry.duration_minutes)} de ${getEntryEmployeeName(entry)}, ${formatWorkDate(entry.work_date, 'compact')}.`

  highlight(entry.id)
  toast.add({
    title: created ? 'Horas extra registradas' : 'Registro actualizado',
    description: hiddenByFilters ? `${what} No se ve con los filtros actuales.` : what,
    color: 'success',
    icon: 'i-lucide-circle-check',
    actions: hiddenByFilters
      ? [{ label: 'Limpiar filtros', color: 'neutral', variant: 'outline', onClick: clearFilters }]
      : undefined,
  })
}

// ------------------------------------------------------------- Eliminación
const pendingIds = ref([])
const deleteOpen = ref(false)
const entryToDelete = ref(null)
const listRegion = useTemplateRef('listRegion')

const deleteDescription = computed(() => {
  const entry = entryToDelete.value
  if (!entry) return ''
  return `Se eliminará el registro de ${formatDuration(entry.duration_minutes)} de ${getEntryEmployeeName(entry)} del ${formatWorkDate(entry.work_date, 'long')}${entry.reason ? ` (${entry.reason})` : ''}. La ficha del empleado no cambia. Esta acción no se puede deshacer.`
})
const deletePending = computed(() => Boolean(entryToDelete.value && pendingIds.value.includes(entryToDelete.value.id)))

function askDelete(entry) {
  entryToDelete.value = entry
  deleteOpen.value = true
}

async function confirmDelete() {
  const entry = entryToDelete.value
  if (!entry || pendingIds.value.includes(entry.id)) return
  pendingIds.value = [...pendingIds.value, entry.id]

  try {
    const result = await deleteEntry(entry.id)
    if (!result.ok) {
      showError(result)
      return
    }
    deleteOpen.value = false
    toast.add({
      title: 'Registro eliminado',
      description: `${formatDuration(entry.duration_minutes)} de ${getEntryEmployeeName(entry)}, ${formatWorkDate(entry.work_date, 'compact')}.`,
      color: 'success',
      icon: 'i-lucide-trash-2',
    })
    // La fila desaparece: el foco vuelve al listado.
    nextTick(() => listRegion.value?.focus())
  }
  finally {
    pendingIds.value = pendingIds.value.filter(id => id !== entry.id)
  }
}
</script>

<template>
  <div class="space-y-8">
    <PageHeader
      title="Horas extra"
      description="Registro manual de las horas extra del personal. La duración se guarda en minutos exactos."
    >
      <template #actions>
        <UButton
          label="Registrar horas extra"
          icon="i-lucide-plus"
          size="lg"
          :disabled="!hasLoaded || !employeesLoaded"
          @click="openCreate"
        />
      </template>
    </PageHeader>

    <!-- Dos vistas con responsabilidades separadas: el listado (con sus
         filtros) y el resumen por empleado (con su propio periodo). -->
    <UTabs
      v-model="activeTab"
      :items="TABS"
      variant="link"
      :ui="{ root: 'gap-6', list: 'border-b border-default', trigger: 'pb-3' }"
    >
      <template #default="{ item }">
        {{ item.label }}<span
          v-if="item.labelDetail"
          class="hidden sm:inline"
        >&nbsp;{{ item.labelDetail }}</span>
      </template>

      <template #records>
        <section
          ref="listRegion"
          aria-labelledby="overtime-list-title"
          tabindex="-1"
          class="space-y-4 focus:outline-none"
        >
          <h2
            id="overtime-list-title"
            class="sr-only"
          >
            Registros de horas extra
          </h2>

          <OvertimeFilters
            v-model:employee-id="filters.employeeId"
            v-model:period="filters.period"
            v-model:from="filters.from"
            v-model:to="filters.to"
            :employees="employees"
            :range-error="rangeError"
            :disabled="Boolean(pageError)"
            @clear="clearFilters"
          />

          <OvertimeList
            v-if="!pageError"
            :entries="visibleEntries"
            :loading="isInitialLoading"
            :pending-ids="pendingIds"
            :highlighted-id="highlightedId"
            @edit="openEdit"
            @delete="askDelete"
          >
            <template #summary>
              <OvertimeSummary
                v-if="isInitialLoading || entries.length"
                :total-minutes="totalMinutes"
                :count="visibleEntries.length"
                :scope="rangeError ? 'Periodo no válido' : scopeText"
                :loading="isInitialLoading"
              />
            </template>

            <template #empty>
              <EmptyState
                :icon="emptyState.icon"
                :title="emptyState.title"
                :description="emptyState.description"
              >
                <UButton
                  v-if="emptyState.action === 'create'"
                  label="Registrar horas extra"
                  icon="i-lucide-plus"
                  @click="openCreate"
                />
                <UButton
                  v-else-if="hasFilters"
                  label="Limpiar filtros"
                  icon="i-lucide-filter-x"
                  color="neutral"
                  variant="outline"
                  @click="clearFilters"
                />
              </EmptyState>
            </template>
          </OvertimeList>
        </section>
      </template>

      <template #summary>
        <OvertimeEmployeeSummary
          v-if="!pageError"
          v-model:view="summaryView"
          v-model:anchor="summaryAnchor"
          :entries="entries"
          :employees="employees"
          :today="today"
          :loading="isInitialLoading"
          @view-records="showRecordsFor"
        />
      </template>
    </UTabs>

    <!-- Error al cargar (sin datos que mostrar), en cualquiera de las dos vistas -->
    <div
      v-if="pageError"
      class="rounded-xl bg-default shadow-xs ring ring-default"
    >
      <EmptyState
        tone="error"
        icon="i-lucide-cloud-off"
        title="No se han podido cargar los registros"
        :description="pageError.message"
      >
        <UButton
          v-if="pageError.kind === DB_ERROR_KIND.EXPIRED"
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
          :loading="status === 'pending' || employeesStatus === 'pending'"
          @click="retry"
        />
      </EmptyState>
    </div>

    <OvertimeFormModal
      v-model:open="formOpen"
      :entry="editingEntry"
      :employees="employees"
      :submit="submitForm"
      @saved="onSaved"
    />

    <ConfirmModal
      v-model:open="deleteOpen"
      title="¿Eliminar este registro?"
      :description="deleteDescription"
      confirm-label="Eliminar"
      confirm-icon="i-lucide-trash-2"
      confirm-color="error"
      :pending="deletePending"
      @confirm="confirmDelete"
    />
  </div>
</template>
