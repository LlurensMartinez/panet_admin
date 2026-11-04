<script setup>
// Pedidos: agenda (atrasados, hoy y los próximos 14 días) e historial.
//
// - La agenda se calcula en el navegador (buildAgenda) a partir de los
//   proveedores, los pedidos guardados y los festivos. Abrir o recargar la
//   página no escribe nada en la base de datos.
// - Solo se guarda un pedido cuando la encargada actúa: marcar preparado,
//   «no se pide», editar fechas o notas, o crear un pedido a mano.
// - Los festivos solo generan avisos.
//
// El acceso a la página lo controla app/middleware/auth.global.js (sesión +
// cuenta autorizada). Los datos los protege la RLS de Supabase.
useHead({ title: 'Pedidos · Panet Admin' })

const toast = useToast()
const route = useRoute()
const router = useRouter()

// «Hoy» en la zona de la tienda. Se actualiza si la página sigue abierta al
// cambiar de día (al volver a la pestaña o cada minuto): la agenda se
// recalcula sin crear nada.
const today = ref(getTodayDate())
function syncToday() {
  const now = getTodayDate()
  if (now !== today.value) today.value = now
}
let todayTimer
function onVisibility() {
  if (document.visibilityState === 'visible') syncToday()
}
onMounted(() => {
  todayTimer = setInterval(syncToday, 60_000)
  document.addEventListener('visibilitychange', onVisibility)
})
onBeforeUnmount(() => {
  clearInterval(todayTimer)
  document.removeEventListener('visibilitychange', onVisibility)
})

const {
  suppliers,
  status: suppliersStatus,
  loadError: suppliersError,
  refresh: refreshSuppliers,
} = useSuppliers()
const {
  holidays,
  loadError: holidaysError,
  status: holidaysStatus,
  refresh: refreshHolidays,
} = useHolidays()
// Festivos oficiales del municipio de la tienda: se actualizan solos al abrir
// la agenda, como mucho una vez al día (nunca crean ni cambian pedidos).
const { settingsStatus: shopSettingsStatus, sync: syncOfficialHolidays } = useOfficialHolidays()
let officialChecked = false
watch(shopSettingsStatus, async (value) => {
  if (value !== 'success' || officialChecked || !import.meta.client) return
  officialChecked = true
  const result = await syncOfficialHolidays({ today: today.value })
  if (result.ok && result.plan && hasPlanChanges(result.plan)) refreshHolidays()
}, { immediate: true })

const {
  orders,
  status,
  loadError,
  refresh,
  setStatus,
  saveDetails,
  createManualOrder,
  deleteOrder,
} = useOrders(today)

// ------------------------------------------------------------------- Vista
const VIEWS = [
  { value: 'agenda', label: 'Agenda' },
  { value: 'history', label: 'Historial' },
]
const viewName = useId()
const view = ref(route.query.vista === 'historial' ? 'history' : 'agenda')
watch(view, (value) => {
  router.replace({ query: { ...route.query, vista: value === 'history' ? 'historial' : undefined } })
})

// ------------------------------------------------------------------ Agenda
const suppliersLoaded = computed(() => suppliersStatus.value === 'success' || suppliers.value.length > 0)
const ordersLoaded = computed(() => status.value === 'success' || orders.value.length > 0)
const agendaError = computed(() => {
  if (loadError.value && !orders.value.length) return loadError.value
  if (suppliersError.value && !suppliers.value.length) return suppliersError.value
  return null
})
const agendaLoading = computed(() => !agendaError.value && (!ordersLoaded.value || !suppliersLoaded.value))
const agenda = computed(() => buildAgenda({
  suppliers: suppliers.value,
  orders: orders.value,
  holidays: holidays.value,
  today: today.value,
}))
const hasSchedules = computed(() => suppliers.value.some(hasScheduledDeliveries))
const holidaysUnavailable = computed(() => Boolean(holidaysError.value) && holidaysStatus.value !== 'pending')

function retry() {
  refresh()
  if (suppliersError.value) refreshSuppliers()
  if (holidaysError.value) refreshHolidays()
}

// --------------------------------------------------------------- Historial
const filters = reactive({ supplierId: undefined, from: '', to: '' })
const page = ref(0)
const historyEnabled = computed(() => view.value === 'history')
const rangeError = computed(() => validateDateRange(filters))
const {
  history,
  status: historyStatus,
  loadError: historyError,
  refresh: refreshHistory,
  replaceRow,
} = useOrderHistory(filters, page, historyEnabled)

watch(() => [filters.supplierId, filters.from, filters.to], () => {
  page.value = 0
})
// Página que ha dejado de existir (por ejemplo, tras eliminar): primera página.
watch(history, (value) => {
  if (value?.outOfRange && page.value > 0) page.value = 0
})

function clearFilters() {
  filters.supplierId = undefined
  filters.from = ''
  filters.to = ''
}

// ---------------------------------------------------------------- Avisos
function reloadPage() {
  reloadNuxtApp({ path: route.fullPath, force: true })
}

