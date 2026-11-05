<script setup>
// Una fila del listado. En escritorio, columnas alineadas con la cabecera
// de EmployeeList; en móvil, nombre y puesto apilados y las acciones en un
// menú. El nombre enlaza con la ficha de la empleada (/empleados/[id]).
const props = defineProps({
  employee: { type: Object, required: true },
  pending: { type: Boolean, default: false },
  highlighted: { type: Boolean, default: false },
})

const emit = defineEmits(['edit', 'toggle-active'])

const fullName = computed(() => getEmployeeFullName(props.employee))
const toggleLabel = computed(() => props.employee.is_active ? 'Desactivar' : 'Activar')

const menuItems = computed(() => [[
  {
    label: 'Editar',
    icon: 'i-lucide-pencil',
    onSelect: () => emit('edit', props.employee),
  },
  {
    label: toggleLabel.value,
    icon: props.employee.is_active ? 'i-lucide-circle-pause' : 'i-lucide-circle-play',
    onSelect: () => emit('toggle-active', props.employee),
  },
]])
</script>

<template>
  <li
    class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-4 py-3.5 motion-safe:transition-colors motion-safe:duration-700 sm:px-5 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_7.5rem_13rem]"
    :class="highlighted ? 'bg-primary/8' : 'bg-transparent'"
    :aria-busy="pending || undefined"
  >
    <!-- Nombre (y, en móvil, puesto) -->
    <div class="flex min-w-0 items-center gap-3.5">
      <EmployeeAvatar :employee="employee" />
      <div class="min-w-0">
        <p
          class="truncate font-semibold"
          :class="employee.is_active ? 'text-highlighted' : 'text-toned'"
        >
          <NuxtLink
            :to="`/empleados/${employee.id}`"
            :aria-label="`${fullName}: ver ficha`"
            class="group inline-flex max-w-full items-center gap-1 rounded-sm hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            data-employee-link
          >
            <span class="truncate group-hover:underline group-hover:underline-offset-4">{{ fullName }}</span>
            <UIcon
              name="i-lucide-chevron-right"
              class="size-4 shrink-0 text-dimmed group-hover:text-primary"
              aria-hidden="true"
            />
          </NuxtLink>
        </p>
        <p class="truncate text-sm text-muted md:hidden">
          <span v-if="employee.role">{{ employee.role }}</span>
          <span
            v-else
            class="text-dimmed"
          >Sin puesto</span>
        </p>
      </div>
    </div>

    <!-- Puesto (escritorio) -->
    <p class="hidden truncate text-sm md:block">
      <span
        v-if="employee.role"
        class="text-default"
      >{{ employee.role }}</span>
      <span
        v-else
        class="text-dimmed"
      >Sin puesto</span>
    </p>

    <!-- Estado + menú (móvil) -->
    <div class="flex items-center justify-end gap-1.5 md:justify-start">
      <EmployeeStatusBadge :active="employee.is_active" />
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
          :aria-label="`Acciones para ${fullName}`"
          class="md:hidden"
        />
      </UDropdownMenu>
    </div>

    <!-- Acciones (escritorio) -->
    <div class="hidden items-center justify-end gap-1 md:flex">
      <UButton
        label="Editar"
        :aria-label="`Editar a ${fullName}`"
        icon="i-lucide-pencil"
        color="neutral"
        variant="ghost"
        size="sm"
        :disabled="pending"
        @click="emit('edit', employee)"
      />
      <UButton
        :label="toggleLabel"
        :aria-label="`${toggleLabel} a ${fullName}`"
        :icon="employee.is_active ? 'i-lucide-circle-pause' : 'i-lucide-circle-play'"
        :color="employee.is_active ? 'neutral' : 'primary'"
        variant="ghost"
        size="sm"
        class="w-28"
        :loading="pending"
        :disabled="pending"
        @click="emit('toggle-active', employee)"
      />
    </div>
  </li>
</template>
