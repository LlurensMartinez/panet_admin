<script setup>
// Días de entrega de un proveedor en el listado: las siete iniciales, con
// los días de entrega resaltados (no depende solo del color: los demás
// aparecen tenues y sin fondo). Para lectores de pantalla, la lista en texto.
const props = defineProps({
  days: { type: Array, default: () => [] },
})

const selected = computed(() => normalizeWeekdays(props.days))
const text = computed(() => selected.value.length
  ? `Entrega: ${formatWeekdayList(selected.value)}`
  : 'Sin días de entrega habituales')
</script>

<template>
  <span class="inline-flex">
    <span
      class="inline-flex gap-0.5"
      aria-hidden="true"
    >
      <span
        v-for="day in WEEKDAYS"
        :key="day.value"
        class="grid size-[1.375rem] place-items-center rounded-md text-[0.6875rem] font-semibold"
        :class="selected.includes(day.value)
          ? 'bg-primary/12 text-primary ring ring-inset ring-primary/25'
          : 'text-dimmed'"
      >
        {{ day.short }}
      </span>
    </span>
    <span class="sr-only">{{ text }}</span>
  </span>
</template>