function showError(feedback) {
  toast.add({
    title: feedback.message,
    color: feedback.conflict ? 'warning' : 'error',
    icon: feedback.conflict ? 'i-lucide-refresh-cw' : 'i-lucide-circle-alert',
    actions: feedback.kind === DB_ERROR_KIND.EXPIRED
      ? [{ label: 'Volver a iniciar sesión', color: 'neutral', variant: 'outline', onClick: reloadPage }]
      : undefined,
  })
  if (feedback.conflict && view.value === 'history') refreshHistory()
}

const highlightedKey = ref(null)
let highlightTimer
function highlight(key) {
  clearTimeout(highlightTimer)
  highlightedKey.value = key
  highlightTimer = setTimeout(() => {
    highlightedKey.value = null
  }, 2400)
}
onBeforeUnmount(() => clearTimeout(highlightTimer))

function keyOf(item) {
  return item.key ?? `order:${item.id}`
}

function describeItem(order) {
  return `${getOrderSupplierName(order)} · entrega ${formatShortDate(order.delivery_date, today.value)}`
}

function afterChange(order) {
  highlight(`order:${order.id}`)
  if (view.value === 'history') replaceRow(order)
}

// ---------------------------------------------------------------- Estados
const pendingKeys = ref([])

const STATUS_TOASTS = {
  [ORDER_STATUS.PREPARED]: { title: 'Pedido preparado', icon: 'i-lucide-circle-check' },
  [ORDER_STATUS.SKIPPED]: { title: 'Marcado como «no se pide»', icon: 'i-lucide-ban' },
  [ORDER_STATUS.PENDING]: { title: 'El pedido vuelve a estar pendiente', icon: 'i-lucide-undo-2' },
}

async function changeStatus(item, nextStatus, { undo = true } = {}) {
  const key = keyOf(item)
  if (pendingKeys.value.includes(key)) return
  pendingKeys.value = [...pendingKeys.value, key]
  const previous = item.status

  try {
    const result = await setStatus(item, nextStatus)
    if (!result.ok) {
      showError(result)
      return
    }
    afterChange(result.order)
    toast.add({
      ...STATUS_TOASTS[nextStatus],
      description: describeItem(result.order),
      color: 'success',
      actions: undo
        ? [{
            label: 'Deshacer',
            color: 'neutral',
            variant: 'outline',
            onClick: () => changeStatus({ ...result.order, isForecast: false }, previous, { undo: false }),
          }]
        : undefined,
    })
  }
  finally {
    pendingKeys.value = pendingKeys.value.filter(k => k !== key)
  }
}

// ------------------------------------------------- Alta y edición
const formOpen = ref(false)
const editingItem = ref(null)

function openCreate() {
  editingItem.value = null
  formOpen.value = true
}

function openEdit(item) {
  editingItem.value = item
  formOpen.value = true
}

async function submitForm(values) {
  const result = editingItem.value
    ? await saveDetails(editingItem.value, values)
    : await createManualOrder(values)
  // Conflicto sin error de campo: se cierra el formulario y se avisa.
  if (!result.ok && result.conflict && !result.fields?.length) showError(result)
  return result
}

function onSaved(order) {
  const created = !editingItem.value
  afterChange(order)
  if (created && view.value === 'history') refreshHistory()
  toast.add({
    title: created ? 'Pedido creado' : 'Cambios guardados',
    description: describeItem(order),
    color: 'success',
    icon: 'i-lucide-circle-check',
  })
}

// --------------------------------------------------------------- Eliminar
const confirmOpen = ref(false)
const itemToDelete = ref(null)

function askDelete(item) {
  itemToDelete.value = item
  confirmOpen.value = true
}

const deleteDescription = computed(() => {
  const item = itemToDelete.value
  if (!item) return ''
  return item.scheduled_delivery_date
    ? 'Se borran las fechas y notas guardadas. La previsión del calendario volverá a aparecer en la agenda.'
    : 'El pedido desaparecerá de la agenda y del historial.'
})

async function confirmDelete() {
  const item = itemToDelete.value
  if (!item) return
  const key = keyOf(item)
  if (pendingKeys.value.includes(key)) return
  pendingKeys.value = [...pendingKeys.value, key]
  try {
    const result = await deleteOrder(item.id)
    if (!result.ok) {
      showError(result)
      if (result.conflict) confirmOpen.value = false
      return
    }
    confirmOpen.value = false
    if (view.value === 'history') refreshHistory()
    toast.add({
      title: 'Pedido eliminado',
      description: describeItem(item),
      color: 'success',
      icon: 'i-lucide-trash-2',
    })
  }
  finally {
    pendingKeys.value = pendingKeys.value.filter(k => k !== key)
  }
}

const deletePending = computed(() => Boolean(itemToDelete.value && pendingKeys.value.includes(keyOf(itemToDelete.value))))

const actions = {
  prepare: item => changeStatus(item, ORDER_STATUS.PREPARED),
  reopen: item => changeStatus(item, ORDER_STATUS.PENDING),
  skip: item => changeStatus(item, ORDER_STATUS.SKIPPED),
  edit: openEdit,
  delete: askDelete,
}
</script>

