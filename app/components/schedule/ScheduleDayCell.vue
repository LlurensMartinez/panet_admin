<script setup>
// Día de una empleada en el calendario (solo lectura). El contenido lo decide
// getDayCellView; aquí solo se pinta. Las excepciones (cambios de un día,
// días libres y ausencias) se distinguen con borde discontinuo o con su tono.
const props = defineProps({
  // Día resuelto por buildWeekPlan (resolveEmployeeDay + hasConflict).
  day: { type: Object, required: true },
  // Cabecera del día (getDayHeaders), para el texto accesible.
  header: { type: Object, required: true },
  // Muestra también la duración del día.
  showDuration: { type: Boolean, default: true },
  // Muestra el texto completo de los errores (vista diaria, sin espacio limitado).
  detailed: { type: Boolean, default: false },
})

const view = computed(() => getDayCellView(props.day))
const description = computed(() => describeDayCell(props.header, view.value))

const TONE_CLASSES = {
  [CELL_TONE.REGULAR]: 'text-default',
  [CELL_TONE.EXCEPTION]: 'rounded-md border border-dashed border-primary/60 bg-primary/5 text-default',
  [CELL_TONE.REST]: 'text-dimmed',
  [CELL_TONE.ABSENCE]: 'rounded-md bg-sky-50 text-sky-900 ring ring-sky-200 dark:bg-sky-400/10 dark:text-sky-100 dark:ring-sky-400/25',
  [CELL_TONE.TERMINATED]: 'rounded-md bg-elevated text-dimmed',
  [CELL_TONE.EMPTY]: 'text-dimmed',
}
</script>

<template>
  <div
    class="min-w-0 space-y-0.5 px-1.5 py-1 text-sm"
    :class="[TONE_CLASSES[view.tone], view.hasConflict ? 'ring-2 ring-amber-400 rounded-md' : '']"
    :aria-label="description"
    role="group"
    :data-cell-tone="view.tone"
    :data-cell-date="day.date"
  >
    <p
      v-if="view.badge"
      class="text-[0.6875rem] font-semibold uppercase tracking-wide text-primary"
      aria-hidden="true"
    >
      {{ view.badge }}
    </p>
    <template v-if="view.shifts.length">
      <p
        v-for="shift in view.shifts"
        :key="shift.key"
        class="tabular-nums"
        :class="shift.error ? 'text-amber-800 dark:text-amber-300' : ''"
        :title="shift.error ?? undefined"
        aria-hidden="true"
      >
        <span class="whitespace-nowrap">{{ shift.text }}</span>
        <span
          v-if="shift.overnight"
          class="whitespace-nowrap text-muted"
          title="Acaba al día siguiente"
        >+1</span>
      </p>
    </template>
    <p
      v-else
      class="truncate"
      aria-hidden="true"
    >
      {{ view.label }}
    </p>
    <p
      v-if="showDuration && view.duration"
      class="text-xs text-muted tabular-nums"
      aria-hidden="true"
    >
      {{ view.duration }}
    </p>
    <p
      v-if="view.hasConflict"
      class="text-xs font-medium text-amber-800 dark:text-amber-300"
      aria-hidden="true"
    >
      Turnos solapados
    </p>
    <template v-if="view.errors.length">
      <p
        v-if="!detailed"
        class="text-xs font-medium text-amber-800 dark:text-amber-300"
        :title="view.errors.join(' ')"
        aria-hidden="true"
      >
        Hora no válida
      </p>
      <p
        v-for="error in (detailed ? view.errors : [])"
        :key="error"
        class="text-xs font-medium text-pretty text-amber-800 dark:text-amber-300"
      >
        {{ error }}
      </p>
    </template>
  </div>
</template>
