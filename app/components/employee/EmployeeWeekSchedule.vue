<script setup>
// Horario habitual de una semana (solo lectura): de lunes a domingo, con los
// turnos de cada día o «Descanso», y el total semanal. Las horas son de reloj;
// las reales de cada fecha (cambios de hora) las calcula el calendario.
const props = defineProps({
  week: { type: Object, default: () => ({}) },
  // Etiqueta accesible de la lista (por ejemplo, «Horario vigente»).
  label: { type: String, default: 'Horario semanal' },
})

const rows = computed(() => getWeekRows(props.week))
const total = computed(() => describeWeeklyTotal(props.week))
</script>

<template>
  <div class="space-y-3">
    <ul
      :aria-label="label"
      class="divide-y divide-default overflow-hidden rounded-lg ring ring-default"
      data-week-schedule
    >
      <li
        v-for="row in rows"
        :key="row.weekday"
        class="grid grid-cols-[5.5rem_minmax(0,1fr)_auto] items-baseline gap-x-3 px-3.5 py-2.5 sm:grid-cols-[7rem_minmax(0,1fr)_4.5rem]"
        :data-weekday="row.weekday"
      >
        <span class="text-sm font-medium text-highlighted">{{ row.label }}</span>
        <span
          v-if="row.rest"
          class="text-sm text-dimmed"
        >Descanso</span>
        <span
          v-else
          class="flex flex-wrap gap-x-3 gap-y-0.5 text-sm text-default tabular-nums"
        >
          <span
            v-for="shift in row.shifts"
            :key="`${shift.start}-${shift.end}`"
          >
            {{ shift.start }}–{{ shift.end }}<span
              v-if="shift.overnight"
              class="text-muted"
            > (acaba al día siguiente)</span>
          </span>
        </span>
        <span class="text-end text-sm text-muted tabular-nums">
          {{ row.rest ? '' : formatDuration(row.minutes) }}
        </span>
      </li>
    </ul>
    <p
      class="px-1 text-sm font-medium text-highlighted"
      data-week-total
    >
      Total: {{ total }}
    </p>
  </div>
</template>
