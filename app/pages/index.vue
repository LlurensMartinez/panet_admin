<script setup>
// Inicio: resumen de los pedidos que toca preparar hoy y mañana, agrupados
// por proveedor y con sus productos habituales activos.
//
// - Solo lectura: abrir o recargar la página no crea, modifica ni borra nada.
//   Los pedidos se gestionan en /pedidos.
// - No duplica la lógica de la agenda: buildHomeSummary() parte de
//   buildAgenda() (previsiones, pedidos manuales, fechas cambiadas, festivos y
//   atrasados de los últimos 7 días).
// - Las cantidades son las habituales de cada producto: orientativas.
//
// El acceso a la página lo controla app/middleware/auth.global.js (sesión +
// cuenta autorizada). Los datos los protege la RLS de Supabase.
useHead({ title: 'Inicio · Panet Admin' })

// «Hoy» en la zona de la tienda; se actualiza si la página sigue abierta al
// cambiar de día (al volver a la pestaña o cada minuto).
const today = ref(getTodayDate())
const greeting = ref(getGreeting())
function syncToday() {
  greeting.value = getGreeting()
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

// Solo se usan las lecturas: ninguna acción de escritura sale de esta página.
const {
  suppliers,
  status: suppliersStatus,
  loadError: suppliersError,
  refresh: refreshSuppliers,
} = useSuppliers()
const {
  holidays,
  status: holidaysStatus,
  loadError: holidaysError,
  refresh: refreshHolidays,
} = useHolidays()
const {
  orders,
  status: ordersStatus,
  loadError: ordersError,
  refresh: refreshOrders,
} = useOrders(today)
const {
  products,
  status: productsStatus,
  loadError: productsError,
  refresh: refreshProducts,
} = useActiveProducts()

// --------------------------------------------------------------- Estados
const suppliersLoaded = computed(() => suppliersStatus.value === 'success' || suppliers.value.length > 0)
const ordersLoaded = computed(() => ordersStatus.value === 'success' || orders.value.length > 0)
const summaryError = computed(() => {
  if (ordersError.value && !orders.value.length) return ordersError.value
  if (suppliersError.value && !suppliers.value.length) return suppliersError.value
  return null
})
const loading = computed(() => !summaryError.value && (!ordersLoaded.value || !suppliersLoaded.value))
const productsLoading = computed(() => !productsError.value && productsStatus.value !== 'success' && !products.value.length)
const productsUnavailable = computed(() => Boolean(productsError.value) && productsStatus.value !== 'pending' && !products.value.length)
const holidaysUnavailable = computed(() => Boolean(holidaysError.value) && holidaysStatus.value !== 'pending')
const retrying = computed(() => [ordersStatus, suppliersStatus].some(s => s.value === 'pending'))

const summary = computed(() => buildHomeSummary({
  suppliers: suppliers.value,
  orders: orders.value,
  holidays: holidays.value,
  products: products.value,
  today: today.value,
}))

const title = computed(() => formatHomeTitle(today.value))
const summaryText = computed(() => {
  if (loading.value) return 'Cargando los pedidos de hoy y mañana…'
  if (summaryError.value) return 'Los pedidos de hoy y mañana, de un vistazo.'
  return describeHomeSummary(summary.value)
})

const hasSchedules = computed(() => suppliers.value.some(s => s.is_active && normalizeWeekdays(s.delivery_weekdays).length > 0))
const nothingPlanned = computed(() => !loading.value && !summaryError.value
  && !hasSchedules.value
  && summary.value.today.orderCount === 0 && summary.value.tomorrow.orderCount === 0
  && summary.value.today.doneCount === 0 && summary.value.tomorrow.doneCount === 0)

// Sesión caducada: recargar lleva al inicio de sesión (middleware).
const route = useRoute()
function reloadPage() {
  reloadNuxtApp({ path: route.fullPath, force: true })
}

function retry() {
  if (ordersError.value) refreshOrders()
  if (suppliersError.value) refreshSuppliers()
  if (holidaysError.value) refreshHolidays()
  if (productsError.value) refreshProducts()
}
</script>

<template>
  <div class="space-y-7 sm:space-y-9">
    <!-- Cabecera -->
    <header class="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div class="min-w-0 max-w-2xl">
        <p
          class="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-primary"
          data-home-eyebrow
        >
          <span>Resumen del día</span>
          <span
            class="size-1 rounded-full bg-primary/40"
            aria-hidden="true"
          />
          <span class="font-medium normal-case tracking-normal text-muted">{{ greeting }}</span>
        </p>
        <h1 class="mt-2 text-[1.75rem] font-semibold leading-tight tracking-tight text-highlighted sm:text-[2.125rem]">
          {{ title }}
        </h1>
        <p
          class="mt-1.5 text-pretty text-[0.9375rem] leading-relaxed text-muted"
          aria-live="polite"
          data-home-summary
        >
          {{ summaryText }}
        </p>
      </div>

      <UButton
        to="/pedidos"
        label="Ver agenda completa"
        trailing-icon="i-lucide-arrow-right"
        color="neutral"
        variant="outline"
        class="min-h-11 bg-default sm:min-h-9"
      />
    </header>

    <!-- Error al cargar pedidos o proveedores -->
    <div
      v-if="summaryError"
      class="rounded-xl bg-default shadow-xs ring ring-default"
      role="alert"
    >
      <EmptyState
        icon="i-lucide-cloud-off"
        tone="error"
        title="No se ha podido cargar el resumen"
        :description="summaryError.message"
      >
        <UButton
          v-if="summaryError.kind === DB_ERROR_KIND.EXPIRED"
          label="Volver a iniciar sesión"
          icon="i-lucide-log-in"
          @click="reloadPage"
        />
        <UButton
          v-else
          label="Reintentar"
          icon="i-lucide-refresh-cw"
          :loading="retrying"
          @click="retry"
        />
        <UButton
          to="/pedidos"
          label="Ir a la agenda"
          color="neutral"
          variant="outline"
        />
      </EmptyState>
    </div>

    <!-- Sin proveedores con días de entrega -->
    <div
      v-else-if="nothingPlanned"
      class="rounded-xl bg-default shadow-xs ring ring-default"
    >
      <EmptyState
        icon="i-lucide-calendar-plus"
        title="Aún no hay pedidos que preparar"
        description="Cuando des de alta proveedores con sus días de entrega, aquí verás qué pedidos toca preparar hoy y mañana."
      >
        <UButton
          to="/pedidos/proveedores"
          label="Ir a proveedores"
          icon="i-lucide-store"
        />
      </EmptyState>
    </div>

    <template v-else>
      <!-- Avisos de datos parciales -->
      <div
        v-if="productsUnavailable || holidaysUnavailable"
        class="space-y-3"
      >
        <UAlert
          v-if="productsUnavailable"
          color="warning"
          variant="subtle"
          icon="i-lucide-package-x"
          title="No se han podido cargar los productos habituales"
          :description="`${productsError.message} Los pedidos se muestran igualmente.`"
          :actions="[{ label: 'Reintentar', color: 'warning', variant: 'outline', icon: 'i-lucide-refresh-cw', onClick: () => refreshProducts() }]"
          :ui="{ description: 'text-sm text-default' }"
          data-home-alert="products"
        />
        <UAlert
          v-if="holidaysUnavailable"
          color="warning"
          variant="subtle"
          icon="i-lucide-calendar-x-2"
          title="No se han podido comprobar los festivos"
          description="Los pedidos se muestran sin avisos de festivo."
          :actions="[{ label: 'Reintentar', color: 'warning', variant: 'outline', icon: 'i-lucide-refresh-cw', onClick: () => refreshHolidays() }]"
          :ui="{ description: 'text-sm text-default' }"
          data-home-alert="holidays"
        />
      </div>

      <div class="grid items-start gap-8 lg:grid-cols-2 lg:gap-10">
        <HomeDaySection
          kind="today"
          :section="summary.today"
          :today="today"
          :loading="loading"
          :products-loading="productsLoading"
          :products-unavailable="productsUnavailable"
        />
        <HomeDaySection
          kind="tomorrow"
          :section="summary.tomorrow"
          :today="today"
          :loading="loading"
          :products-loading="productsLoading"
          :products-unavailable="productsUnavailable"
        />
      </div>

      <p class="flex items-start gap-2 text-pretty text-sm text-muted">
        <UIcon
          name="i-lucide-info"
          class="mt-0.5 size-4 shrink-0 text-dimmed"
          aria-hidden="true"
        />
        Las cantidades son las habituales de cada producto: orientativas, no confirmadas. Los pedidos se marcan y se ajustan en la agenda.
      </p>
    </template>
  </div>
</template>
