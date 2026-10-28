<script setup>
// Listado de proveedores en una sola superficie, con el mismo aspecto que el
// de Empleados. La cabecera de columnas solo se ve en escritorio y es visual:
// cada fila ya identifica sus datos.
defineProps({
  suppliers: { type: Array, required: true },
  pendingIds: { type: Array, default: () => [] },
  highlightedId: { type: String, default: null },
  loading: { type: Boolean, default: false },
})

const emit = defineEmits(['edit', 'toggle-active'])

const SKELETON_ROWS = 4
</script>

<template>
  <div class="overflow-hidden rounded-xl bg-default shadow-xs ring ring-default">
    <div
      class="hidden grid-cols-[minmax(0,1.4fr)_auto_minmax(0,1fr)_6.5rem_13rem] gap-x-4 border-b border-default bg-muted/60 px-5 py-2.5 text-xs font-medium text-muted md:grid"
      aria-hidden="true"
    >
      <span>Proveedor</span>
      <span class="w-[10.375rem]">Días de entrega</span>
      <span>Preparación</span>
      <span>Estado</span>
      <span class="sr-only">Acciones</span>
    </div>

    <!-- Carga -->
    <ul
      v-if="loading"
      class="divide-y divide-default"
      aria-label="Cargando proveedores"
      aria-busy="true"
    >
      <li
        v-for="n in SKELETON_ROWS"
        :key="n"
        class="flex items-center gap-4 px-4 py-4 sm:px-5"
      >
        <div class="flex-1 space-y-2">
          <USkeleton class="h-3.5 w-44 max-w-[60%]" />
          <USkeleton class="h-5 w-40 md:hidden" />
        </div>
        <USkeleton class="hidden h-5 w-40 md:block" />
        <USkeleton class="h-6 w-20 rounded-full" />
      </li>
    </ul>

    <!-- Contenido o estado vacío -->
    <template v-else>
      <ul
        v-if="suppliers.length"
        class="divide-y divide-default"
        aria-label="Proveedores"
      >
        <SupplierListItem
          v-for="supplier in suppliers"
          :key="supplier.id"
          :supplier="supplier"
          :pending="pendingIds.includes(supplier.id)"
          :highlighted="highlightedId === supplier.id"
          @edit="emit('edit', $event)"
          @toggle-active="emit('toggle-active', $event)"
        />
      </ul>
      <slot
        v-else
        name="empty"
      />
    </template>
  </div>
</template>
