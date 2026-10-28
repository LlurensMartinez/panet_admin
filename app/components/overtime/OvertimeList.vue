<script setup>
// Listado de registros en una sola superficie, con el resumen del total
// arriba. Misma estructura visual que EmployeeList.
defineProps({
  entries: { type: Array, required: true },
  pendingIds: { type: Array, default: () => [] },
  highlightedId: { type: String, default: null },
  loading: { type: Boolean, default: false },
})

const emit = defineEmits(['edit', 'delete'])

const SKELETON_ROWS = 5
const COLUMNS = 'md:grid-cols-[minmax(0,1.3fr)_9.5rem_7rem_minmax(0,1.2fr)_12rem]'
</script>

<template>
  <div class="overflow-hidden rounded-xl bg-default shadow-xs ring ring-default">
    <slot name="summary" />

    <div
      v-if="loading || entries.length"
      class="hidden gap-x-4 border-b border-default px-5 py-2.5 text-xs font-medium text-muted md:grid"
      :class="COLUMNS"
      aria-hidden="true"
    >
      <span class="ps-[3.375rem]">Empleado</span>
      <span>Fecha</span>
      <span>Duración</span>
      <span>Motivo</span>
      <span class="sr-only">Acciones</span>
    </div>

    <ul
      v-if="loading"
      class="divide-y divide-default"
      aria-label="Cargando registros"
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
        <USkeleton class="hidden h-3.5 w-24 md:block" />
        <USkeleton class="h-4 w-16" />
      </li>
    </ul>

    <template v-else>
      <ul
        v-if="entries.length"
        class="divide-y divide-default"
        aria-label="Registros de horas extra"
      >
        <OvertimeListItem
          v-for="entry in entries"
          :key="entry.id"
          :entry="entry"
          :pending="pendingIds.includes(entry.id)"
          :highlighted="highlightedId === entry.id"
          @edit="emit('edit', $event)"
          @delete="emit('delete', $event)"
        />
      </ul>
      <slot
        v-else
        name="empty"
      />
    </template>
  </div>
</template>
