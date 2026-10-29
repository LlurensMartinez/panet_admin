<script setup>
// Ficha de un proveedor: sus productos habituales (nombre, unidad y cantidad
// habitual). Se pueden añadir, editar y desactivar/activar; no se borran.
// Los datos del proveedor (nombre, días de entrega…) se editan en la lista de
// proveedores.
//
// El acceso a la página lo controla app/middleware/auth.global.js (sesión +
// cuenta autorizada). Los datos los protege la RLS de Supabase.

// Cada proveedor tiene su propia instancia de la página (y de sus datos).
definePageMeta({ key: route => route.fullPath })

const route = useRoute()
const toast = useToast()
const supplierId = String(route.params.id ?? '')

const {
  suppliers,
  status: suppliersStatus,
  loadError: suppliersError,
  refresh: refreshSuppliers,
} = useSuppliers()
const {
  products,
  status,
  loadError,
  refresh,
  createProduct,
  updateProduct,
  setProductActive,
} = useSupplierProducts(supplierId)

// ------------------------------------------------------------- Proveedor
const supplier = computed(() => suppliers.value.find(s => s.id === supplierId) ?? null)
const suppliersLoaded = computed(() => suppliersStatus.value === 'success' || suppliers.value.length > 0)
const notFound = computed(() => !isUuid(supplierId) || (suppliersLoaded.value && !supplier.value))
const schedule = computed(() => supplier.value ? describeSupplierSchedule(supplier.value) : null)

useHead({ title: () => `${supplier.value?.name ?? 'Proveedor'} · Proveedores · Panet Admin` })

// --------------------------------------------------------------- Listado
const statusFilter = ref(SUPPLIER_STATUS_FILTER.ACTIVE)
const listRegion = useTemplateRef('listRegion')

const productsLoaded = computed(() => status.value === 'success' || products.value.length > 0)
const pageError = computed(() => {
  if (suppliersError.value && !suppliers.value.length) return suppliersError.value
  if (loadError.value && !products.value.length) return loadError.value
  return null
})
const isInitialLoading = computed(() => !pageError.value && (!productsLoaded.value || !suppliersLoaded.value))
const counts = computed(() => countProducts(products.value))
const visibleProducts = computed(() => filterProducts(products.value, statusFilter.value))

const resultsSummary = computed(() => {
  const n = visibleProducts.value.length
  const noun = n === 1 ? 'producto' : 'productos'
  if (statusFilter.value === SUPPLIER_STATUS_FILTER.ACTIVE) return `${n} ${noun} ${n === 1 ? 'activo' : 'activos'}`
  if (statusFilter.value === SUPPLIER_STATUS_FILTER.INACTIVE) return `${n} ${noun} ${n === 1 ? 'inactivo' : 'inactivos'}`
  return `${n} ${noun}`
})

const emptyState = computed(() => {
  if (counts.value.all === 0) {
    return {
      icon: 'i-lucide-package',
      title: 'Todavía no hay productos habituales',
      description: 'Añade lo que se suele pedir a este proveedor, con su unidad y la cantidad habitual.',
      action: 'create',
    }
  }
  if (statusFilter.value === SUPPLIER_STATUS_FILTER.INACTIVE) {
    return {
      icon: 'i-lucide-archive',
      title: 'No hay productos inactivos',
      description: 'Cuando desactives un producto, aparecerá aquí.',
      action: 'show-active',
    }
  }
  return {
    icon: 'i-lucide-package-x',
    title: 'No hay productos activos',
    description: 'Todos los productos están desactivados. Puedes activarlos desde «Inactivos».',
    action: 'show-inactive',
  }
})

function retry() {
  if (suppliersError.value) refreshSuppliers()
  refresh()
}

watch(loadError, (error) => {
  if (error && products.value.length) {
    toast.add({
      title: 'No se ha podido actualizar la lista',
      description: error.message,
      color: 'error',
      icon: 'i-lucide-circle-alert',
    })
  }
})

