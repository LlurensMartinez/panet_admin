<script setup>
// Un registro de horas extra. En escritorio, columnas alineadas con la
// cabecera de OvertimeList; en móvil, empleado, fecha y motivo apilados, la
// duración a la derecha y las acciones en un menú.
const props = defineProps({
  entry: { type: Object, required: true },
  pending: { type: Boolean, default: false },
  highlighted: { type: Boolean, default: false },
})

const emit = defineEmits(['edit', 'delete'])

const employeeName = computed(() => getEntryEmployeeName(props.entry))
const dateText = computed(() => formatWorkDate(props.entry.work_date, 'short'))
const dateLong = computed(() => formatWorkDate(props.entry.work_date, 'long'))
const actionTarget = computed(() => `${employeeName.value}, ${dateLong.value}`)

const menuItems = computed(() => [[
  { label: 'Editar', icon: 'i-lucide-pencil', onSelect: () => emit('edit', props.entry) },
  { label: 'Eliminar', icon: 'i-lucide-trash-2', color: 'error', onSelect: () => emit('delete', props.entry) },
]])
</script>

<template>
  <li
    class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-4 py-3.5 motion-safe:transition-colors motion-safe:duration-700 sm:px-5 lg:grid-cols-[minmax(0,1.3fr)_9.5rem_7rem_minmax(0,1.2fr)_12rem]"
    :class="highlighted ? 'bg-primary/8' : 'bg-transparent'"
    :aria-busy="pending || undefined"
  >
    <!-- Empleado (y, en móvil, fecha y motivo) -->
    <div class="flex min-w-0 items-center gap-3.5">
      <EmployeeAvatar
        v-if="entry.employee"
        :employee="entry.employee"
      />
      <div class="min-w-0">
        <p class="truncate font-semibold text-highlighted">
          {{ employeeName }}
          <span
            v-if="entry.employee && !entry.employee.is_active"
            class="ms-1 text-xs font-medium text-muted"
          >(inactivo)</span>
        </p>
        <p class="truncate text-sm text-muted lg:hidden">
          <time :datetime="entry.work_date">{{ dateText }}</time>
        </p>
        <p
          v-if="entry.reason"
          class="truncate text-sm text-toned lg:hidden"
        >
          {{ entry.reason }}
        </p>
      </div>
    </div>

    <!-- Fecha (escritorio) -->
    <p class="hidden text-sm text-default lg:block">
      <time :datetime="entry.work_date">{{ dateText }}</time>
    </p>

    <!-- Duración + menú (móvil) -->
    <div class="flex items-center justify-end gap-1.5 lg:justify-start">
      <p class="whitespace-nowrap font-semibold text-highlighted tabular-nums">
        {{ formatDuration(entry.duration_minutes) }}
      </p>
      <UDropdownMenu
        :items="menuItems"
        :content="{ align: 'end' }"
        :disabled="pending"
        class="lg:hidden"
      >
        <UButton
          color="neutral"
          variant="ghost"
          icon="i-lucide-ellipsis-vertical"
          :loading="pending"
          :disabled="pending"
          :aria-label="`Acciones para el registro de ${actionTarget}`"
          class="lg:hidden"
        />
      </UDropdownMenu>
    </div>

    <!-- Motivo (escritorio) -->
    <p
      class="hidden truncate text-sm lg:block"
      :title="entry.reason || undefined"
    >
      <span
        v-if="entry.reason"
        class="text-default"
      >{{ entry.reason }}</span>
      <span
        v-else
        class="text-dimmed"
      >Sin motivo</span>
    </p>

    <!-- Acciones (escritorio) -->
    <div class="hidden items-center justify-end gap-1 lg:flex">
      <UButton
        label="Editar"
        :aria-label="`Editar el registro de ${actionTarget}`"
        icon="i-lucide-pencil"
        color="neutral"
        variant="ghost"
        size="sm"
        :disabled="pending"
        @click="emit('edit', entry)"
      />
      <UButton
        label="Eliminar"
        :aria-label="`Eliminar el registro de ${actionTarget}`"
        icon="i-lucide-trash-2"
        color="neutral"
        variant="ghost"
        size="sm"
        :loading="pending"
        :disabled="pending"
        @click="emit('delete', entry)"
      />
    </div>
  </li>
</template>
