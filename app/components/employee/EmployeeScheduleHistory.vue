<script setup>
// Historial de versiones del horario habitual (solo lectura), de la más
// reciente a la más antigua: periodo de vigencia, si es pasada, vigente o
// futura, y un resumen de la semana. Los cierres («end») son periodos sin
// horario, por ejemplo tras una baja.
defineProps({
  // getScheduleHistory()
  history: { type: Array, required: true },
})

const STATUS = {
  [VERSION_STATUS.CURRENT]: { label: 'Vigente', color: 'primary' },
  [VERSION_STATUS.FUTURE]: { label: 'Próximo', color: 'info' },
  [VERSION_STATUS.PAST]: { label: 'Anterior', color: 'neutral' },
}
</script>

<template>
  <ol
    class="space-y-2.5"
    aria-label="Historial de horarios"
    data-schedule-history
  >
    <li
      v-for="item in history"
      :key="item.id"
      class="rounded-lg px-3.5 py-3 ring ring-default"
      :class="item.status === VERSION_STATUS.PAST ? 'bg-transparent' : 'bg-elevated/50'"
      :data-version-status="item.status"
    >
      <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p class="text-sm font-medium text-highlighted">
          {{ describePeriod(item) }}
        </p>
        <UBadge
          :label="STATUS[item.status].label"
          :color="STATUS[item.status].color"
          variant="subtle"
          size="sm"
        />
      </div>
      <p
        v-if="item.weekly"
        class="mt-1 text-sm text-default"
      >
        {{ summarizeWeek(item.version.week) }}
        <span class="text-muted">· {{ describeWeeklyTotal(item.version.week) }}</span>
      </p>
      <p
        v-else
        class="mt-1 text-sm text-muted"
      >
        Sin horario (desde una baja)
      </p>
    </li>
  </ol>
</template>
