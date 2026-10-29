<script setup>
// Productos habituales de un proveedor en una sola superficie, con el mismo
// aspecto que los listados de proveedores y empleados. La cabecera de
// columnas solo se ve en escritorio y es visual.
defineProps({
  products: { type: Array, required: true },
  pendingIds: { type: Array, default: () => [] },
  highlightedId: { type: String, default: null },
  loading: { type: Boolean, default: false },
})

const emit = defineEmits(['edit', 'toggle-active'])

const SKELETON_ROWS = 3
</script>

<template>
  <div class="overflow-hidden rounded-xl bg-default shadow-xs ring ring-default">
    <div
      class="hidden grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_6.5rem_13rem] gap-x-4 border-b border-default bg-muted/60 px-5 py-2.5 text-xs font-medium text-muted md:grid"
      aria-hidden="true"
    >
      <span>Producto</span>
      <span>Cantidad habitual</span>
      <span>Estado</span>
      <span class="sr-only">Acciones</span>
    </div>

    <ul
      v-if="loading"
      class="divide-y divide-default"
      aria-label="Cargando productos"
      aria-busy="true"
    >
      <li
        v-for="n in SKELETON_ROWS"
        :key="n"
        class="flex items-center gap-4 px-4 py-4 sm:px-5"
      >
        <div class="flex-1 space-y-2">
          <USkeleton class="h-3.5 w-44 max-w-[60%]" />
          <USkeleton class="h-3 w-24 md:hidden" />
        </div>
        <USkeleton class="hidden h-3.5 w-24 md:block" />
        <USkeleton class="h-6 w-20 rounded-full" />
      </li>
    </ul>

    <template v-else>
      <ul
        v-if="products.length"
        class="divide-y divide-default"
        aria-label="Productos habituales"
      >
        <ProductListItem
          v-for="product in products"
          :key="product.id"
          :product="product"
          :pending="pendingIds.includes(product.id)"
          :highlighted="highlightedId === product.id"
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
