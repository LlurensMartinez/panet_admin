<script setup>
// Historial de pedidos guardados: filtros (proveedor y fechas de entrega),
// lista paginada y acciones sobre cada pedido. Los datos los carga la página
// con useOrderHistory().
const supplierId = defineModel('supplierId', { type: String, default: undefined })
const from = defineModel('from', { type: String, default: '' })
const to = defineModel('to', { type: String, default: '' })
const page = defineModel('page', { type: Number, default: 0 })

const props = defineProps({
  rows: { type: Array, required: true },
  total: { type: Number, default: 0 },
  // Página de las filas cargadas (puede ir por detrás de `page` mientras
  // carga la siguiente).
  loadedPage: { type: Number, default: 0 },
  holidays: { type: Array, default: () => [] },
  suppliers: { type: Array, default: () => [] },
  today: { type: String, required: true },
  loading: { type: Boolean, default: false },
  loadError: { type: Object, default: null },
  rangeError: { type: String, default: null },
  pendingKeys: { type: Array, default: () => [] },
  highlightedKey: { type: String, default: null },
})

const emit = defineEmits(['prepare', 'reopen', 'skip', 'edit', 'delete', 'retry', 'clear', 'login'])

const rangeErrorId = useId()
const listTop = useTemplateRef('listTop')

const supplierItems = computed(() => [...props.suppliers]
  .sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }))
  .map(s => ({ value: s.id, label: s.name, description: s.is_active ? undefined : 'Inactivo' })))

const hasFilters = computed(() => Boolean(supplierId.value || from.value || to.value))
const pageCount = computed(() => getPageCount(props.total))
const summary = computed(() => describeHistoryPage(props.loadedPage, props.total))
const items = computed(() => decorateHistoryRows(props.rows, props.holidays, props.today))

function go(step) {
  page.value = Math.min(pageCount.value - 1, Math.max(0, page.value + step))
  nextTick(() => listTop.value?.focus())
}

const relay = {
  prepare: item => emit('prepare', item),
  reopen: item => emit('reopen', item),
  skip: item => emit('skip', item),
  edit: item => emit('edit', item),
  delete: item => emit('delete', item),
}
</script>