<template>
  <div class="space-y-8">
    <PageHeader
      title="Pedidos"
      description="Qué pedidos toca preparar según los días de entrega de cada proveedor, y su historial."
    >
      <template #actions>
        <UButton
          label="Nuevo pedido"
          icon="i-lucide-plus"
          size="lg"
          :disabled="!suppliersLoaded"
          @click="openCreate"
        />
      </template>
    </PageHeader>

    <OrderSectionNav />

    <div class="space-y-6">
      <fieldset class="min-w-0">
        <legend class="sr-only">
          Ver
        </legend>
        <div class="grid grid-cols-2 rounded-lg bg-elevated p-1 sm:inline-grid">
          <label
            v-for="option in VIEWS"
            :key="option.value"
            class="relative cursor-pointer"
          >
            <input
              v-model="view"
              type="radio"
              class="peer sr-only"
              :name="viewName"
              :value="option.value"
            >
            <span class="flex h-9 items-center justify-center whitespace-nowrap rounded-md px-5 text-sm font-medium text-muted transition-colors hover:text-highlighted peer-checked:bg-default peer-checked:text-highlighted peer-checked:shadow-xs peer-checked:ring peer-checked:ring-default peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary">
              {{ option.label }}
            </span>
          </label>
        </div>
      </fieldset>

      <!-- ============================================================ Agenda -->
      <section
        v-if="view === 'agenda'"
        aria-label="Agenda de pedidos"
        class="space-y-4"
      >
        <div
          v-if="agendaError"
          class="rounded-xl bg-default shadow-xs ring ring-default"
        >
          <EmptyState
            tone="error"
            icon="i-lucide-cloud-off"
            title="No se ha podido cargar la agenda"
            :description="agendaError.message"
          >
            <UButton
              v-if="agendaError.kind === DB_ERROR_KIND.EXPIRED"
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
              @click="retry"
            />
          </EmptyState>
        </div>

        <div
          v-else-if="agendaLoading"
          class="space-y-4"
          aria-busy="true"
          aria-label="Cargando la agenda"
        >
          <div
            v-for="n in 2"
            :key="n"
            class="space-y-3 rounded-xl bg-default p-5 shadow-xs ring ring-default"
          >
            <USkeleton class="h-4 w-40" />
            <USkeleton class="h-3 w-56 max-w-[80%]" />
            <USkeleton class="h-10 w-full sm:w-44" />
          </div>
        </div>

        <template v-else>
          <UAlert
            v-if="holidaysUnavailable"
            color="warning"
            variant="subtle"
            icon="i-lucide-calendar-x-2"
            title="No se han podido cargar los festivos"
            description="La agenda no puede avisar de entregas en festivo hasta que se carguen."
            :actions="[{ label: 'Reintentar', color: 'warning', variant: 'outline', onClick: () => refreshHolidays() }]"
          />

          <UAlert
            v-if="!hasSchedules"
            color="neutral"
            variant="subtle"
            icon="i-lucide-truck"
            title="Ningún proveedor activo tiene días fijos de entrega"
            description="La agenda prevé los pedidos a partir de los días de entrega de cada proveedor. Mientras tanto, puedes crear pedidos a mano."
            :actions="[{ label: 'Ir a Proveedores', color: 'neutral', variant: 'outline', to: '/pedidos/proveedores' }]"
          />

          <OrderAgenda
            :agenda="agenda"
            :today="today"
            :pending-keys="pendingKeys"
            :highlighted-key="highlightedKey"
            v-on="actions"
          />
        </template>
      </section>

      <!-- ========================================================= Historial -->
      <section
        v-else
        aria-label="Historial de pedidos"
      >
        <OrderHistory
          v-model:supplier-id="filters.supplierId"
          v-model:from="filters.from"
          v-model:to="filters.to"
          v-model:page="page"
          :rows="history?.rows ?? []"
          :total="history?.total ?? 0"
          :loaded-page="history?.page ?? 0"
          :holidays="holidays"
          :suppliers="suppliers"
          :today="today"
          :loading="historyStatus === 'pending' || Boolean(history?.skipped && !rangeError)"
          :load-error="historyError"
          :range-error="rangeError"
          :pending-keys="pendingKeys"
          :highlighted-key="highlightedKey"
          v-on="actions"
          @retry="refreshHistory()"
          @clear="clearFilters"
          @login="reloadPage"
        />
      </section>
    </div>

    <OrderFormModal
      v-model:open="formOpen"
      :item="editingItem"
      :suppliers="suppliers"
      :orders="orders"
      :holidays="holidays"
      :today="today"
      :submit="submitForm"
      @saved="onSaved"
    />

    <ConfirmModal
      v-model:open="confirmOpen"
      :title="itemToDelete ? `¿Eliminar el pedido de ${getOrderSupplierName(itemToDelete)}?` : '¿Eliminar el pedido?'"
      :description="deleteDescription"
      confirm-label="Eliminar"
      confirm-icon="i-lucide-trash-2"
      confirm-color="error"
      :pending="deletePending"
      @confirm="confirmDelete"
    />
  </div>
</template>
