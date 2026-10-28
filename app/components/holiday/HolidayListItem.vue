<script setup>
// Un festivo del listado: fecha (día y día de la semana), nombre, ámbito y
// notas. En escritorio, acciones visibles; en móvil, en un menú.
const props = defineProps({
  holiday: { type: Object, required: true },
  pending: { type: Boolean, default: false },
  highlighted: { type: Boolean, default: false },
  past: { type: Boolean, default: false },
})

const emit = defineEmits(['edit', 'delete'])

const parts = computed(() => getHolidayDateParts(props.holiday.holiday_date))
const dayMonth = computed(() => formatHolidayDayMonth(props.holiday.holiday_date))

const menuItems = computed(() => [[
  {
    label: 'Editar',
    icon: 'i-lucide-pencil',
    onSelect: () => emit('edit', props.holiday),
  },
  {
    label: 'Eliminar',
    icon: 'i-lucide-trash-2',
    color: 'error',
    onSelect: () => emit('delete', props.holiday),
  },
]])
</script>

<template>
  <li
    class="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-4 px-4 py-3 motion-safe:transition-colors motion-safe:duration-700 sm:px-5"
    :class="highlighted ? 'bg-primary/8' : 'bg-transparent'"
    :aria-busy="pending || undefined"
  >
    <!-- Fecha -->
    <div
      class="grid w-12 place-items-center rounded-lg py-1.5 leading-none ring ring-inset"
      :class="past ? 'text-muted ring-default' : 'bg-primary/8 text-primary ring-primary/20'"
      aria-hidden="true"
    >
      <span class="text-lg font-semibold tabular-nums">{{ parts.day }}</span>
      <span class="mt-1 text-[0.6875rem] font-medium uppercase tracking-wide">{{ parts.weekday }}</span>
    </div>

    <div class="min-w-0">
      <p
        class="truncate font-semibold"
        :class="past ? 'text-toned' : 'text-highlighted'"
      >
        {{ holiday.name }}
      </p>
      <p class="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-muted">
        <span class="first-letter:uppercase">{{ dayMonth }}</span>
        <span class="whitespace-nowrap"><span aria-hidden="true">·&nbsp;</span>{{ getScopeLabel(holiday.scope) }}</span>
      </p>
      <p
        v-if="holiday.notes"
        class="mt-0.5 line-clamp-2 text-sm text-muted"
      >
        {{ holiday.notes }}
      </p>
    </div>

    <!-- Acciones -->
    <div class="flex items-center justify-end gap-1">
      <UDropdownMenu
        :items="menuItems"
        :content="{ align: 'end' }"
        :disabled="pending"
        class="md:hidden"
      >
        <UButton
          color="neutral"
          variant="ghost"
          icon="i-lucide-ellipsis-vertical"
          :loading="pending"
          :disabled="pending"
          :aria-label="`Acciones para ${holiday.name}`"
          class="md:hidden"
        />
      </UDropdownMenu>
      <UButton
        label="Editar"
        :aria-label="`Editar ${holiday.name}`"
        icon="i-lucide-pencil"
        color="neutral"
        variant="ghost"
        size="sm"
        class="hidden md:inline-flex"
        :disabled="pending"
        @click="emit('edit', holiday)"
      />
      <UButton
        label="Eliminar"
        :aria-label="`Eliminar ${holiday.name}`"
        icon="i-lucide-trash-2"
        color="error"
        variant="ghost"
        size="sm"
        class="hidden md:inline-flex"
        :loading="pending"
        :disabled="pending"
        @click="emit('delete', holiday)"
      />
    </div>
  </li>
</template>
