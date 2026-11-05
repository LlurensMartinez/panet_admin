<script setup>
// Navegación entre semanas: anterior, siguiente y volver a la actual.
const props = defineProps({
  weekStart: { type: String, required: true },
  today: { type: String, required: true },
})

const emit = defineEmits(['change'])

const range = computed(() => describeWeekRange(props.weekStart))
const relation = computed(() => describeWeekRelation(props.weekStart, props.today))
const isCurrent = computed(() => props.weekStart === getWeekStart(props.today))
</script>

<template>
  <div
    class="flex flex-wrap items-center justify-between gap-3"
    data-week-nav
  >
    <div class="min-w-0">
      <h2
        class="text-lg font-semibold text-highlighted"
        aria-live="polite"
        data-week-title
      >
        Semana del {{ range }}
      </h2>
      <p
        v-if="relation"
        class="text-sm text-muted"
        data-week-relation
      >
        {{ relation }}
      </p>
    </div>
    <div class="flex items-center gap-1.5">
      <UButton
        icon="i-lucide-chevron-left"
        color="neutral"
        variant="outline"
        aria-label="Semana anterior"
        class="min-h-11 min-w-11 justify-center lg:min-h-9 lg:min-w-9"
        @click="emit('change', shiftWeekStart(weekStart, -1))"
      />
      <UButton
        label="Esta semana"
        color="neutral"
        variant="outline"
        class="min-h-11 lg:min-h-9"
        :disabled="isCurrent"
        @click="emit('change', getWeekStart(today))"
      />
      <UButton
        icon="i-lucide-chevron-right"
        color="neutral"
        variant="outline"
        aria-label="Semana siguiente"
        class="min-h-11 min-w-11 justify-center lg:min-h-9 lg:min-w-9"
        @click="emit('change', shiftWeekStart(weekStart, 1))"
      />
    </div>
  </div>
</template>