function reloadPage() {
  reloadNuxtApp({ path: route.fullPath, force: true })
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
const editingProduct = ref(null)

function openCreate() {
  editingProduct.value = null
  formOpen.value = true
}

function openEdit(product) {
  editingProduct.value = product
  formOpen.value = true
}

function submitForm(values) {
  return editingProduct.value
    ? updateProduct(editingProduct.value.id, values)
    : createProduct(values)
}

function onSaved(product) {
  const created = !editingProduct.value
  if (!matchesProductStatus(product, statusFilter.value)) statusFilter.value = SUPPLIER_STATUS_FILTER.ALL
  highlight(product.id)
  toast.add({
    title: created ? 'Producto añadido' : 'Cambios guardados',
    description: `${product.name}: ${formatProductQuantity(product)}.`,
    color: 'success',
    icon: 'i-lucide-circle-check',
  })
}

// ------------------------------------------------- Activar y desactivar
const pendingIds = ref([])
const confirmOpen = ref(false)
const productToDeactivate = ref(null)

function onToggleActive(product) {
  if (product.is_active) {
    productToDeactivate.value = product
    confirmOpen.value = true
    return
  }
  changeActive(product, true)
}

async function changeActive(product, isActive) {
  if (pendingIds.value.includes(product.id)) return
  pendingIds.value = [...pendingIds.value, product.id]

  try {
    const result = await setProductActive(product.id, isActive)
    if (!result.ok) {
      showError(result)
      return false
    }
    if (isActive) highlight(product.id)
    toast.add({
      title: isActive ? `Se ha activado ${product.name}` : `Se ha desactivado ${product.name}`,
      description: isActive ? undefined : 'Se conserva en «Inactivos».',
      color: 'success',
      icon: isActive ? 'i-lucide-circle-play' : 'i-lucide-circle-pause',
    })
    return true
  }
  finally {
    pendingIds.value = pendingIds.value.filter(id => id !== product.id)
  }
}

async function confirmDeactivate() {
  const product = productToDeactivate.value
  if (!product) return
  const done = await changeActive(product, false)
  if (done) {
    confirmOpen.value = false
    nextTick(() => listRegion.value?.focus())
  }
}

const deactivatePending = computed(() =>
  Boolean(productToDeactivate.value && pendingIds.value.includes(productToDeactivate.value.id)),
)
</script>

<template>
  <div class="space-y-8">
    <div class="space-y-3">
      <UButton
        to="/pedidos/proveedores"
        label="Proveedores"
        icon="i-lucide-arrow-left"
        color="neutral"
        variant="link"
        class="-ms-1 px-1"
      />

      <!-- Proveedor no encontrado -->
      <template v-if="notFound">
        <PageHeader title="Proveedor no encontrado" />
      </template>

      <PageHeader
        v-else-if="supplier"
        :title="supplier.name"
        :description="`${schedule.delivery}. ${schedule.preparation}`"
      >
        <template #actions>
          <UButton
            label="Añadir producto"
            icon="i-lucide-plus"
            size="lg"
            :disabled="!productsLoaded"
            @click="openCreate"
          />
        </template>
      </PageHeader>

      <div
        v-else
        class="space-y-3"
        aria-busy="true"
        aria-label="Cargando el proveedor"
      >
        <USkeleton class="h-8 w-56 max-w-[70%]" />
        <USkeleton class="h-4 w-80 max-w-[90%]" />
      </div>
    </div>

    <OrderSectionNav />

    <div
      v-if="notFound"
      class="rounded-xl bg-default shadow-xs ring ring-default"
    >
      <EmptyState
        icon="i-lucide-search-x"
        title="No se ha encontrado este proveedor"
        description="Puede que la dirección no sea correcta. Vuelve a la lista de proveedores para elegirlo."
      >
        <UButton
          label="Ver proveedores"
          icon="i-lucide-truck"
          to="/pedidos/proveedores"
        />
      </EmptyState>
    </div>

    <section
      v-else
      ref="listRegion"
      aria-labelledby="products-title"
      tabindex="-1"
      class="space-y-4 focus:outline-none"
    >
      <div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2
          id="products-title"
          class="text-lg font-semibold text-highlighted"
        >
          Productos habituales
        </h2>
        <p class="text-sm text-muted">
          La cantidad habitual es una referencia para preparar los pedidos.
        </p>
      </div>

      <UAlert
        v-if="supplier && !supplier.is_active"
        color="neutral"
        variant="subtle"
        icon="i-lucide-circle-pause"
        title="Este proveedor está desactivado"
        description="Sus productos se conservan y puedes seguir consultándolos y editándolos."
      />

      <SupplierStatusFilter
        v-model="statusFilter"
        legend="Mostrar productos"
        :counts="counts"
        :loading="isInitialLoading"
        :unavailable="Boolean(pageError)"
      />

      <div
        v-if="pageError"
        class="rounded-xl bg-default shadow-xs ring ring-default"
      >
        <EmptyState
          tone="error"
          icon="i-lucide-cloud-off"
          title="No se han podido cargar los productos"
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
            :loading="status === 'pending'"
            @click="retry"
          />
        </EmptyState>
      </div>

      <ProductList
        v-else
        :products="visibleProducts"
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
              label="Añadir producto"
              icon="i-lucide-plus"
              @click="openCreate"
            />
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
      </ProductList>

      <p
        v-if="!isInitialLoading && !pageError && visibleProducts.length"
        class="px-1 text-sm text-muted"
        aria-live="polite"
      >
        {{ resultsSummary }}
      </p>
    </section>

    <ProductFormModal
      v-model:open="formOpen"
      :product="editingProduct"
      :products="products"
      :supplier-name="supplier?.name ?? ''"
      :submit="submitForm"
      @saved="onSaved"
    />

    <ConfirmModal
      v-model:open="confirmOpen"
      :title="`¿Desactivar ${productToDeactivate?.name ?? 'el producto'}?`"
      description="Dejará de aparecer entre los productos activos de este proveedor. No se borra: puedes volver a activarlo cuando quieras desde «Inactivos»."
      confirm-label="Desactivar"
      confirm-icon="i-lucide-circle-pause"
      :pending="deactivatePending"
      @confirm="confirmDeactivate"
    />
  </div>
</template>
