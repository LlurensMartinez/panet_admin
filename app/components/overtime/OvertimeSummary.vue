<script setup>
// Total de los registros visibles (tras aplicar los filtros). Se calcula
// sumando los minutos enteros de cada registro y se muestra en horas y
// minutos al final; nunca se suman valores redondeados.
const props = defineProps({
  totalMinutes: { type: Number, required: true },
  count: { type: Number, required: true },
  scope: { type: String, required: true },
  loading: { type: Boolean, default: false },
})

const countText = computed(() => props.count === 1 ? '1 registro' : `${props.count} registros`)
</script>

<template>
  <div
    class="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-b border-default bg-muted/60 px-4 py-4 sm:px-5"
    role="status"
    aria-live="polite"
    aria-atomic="true"
  >
    <div class="min-w-0">
      <p class="text-sm text-muted">
        Total
      </p>
      <USkeleton
        v-if="loading"
        class="mt-1.5 h-8 w-32"
      />
      <p
        v-else
        class="font-display text-[1.75rem] font-semibold leading-tight tracking-tight text-highlighted tabular-nums"
      >
        <span aria-hidden="true">{{ formatDuration(totalMinutes) }}</span>
        <span class="sr-only">{{ formatDurationLong(totalMinutes) }}</span>
      </p>
    </div>
    <div
      v-if="!loading"
      class="min-w-0 text-sm sm:text-end"
    >
      <p class="font-medium text-toned tabular-nums">
        {{ countText }}
      </p>
      <p class="truncate text-muted">
        {{ scope }}
      </p>
    </div>
  </div>
</template>
