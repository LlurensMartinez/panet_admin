<script setup>
// Proveedores: listado, búsqueda, filtro por estado, alta, edición y
// activación/desactivación. No hay borrado: los proveedores se desactivan
// para conservar sus pedidos.
//
// El acceso a la página lo controla app/middleware/auth.global.js (sesión +
// cuenta autorizada). Los datos los protege la RLS de Supabase.
useHead({ title: 'Proveedores · Pedidos · Panet Admin' })

const toast = useToast()
const {
  suppliers,
  status,
  loadError,
  refresh,
  createSupplier,
  updateSupplier,
  setSupplierActive,
} = useSuppliers()

// ------------------------------------------------------------------ Listado
const statusFilter = ref(SUPPLIER_STATUS_FILTER.ACTIVE)
const search = ref('')
const listRegion = useTemplateRef('listRegion')

const hasLoaded = computed(() => status.value === 'success' || suppliers.value.length > 0)
const isInitialLoading = computed(() => !hasLoaded.value && !loadError.value)
const counts = computed(() => countSuppliers(suppliers.value))
const visibleSuppliers = computed(() => filterSuppliers(suppliers.value, {
  status: statusFilter.value,
  query: search.value,
}))
const searchQuery = computed(() => search.value.trim())

// Coincidencias de la búsqueda que el filtro de estado está ocultando.
const hiddenMatches = computed(() => {
  if (!searchQuery.value || statusFilter.value === SUPPLIER_STATUS_FILTER.ALL) return 0
  return filterSuppliers(suppliers.value, { status: SUPPLIER_STATUS_FILTER.ALL, query: search.value }).length
    - visibleSuppliers.value.length
})

const resultsSummary = computed(() => {
  const n = visibleSuppliers.value.length
  if (searchQuery.value) {
    return n === 1 ? '1 resultado' : `${n} resultados`
  }
  const noun = n === 1 ? 'proveedor' : 'proveedores'
  if (statusFilter.value === SUPPLIER_STATUS_FILTER.ACTIVE) return `${n} ${noun} ${n === 1 ? 'activo' : 'activos'}`
  if (statusFilter.value === SUPPLIER_STATUS_FILTER.INACTIVE) return `${n} ${noun} ${n === 1 ? 'inactivo' : 'inactivos'}`
  return `${n} ${noun}`
})

const emptyState = computed(() => {
  if (counts.value.all === 0) {
    return {
      icon: 'i-lucide-truck',
      title: 'Todavía no hay proveedores',
      description: 'Añade los proveedores con sus días de entrega para que la agenda sepa qué pedidos toca preparar.',
      action: 'create',
    }
  }
  if (searchQuery.value) {
    return {
      icon: 'i-lucide-search-x',
      title: `Ningún resultado para «${searchQuery.value}»`,
      description: hiddenMatches.value > 0
        ? `Hay ${hiddenMatches.value === 1 ? '1 coincidencia' : `${hiddenMatches.value} coincidencias`} en otro estado.`
        : 'Revisa cómo está escrito o busca por otra parte del nombre.',
      action: 'clear-search',
    }
  }
  if (statusFilter.value === SUPPLIER_STATUS_FILTER.INACTIVE) {
    return {
      icon: 'i-lucide-archive',
      title: 'No hay proveedores inactivos',
      description: 'Cuando desactives un proveedor, aparecerá aquí con todos sus pedidos.',
      action: 'show-active',
    }
  }
  return {
    icon: 'i-lucide-truck',
    title: 'No hay proveedores activos',
    description: 'Todos los proveedores están desactivados. Puedes activarlos desde «Inactivos».',
    action: 'show-inactive',
  }
})

function clearSearch() {
  search.value = ''
}

