<script setup>
// Vista diaria (móvil y pantallas medianas): selector de día y, para el día
// elegido, quién trabaja y en qué turnos, con el total semanal de cada
// empleada y el total de la tienda del día y de la semana. Solo lectura.
const props = defineProps({
  plan: { type: Object, required: true },
  headers: { type: Array, required: true },
})

const selectedDate = defineModel('selectedDate', { type: String, default: null })

const index = computed(() => Math.max(0, props.headers.findIndex(header => header.date === selectedDate.value)))
const header = computed(() => props.headers[index.value])
// «Sábado, 7 de noviembre» (solo la primera letra en mayúscula).
const title = computed(() => {
  const text = header.value ? formatLongDay(header.value.date) : ''
  return text.charAt(0).toLocaleUpperCase('es') + text.slice(1)
})
</script>

<template>
  <div
    class="space-y-4"
    data-day-list
  >
    <div
      role="group"
      aria-label="Elegir día"
      class="grid grid-cols-7 gap-1 rounded-xl bg-default p-1 shadow-xs ring ring-default"
    >
      <button
        v-for="item in headers"
        :key="item.date"
        type="button"
        class="flex min-h-12 flex-col items-center justify-center rounded-lg text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
        :class="item.date === header?.date
          ? 'bg-primary text-inverted'
          : item.isToday ? 'text-primary hover:bg-elevated' : 'text-muted hover:bg-elevated'"
        :aria-pressed="item.date === header?.date"
        :aria-label="`${item.label} ${item.dayNumber}${item.isToday ? ', hoy' : ''}${item.holiday ? `, festivo: ${item.holiday.name}` : ''}`"
        :data-day-button="item.date"
        @click="selectedDate = item.date"
      >
        <span aria-hidden="true">{{ item.short }}</span>
        <span
          class="text-sm font-semibold"
          aria-hidden="true"
        >{{ item.dayNumber }}</span>
        <span
          v-if="item.holiday"
          class="size-1.5 rounded-full"
          :class="item.date === header?.date ? 'bg-inverted' : 'bg-amber-500'"
          aria-hidden="true"
        />
      </button>
    </div>

    <section
      v-if="header"
      class="overflow-hidden rounded-xl bg-default shadow-xs ring ring-default"
      :aria-label="`Horarios del ${formatLongDay(header.date)}`"
      :data-day-view="header.date"
    >
      <div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-default bg-elevated/50 px-4 py-3">
        <h3 class="font-semibold text-highlighted">
          {{ title }}<span
            v-if="header.isToday"
            class="ms-1.5 text-sm font-medium text-primary"
          >· hoy</span>
        </h3>
        <p
          class="text-sm text-muted"
          data-day-list-total
        >
          Tienda: <span class="font-semibold text-highlighted tabular-nums">{{ formatPlanMinutes(plan.dayTotals[index]) }}</span>
        </p>
        <p
          v-if="header.holiday"
          class="w-full text-sm font-medium text-amber-800 dark:text-amber-300"
          data-day-holiday
        >
          Festivo: {{ header.holiday.name }}. Las horas previstas no cambian.
        </p>
      </div>
      <ul class="divide-y divide-default">
        <li
          v-for="row in plan.rows"
          :key="row.employeeId"
          class="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 px-4 py-3"
          :data-employee-row="row.employeeId"
        >
          <div class="min-w-0 space-y-1">
            <NuxtLink
              :to="`/empleados/${row.employeeId}`"
              :aria-label="`${row.name}: ver ficha`"
              class="block truncate font-semibold hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              :class="row.employee.is_active ? 'text-highlighted' : 'text-toned'"
            >{{ row.name }}</NuxtLink>
            <ScheduleDayCell
              :day="row.days[index]"
              :header="header"
              detailed
              class="-ms-1.5"
            />
          </div>
          <p
            class="text-end text-xs text-muted"
            data-employee-total
          >
            Semana<br><span class="text-sm font-semibold text-highlighted tabular-nums">{{ formatPlanMinutes(row.totalMinutes) }}</span>
          </p>
        </li>
      </ul>
      <p
        class="border-t border-default bg-elevated/50 px-4 py-3 text-sm text-muted"
        data-week-total
      >
        Total de la tienda esta semana: <span class="font-semibold text-highlighted tabular-nums">{{ formatPlanMinutes(plan.totalMinutes) }}</span>
      </p>
    </section>
  </div>
</template>
