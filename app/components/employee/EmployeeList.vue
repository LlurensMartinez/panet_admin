<script setup>
// Listado de empleados en una sola superficie. La cabecera de columnas solo
// se ve en escritorio y es visual: cada fila ya identifica sus datos.
defineProps({
  employees: { type: Array, required: true },
  pendingIds: { type: Array, default: () => [] },
  highlightedId: { type: String, default: null },
  loading: { type: Boolean, default: false },
})

const emit = defineEmits(['edit', 'toggle-active'])

const SKELETON_ROWS = 5
</script>

<template>
  <div class="overflow-hidden rounded-xl bg-default shadow-xs ring ring-default">
    <div
      class="hidden grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_7.5rem_13rem] gap-x-4 border-b border-default bg-muted/60 px-5 py-2.5 text-xs font-medium text-muted md:grid"
      aria-hidden="true"
    >
      <span class="ps-[3.375rem]">Nombre</span>
      <span>Puesto</span>
      <span>Estado</span>
      <span class="sr-only">Acciones</span>
    </div>

    <!-- Carga -->
    <ul
      v-if="loading"
      class="divide-y divide-default"
      aria-label="Cargando empleados"
      aria-busy="true"
    >
      <li
        v-for="n in SKELETON_ROWS"
        :key="n"
        class="flex items-center gap-3.5 px-4 py-4 sm:px-5"
      >
        <USkeleton class="size-10 rounded-full" />
        <div class="flex-1 space-y-2">
          <USkeleton class="h-3.5 w-40 max-w-[60%]" />
          <USkeleton class="h-3 w-24 md:hidden" />
        </div>
        <USkeleton class="hidden h-3.5 w-28 md:block" />
        <USkeleton class="h-6 w-20 rounded-full" />
      </li>
    </ul>

    <!-- Contenido o estado vacío -->
    <template v-else>
      <ul
        v-if="employees.length"
        class="divide-y divide-default"
        aria-label="Empleados"
      >
        <EmployeeListItem
          v-for="employee in employees"
          :key="employee.id"
          :employee="employee"
          :pending="pendingIds.includes(employee.id)"
          :highlighted="highlightedId === employee.id"
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
