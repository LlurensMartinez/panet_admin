<script setup>
// Cuadrícula semanal (escritorio): una fila por empleada, los 7 días en
// columnas y el total semanal; al pie, el total de la tienda por día y de la
// semana. Solo lectura. Los datos llegan ya resueltos (buildWeekPlan).
defineProps({
  plan: { type: Object, required: true },
  headers: { type: Array, required: true },
})
</script>

<template>
  <div
    class="overflow-hidden rounded-xl bg-default shadow-xs ring ring-default"
    data-week-grid
  >
    <table class="w-full table-fixed border-collapse text-sm">
      <caption class="sr-only">
        Horarios de la semana por empleada
      </caption>
      <colgroup>
        <col class="w-44 xl:w-52">
        <col
          v-for="header in headers"
          :key="header.date"
        >
        <col class="w-20">
      </colgroup>
      <thead>
        <tr class="border-b border-default bg-elevated/50">
          <th
            scope="col"
            class="px-4 py-2.5 text-start text-xs font-medium text-muted"
          >
            Empleada
          </th>
          <th
            v-for="header in headers"
            :key="header.date"
            scope="col"
            class="px-1.5 py-2 text-start align-top font-medium"
            :class="header.isToday ? 'bg-primary/8' : ''"
            :data-day-header="header.date"
          >
            <span
              class="block text-xs uppercase tracking-wide"
              :class="header.isToday ? 'text-primary' : 'text-muted'"
            >{{ header.abbr }}<span class="sr-only"> ({{ header.label }})</span></span>
            <span
              class="block text-base font-semibold"
              :class="header.isToday ? 'text-primary' : 'text-highlighted'"
            >{{ header.dayNumber }}<span
              v-if="header.isToday"
              class="sr-only"
            >, hoy</span></span>
            <span
              v-if="header.holiday"
              class="mt-0.5 block truncate text-[0.6875rem] font-medium text-amber-800 dark:text-amber-300"
              :title="header.holiday.name"
              data-day-holiday
            >Festivo<span class="sr-only">: {{ header.holiday.name }}</span></span>
          </th>
          <th
            scope="col"
            class="px-3 py-2.5 text-end text-xs font-medium text-muted"
          >
            Semana
          </th>
        </tr>
      </thead>
      <tbody class="divide-y divide-default">
        <tr
          v-for="row in plan.rows"
          :key="row.employeeId"
          :data-employee-row="row.employeeId"
        >
          <th
            scope="row"
            class="px-4 py-2.5 text-start align-top font-normal"
          >
            <NuxtLink
              :to="`/empleados/${row.employeeId}`"
              :aria-label="`${row.name}: ver ficha`"
              class="block truncate font-semibold hover:text-primary hover:underline hover:underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              :class="row.employee.is_active ? 'text-highlighted' : 'text-toned'"
            >{{ row.name }}</NuxtLink>
            <span
              v-if="!row.employee.is_active"
              class="text-xs text-muted"
            >De baja</span>
            <span
              v-else-if="row.employee.role"
              class="block truncate text-xs text-muted"
            >{{ row.employee.role }}</span>
          </th>
          <td
            v-for="(day, index) in row.days"
            :key="day.date"
            class="px-1 py-1.5 align-top"
            :class="headers[index].isToday ? 'bg-primary/4' : ''"
          >
            <ScheduleDayCell
              :day="day"
              :header="headers[index]"
            />
          </td>
          <td
            class="px-3 py-2.5 text-end align-top font-semibold text-highlighted tabular-nums"
            data-employee-total
          >
            {{ formatPlanMinutes(row.totalMinutes) }}
          </td>
        </tr>
      </tbody>
      <tfoot>
        <tr class="border-t border-default bg-elevated/50">
          <th
            scope="row"
            class="px-4 py-2.5 text-start text-sm font-semibold text-highlighted"
          >
            Total tienda
          </th>
          <td
            v-for="(minutes, index) in plan.dayTotals"
            :key="headers[index].date"
            class="px-2.5 py-2.5 text-sm font-medium text-default tabular-nums"
            :data-day-total="headers[index].date"
          >
            {{ formatPlanMinutes(minutes) }}
          </td>
          <td
            class="px-3 py-2.5 text-end font-semibold text-highlighted tabular-nums"
            data-week-total
          >
            {{ formatPlanMinutes(plan.totalMinutes) }}
          </td>
        </tr>
      </tfoot>
    </table>
  </div>
</template>
