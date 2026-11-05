<script setup>
// Resumen de horas planificadas de la semana (solo consulta): por empleada y
// de la tienda, con el desglose de días. Los datos llegan ya calculados
// (buildWeekSummary).
defineProps({
  // buildWeekSummary()
  summary: { type: Object, required: true },
})

const STATUS_CLASSES = {
  [SUMMARY_STATUS.PLANNED]: 'text-highlighted',
  [SUMMARY_STATUS.ZERO]: 'text-default',
  [SUMMARY_STATUS.NONE]: 'text-dimmed',
}
</script>

<template>
  <div
    class="space-y-5"
    data-week-summary
  >
    <!-- Totales -->
    <dl class="grid gap-3 sm:grid-cols-2">
      <div class="rounded-xl bg-default px-4 py-3 shadow-xs ring ring-default">
        <dt class="text-sm text-muted">
          Horas planificadas de la tienda
        </dt>
        <dd
          class="mt-1 text-2xl font-semibold text-highlighted tabular-nums"
          data-summary-planned-total
        >
          {{ formatPlanMinutes(summary.plannedMinutes) }}
        </dd>
      </div>
      <div class="rounded-xl bg-default px-4 py-3 shadow-xs ring ring-default">
        <dt class="text-sm text-muted">
          Con planificación
        </dt>
        <dd
          class="mt-1 text-2xl font-semibold text-highlighted tabular-nums"
          data-summary-with-planning
        >
          {{ summary.withPlanning }} <span class="text-base font-normal text-muted">de {{ summary.rows.length }}</span>
        </dd>
      </div>
    </dl>

    <!-- Escritorio -->
    <div class="hidden overflow-hidden rounded-xl bg-default shadow-xs ring ring-default md:block">
      <table
        class="w-full table-fixed text-sm"
        data-summary-table
      >
        <caption class="sr-only">
          Horas planificadas por empleada
        </caption>
        <colgroup>
          <col class="w-[32%]">
          <col class="w-[18%]">
          <col>
        </colgroup>
        <thead>
          <tr class="border-b border-default bg-elevated/50 text-start text-xs text-muted">
            <th
              scope="col"
              class="px-4 py-2.5 text-start font-medium"
            >
              Empleada
            </th>
            <th
              scope="col"
              class="px-3 py-2.5 text-end font-medium"
            >
              Planificadas
            </th>
            <th
              scope="col"
              class="px-3 py-2.5 text-start font-medium"
            >
              Días
            </th>
          </tr>
        </thead>
        <tbody class="divide-y divide-default">
          <tr
            v-for="row in summary.rows"
            :key="row.employeeId"
            :data-summary-row="row.employeeId"
            :data-summary-status="row.status"
          >
            <th
              scope="row"
              class="px-4 py-3 text-start align-top font-normal"
            >
              <NuxtLink
                :to="`/empleados/${row.employeeId}`"
                :aria-label="`${row.name}: ver ficha`"
                class="block truncate font-semibold hover:text-primary hover:underline hover:underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                :class="row.employee?.is_active ? 'text-highlighted' : 'text-toned'"
              >{{ row.name }}</NuxtLink>
              <span
                v-if="!row.employee?.is_active"
                class="text-xs text-muted"
              >De baja</span>
            </th>
            <td
              class="px-3 py-3 text-end align-top font-semibold tabular-nums"
              :class="STATUS_CLASSES[row.status]"
              data-summary-planned
            >
              <span
                v-if="row.status === SUMMARY_STATUS.NONE"
                class="text-sm font-normal"
              >Sin planificación</span>
              <template v-else>
                {{ formatPlanMinutes(row.plannedMinutes) }}
              </template>
            </td>
            <td
              class="px-3 py-3 align-top text-muted"
              data-summary-days
            >
              {{ describeWeekDays(row.counts) || '—' }}
              <span
                v-if="row.conflictCount || row.errorCount"
                class="block text-xs font-medium text-amber-800 dark:text-amber-300"
              >Revisa el calendario: {{ row.conflictCount ? 'turnos solapados' : 'hora no válida' }}</span>
            </td>
          </tr>
        </tbody>
        <tfoot>
          <tr class="border-t border-default bg-elevated/50">
            <th
              scope="row"
              class="px-4 py-2.5 text-start font-semibold text-highlighted"
            >
              Total tienda
            </th>
            <td class="px-3 py-2.5 text-end font-semibold text-highlighted tabular-nums">
              {{ formatPlanMinutes(summary.plannedMinutes) }}
            </td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>

    <!-- Móvil -->
    <ul
      class="divide-y divide-default overflow-hidden rounded-xl bg-default shadow-xs ring ring-default md:hidden"
      aria-label="Horas planificadas por empleada"
      data-summary-list
    >
      <li
        v-for="row in summary.rows"
        :key="row.employeeId"
        class="space-y-1 px-4 py-3"
        :data-summary-row="row.employeeId"
        :data-summary-status="row.status"
      >
        <div class="flex items-baseline justify-between gap-3">
          <NuxtLink
            :to="`/empleados/${row.employeeId}`"
            :aria-label="`${row.name}: ver ficha`"
            class="min-w-0 truncate font-semibold hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            :class="row.employee?.is_active ? 'text-highlighted' : 'text-toned'"
          >{{ row.name }}</NuxtLink>
          <span
            class="shrink-0 font-semibold tabular-nums"
            :class="STATUS_CLASSES[row.status]"
            data-summary-planned
          >{{ describePlannedHours(row) }}</span>
        </div>
        <p
          v-if="row.counts"
          class="text-sm text-muted"
          data-summary-days
        >
          {{ describeWeekDays(row.counts) }}
        </p>
      </li>
      <li class="flex items-baseline justify-between gap-3 bg-elevated/50 px-4 py-3 text-sm">
        <span class="font-semibold text-highlighted">Total tienda</span>
        <span class="font-semibold text-highlighted tabular-nums">{{ formatPlanMinutes(summary.plannedMinutes) }} planificadas</span>
      </li>
    </ul>
  </div>
</template>
