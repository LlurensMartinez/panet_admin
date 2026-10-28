<script setup>
// Una fila del listado de proveedores. En escritorio, columnas alineadas con
// la cabecera de SupplierList; en móvil, nombre y calendario apilados y las
// acciones en un menú.
const props = defineProps({
  supplier: { type: Object, required: true },
  pending: { type: Boolean, default: false },
  highlighted: { type: Boolean, default: false },
})

const emit = defineEmits(['edit', 'toggle-active'])

const toggleLabel = computed(() => props.supplier.is_active ? 'Desactivar' : 'Activar')
const hasDeliveries = computed(() => normalizeWeekdays(props.supplier.delivery_weekdays).length > 0)
const leadText = computed(() => hasDeliveries.value
  ? `Prepara: ${describeLeadDays(props.supplier.order_lead_days).toLowerCase()}`
  : 'Sin entregas habituales')

const menuItems = computed(() => [[
  {
    label: 'Editar',
    icon: 'i-lucide-pencil',
    onSelect: () => emit('edit', props.supplier),
  },
  {
    label: toggleLabel.value,
    icon: props.supplier.is_active ? 'i-lucide-circle-pause' : 'i-lucide-circle-play',
    onSelect: () => emit('toggle-active', props.supplier),
  },
]])
</script>

<template>
  <li
    class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 py-3.5 motion-safe:transition-colors motion-safe:duration-700 sm:px-5 md:grid-cols-[minmax(0,1.4fr)_auto_minmax(0,1fr)_6.5rem_13rem]"
    :class="highlighted ? 'bg-primary/8' : 'bg-transparent'"
    :aria-busy="pending || undefined"
  >
    <!-- Nombre (y, en móvil, calendario) -->
    <div class="min-w-0 space-y-1.5">
      <p
        class="truncate font-semibold"
        :class="supplier.is_active ? 'text-highlighted' : 'text-toned'"
      >
        {{ supplier.name }}
      </p>
      <p
        v-if="supplier.notes"
        class="hidden truncate text-sm text-muted md:block"
      >
        {{ supplier.notes }}
      </p>
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1 md:hidden">
        <SupplierWeekdayChips :days="supplier.delivery_weekdays" />
        <span class="text-sm text-muted">{{ leadText }}</span>
      </div>
    </div>

    <!-- Entregas (escritorio) -->
    <div class="hidden md:block">
      <SupplierWeekdayChips :days="supplier.delivery_weekdays" />
    </div>

    <!-- Preparación (escritorio) -->
    <p class="hidden truncate text-sm md:block">
      <span
        v-if="hasDeliveries"
        class="text-default"
      >{{ describeLeadDays(supplier.order_lead_days) }}</span>
      <span
        v-else
        class="text-dimmed"
      >—</span>
    </p>

    <!-- Estado + menú (móvil) -->
    <div class="flex items-center justify-end gap-1.5 self-start md:justify-start md:self-center">
      <EmployeeStatusBadge :active="supplier.is_active" />
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
          :aria-label="`Acciones para ${supplier.name}`"
          class="-my-1.5 md:hidden"
        />
      </UDropdownMenu>
    </div>

    <!-- Acciones (escritorio) -->
    <div class="hidden items-center justify-end gap-1 md:flex">
      <UButton
        label="Editar"
        :aria-label="`Editar ${supplier.name}`"
        icon="i-lucide-pencil"
        color="neutral"
        variant="ghost"
        size="sm"
        :disabled="pending"
        @click="emit('edit', supplier)"
      />
      <UButton
        :label="toggleLabel"
        :aria-label="`${toggleLabel} ${supplier.name}`"
        :icon="supplier.is_active ? 'i-lucide-circle-pause' : 'i-lucide-circle-play'"
        :color="supplier.is_active ? 'neutral' : 'primary'"
        variant="ghost"
        size="sm"
        class="w-28"
        :loading="pending"
        :disabled="pending"
        @click="emit('toggle-active', supplier)"
      />
    </div>
  </li>
</template>