// Aviso si falla una recarga cuando ya se ve la lista.
watch(loadError, (error) => {
  if (error && suppliers.value.length) {
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
  reloadNuxtApp({ path: '/pedidos/proveedores', force: true })
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
const editingSupplier = ref(null)

function openCreate() {
  editingSupplier.value = null
  formOpen.value = true
}

function openEdit(supplier) {
  editingSupplier.value = supplier
  formOpen.value = true
}

function submitForm(values) {
  return editingSupplier.value
    ? updateSupplier(editingSupplier.value.id, values)
    : createSupplier(values)
}

function onSaved(supplier) {
  const created = !editingSupplier.value

  // Que el proveedor guardado quede a la vista.
  if (!filterSuppliers([supplier], { status: statusFilter.value, query: search.value }).length) {
    search.value = ''
    if (!matchesSupplierStatus(supplier, statusFilter.value)) {
      statusFilter.value = SUPPLIER_STATUS_FILTER.ALL
    }
  }

  highlight(supplier.id)
  toast.add({
    title: created ? 'Proveedor añadido' : 'Cambios guardados',
    description: created ? `${supplier.name} ya aparece en la lista.` : `Se han actualizado los datos de ${supplier.name}.`,
    color: 'success',
    icon: 'i-lucide-circle-check',
  })
}

// ------------------------------------------------- Activar y desactivar
const pendingIds = ref([])
const confirmOpen = ref(false)
const supplierToDeactivate = ref(null)

function onToggleActive(supplier) {
  if (supplier.is_active) {
    supplierToDeactivate.value = supplier
    confirmOpen.value = true
    return
  }
  changeActive(supplier, true)
}

async function changeActive(supplier, isActive) {
  if (pendingIds.value.includes(supplier.id)) return
  pendingIds.value = [...pendingIds.value, supplier.id]

  try {
    const result = await setSupplierActive(supplier.id, isActive)

    if (!result.ok) {
      showError(result)
      return false
    }

    if (isActive) highlight(supplier.id)
    toast.add({
      title: isActive ? `Se ha activado ${supplier.name}` : `Se ha desactivado ${supplier.name}`,
      description: isActive ? undefined : 'Sus pedidos se conservan. Lo encontrarás en «Inactivos».',
      color: 'success',
      icon: isActive ? 'i-lucide-circle-play' : 'i-lucide-circle-pause',
    })
    return true
  }
  finally {
    pendingIds.value = pendingIds.value.filter(id => id !== supplier.id)
  }
}

async function confirmDeactivate() {
  const supplier = supplierToDeactivate.value
  if (!supplier) return
  const done = await changeActive(supplier, false)
  if (done) {
    confirmOpen.value = false
    // La fila puede desaparecer del filtro actual: el foco vuelve al listado.
    nextTick(() => listRegion.value?.focus())
  }
}

const deactivatePending = computed(() =>
  Boolean(supplierToDeactivate.value && pendingIds.value.includes(supplierToDeactivate.value.id)),
)
</script>

<template>
  <div class="space-y-8">
    <PageHeader
      title="Proveedores"
      description="Días habituales de entrega y antelación con la que se prepara cada pedido. Pulsa un proveedor para ver sus productos habituales. Al desactivar un proveedor, sus pedidos se conservan."
    >
      <template #actions>
        <UButton
          label="Añadir proveedor"
          icon="i-lucide-plus"
          size="lg"
          :disabled="!hasLoaded"
          @click="openCreate"
        />
      </template>
    </PageHeader>

    <OrderSectionNav />

    <section
      ref="listRegion"
      aria-labelledby="suppliers-list-title"
      tabindex="-1"
      class="space-y-4 focus:outline-none"
    >
      <h2
        id="suppliers-list-title"
        class="sr-only"
      >
        Listado de proveedores
      </h2>

      <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SupplierStatusFilter
          v-model="statusFilter"
          :counts="counts"
          :loading="isInitialLoading"
          :unavailable="Boolean(loadError && !suppliers.length)"
        />

        <UInput
          v-model="search"
          type="search"
          icon="i-lucide-search"
          placeholder="Buscar proveedor"
          aria-label="Buscar proveedor"
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
        v-if="loadError && !suppliers.length"
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

      <SupplierList
        v-else
        :suppliers="visibleSuppliers"
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
              label="Añadir proveedor"
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
                @click="statusFilter = SUPPLIER_STATUS_FILTER.ALL"
              />
            </template>
            <UButton
              v-else-if="emptyState.action === 'show-active'"
              label="Ver activos"
              color="neutral"
              variant="outline"
              @click="statusFilter = SUPPLIER_STATUS_FILTER.ACTIVE"
            />
            <UButton
              v-else-if="emptyState.action === 'show-inactive'"
              label="Ver inactivos"
              color="neutral"
              variant="outline"
              @click="statusFilter = SUPPLIER_STATUS_FILTER.INACTIVE"
            />
          </EmptyState>
        </template>
      </SupplierList>

      <p
        v-if="hasLoaded && visibleSuppliers.length"
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

    <SupplierFormModal
      v-model:open="formOpen"
      :supplier="editingSupplier"
      :suppliers="suppliers"
      :submit="submitForm"
      @saved="onSaved"
    />

    <ConfirmModal
      v-model:open="confirmOpen"
      :title="`¿Desactivar ${supplierToDeactivate?.name ?? 'el proveedor'}?`"
      description="Dejará de aparecer en la agenda y no se le podrán crear pedidos nuevos. Sus pedidos anteriores se conservan, y puedes volver a activarlo cuando quieras desde «Inactivos»."
      confirm-label="Desactivar"
      confirm-icon="i-lucide-circle-pause"
      :pending="deactivatePending"
      @confirm="confirmDeactivate"
    />
  </div>
</template>
