<script setup>
// Festivos de un año agrupados por mes, en una sola superficie.
const props = defineProps({
  holidays: { type: Array, required: true },
  today: { type: String, required: true },
  pendingIds: { type: Array, default: () => [] },
  highlightedId: { type: String, default: null },
  loading: { type: Boolean, default: false },
})

const emit = defineEmits(['edit', 'delete'])

const groups = computed(() => groupHolidaysByMonth(props.holidays))

const SKELETON_ROWS = 4
</script>

<template>
  <div class="overflow-hidden rounded-xl bg-default shadow-xs ring ring-default">
    <!-- Carga -->
    <ul
      v-if="loading"
      class="divide-y divide-default"
      aria-label="Cargando festivos"
      aria-busy="true"
    >
      <li
        v-for="n in SKELETON_ROWS"
        :key="n"
        class="flex items-center gap-4 px-4 py-3.5 sm:px-5"
      >
        <USkeleton class="h-12 w-12 rounded-lg" />
        <div class="flex-1 space-y-2">
          <USkeleton class="h-3.5 w-44 max-w-[60%]" />
          <USkeleton class="h-3 w-56 max-w-[80%]" />
        </div>
      </li>
    </ul>

    <template v-else>
      <div v-if="groups.length">
        <section
          v-for="group in groups"
          :key="group.key"
          :aria-labelledby="`holidays-${group.key}`"
          class="border-default not-first:border-t"
        >
          <h3
            :id="`holidays-${group.key}`"
            class="bg-muted/60 px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted sm:px-5"
          >
            {{ group.label }}
          </h3>
          <ul
            class="divide-y divide-default"
            :aria-label="`Festivos de ${group.label}`"
          >
            <HolidayListItem
              v-for="holiday in group.holidays"
              :key="holiday.id"
              :holiday="holiday"
              :past="holiday.holiday_date < today"
              :pending="pendingIds.includes(holiday.id)"
              :highlighted="highlightedId === holiday.id"
              @edit="emit('edit', $event)"
              @delete="emit('delete', $event)"
            />
          </ul>
        </section>
      </div>
      <slot
        v-else
        name="empty"
      />
    </template>
  </div>
</template>