<template>
  <div class="space-y-4">
    <div
      role="search"
      aria-label="Filtrar el historial"
      class="space-y-2"
    >
      <div class="grid grid-cols-2 gap-3 lg:grid-cols-[minmax(0,18rem)_10.5rem_10.5rem_auto] lg:items-end">
        <UFormField
          label="Proveedor"
          class="col-span-2 lg:col-span-1"
        >
          <USelectMenu
            v-model="supplierId"
            :items="supplierItems"
            value-key="value"
            placeholder="Todos los proveedores"
            :search-input="{ 'placeholder': 'Buscar proveedor…', 'aria-label': 'Buscar proveedor' }"
            :clear="{ 'aria-label': 'Mostrar todos los proveedores' }"
            icon="i-lucide-truck"
            size="lg"
            class="w-full"
          >
            <template #empty>
              No hay proveedores con ese nombre.
            </template>
          </USelectMenu>
        </UFormField>

        <UFormField
          label="Entrega desde"
          :error="Boolean(rangeError)"
          class="min-w-0"
        >
          <UInput
            v-model="from"
            type="date"
            size="lg"
            class="w-full"
            :aria-describedby="rangeError ? rangeErrorId : undefined"
          />
        </UFormField>

        <UFormField
          label="Hasta"
          :error="Boolean(rangeError)"
          class="min-w-0"
        >
          <UInput
            v-model="to"
            type="date"
            size="lg"
            class="w-full"
            :min="from || undefined"
            :aria-describedby="rangeError ? rangeErrorId : undefined"
          />
        </UFormField>

        <div
          v-if="hasFilters"
          class="col-span-2 lg:col-span-1"
        >
          <UButton
            label="Limpiar filtros"
            icon="i-lucide-filter-x"
            color="neutral"
            variant="ghost"
            size="lg"
            @click="emit('clear')"
          />
        </div>
      </div>

      <p
        v-if="rangeError"
        :id="rangeErrorId"
        class="text-sm text-error"
        role="alert"
      >
        {{ rangeError }}
      </p>
    </div>

    <p class="text-sm text-muted">
      Solo aparecen los pedidos guardados: los preparados, los marcados como «no se pide», los editados y los creados a mano.
    </p>

    <div
      ref="listTop"
      tabindex="-1"
      class="overflow-hidden rounded-xl bg-default shadow-xs ring ring-default focus:outline-none"
    >
      <EmptyState
        v-if="loadError"
        tone="error"
        icon="i-lucide-cloud-off"
        title="No se ha podido cargar el historial"
        :description="loadError.message"
      >
        <UButton
          v-if="loadError.kind === DB_ERROR_KIND.EXPIRED"
          label="Volver a iniciar sesión"
          icon="i-lucide-log-in"
          @click="emit('login')"
        />
        <UButton
          v-else
          label="Reintentar"
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="outline"
          :loading="loading"
          @click="emit('retry')"
        />
      </EmptyState>

      <ul
        v-else-if="loading && !rows.length"
        class="divide-y divide-default"
        aria-label="Cargando el historial"
        aria-busy="true"
      >
        <li
          v-for="n in 3"
          :key="n"
          class="space-y-2 px-4 py-4 sm:px-5"
        >
          <USkeleton class="h-4 w-48 max-w-[70%]" />
          <USkeleton class="h-3 w-32" />
          <USkeleton class="h-10 w-full sm:w-44" />
        </li>
      </ul>

      <EmptyState
        v-else-if="rangeError"
        icon="i-lucide-calendar-range"
        title="Revisa las fechas"
        :description="rangeError"
      />

      <EmptyState
        v-else-if="!rows.length"
        icon="i-lucide-history"
        :title="hasFilters ? 'Ningún pedido con estos filtros' : 'Todavía no hay pedidos guardados'"
        :description="hasFilters
          ? 'Prueba con otro proveedor u otras fechas.'
          : 'Aparecerán aquí cuando marques una previsión, la edites o crees un pedido a mano.'"
      >
        <UButton
          v-if="hasFilters"
          label="Limpiar filtros"
          color="neutral"
          variant="outline"
          @click="emit('clear')"
        />
      </EmptyState>

      <ul
        v-else
        class="divide-y divide-default"
        aria-label="Historial de pedidos"
        :aria-busy="loading || undefined"
      >
        <OrderCard
          v-for="row in items"
          :key="row.id"
          :item="row"
          :today="today"
          context="history"
          :pending="pendingKeys.includes(`order:${row.id}`)"
          :highlighted="highlightedKey === `order:${row.id}`"
          v-on="relay"
        />
      </ul>
    </div>

    <nav
      v-if="!loadError && total > 0"
      aria-label="Páginas del historial"
      class="flex flex-wrap items-center justify-between gap-3"
    >
      <p
        class="text-sm text-muted"
        aria-live="polite"
      >
        {{ summary }}
      </p>
      <div
        v-if="pageCount > 1"
        class="flex items-center gap-1"
      >
        <UButton
          icon="i-lucide-chevron-left"
          label="Anterior"
          color="neutral"
          variant="outline"
          size="lg"
          :disabled="page === 0 || loading"
          @click="go(-1)"
        />
        <span class="px-2 text-sm tabular-nums text-muted">{{ page + 1 }} / {{ pageCount }}</span>
        <UButton
          trailing-icon="i-lucide-chevron-right"
          label="Siguiente"
          color="neutral"
          variant="outline"
          size="lg"
          :disabled="page >= pageCount - 1 || loading"
          @click="go(1)"
        />
      </div>
    </nav>
  </div>
</template>
