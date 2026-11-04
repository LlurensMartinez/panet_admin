<script setup>
// Una fila del listado de proveedores. En escritorio, columnas alineadas con
// la cabecera de SupplierList; en móvil, nombre y calendario apilados y las
// acciones en un menú. El nombre lleva a la ficha del proveedor, con sus
// productos habituales.
const props = defineProps({
  supplier: { type: Object, required: true },
  pending: { type: Boolean, default: false },
  highlighted: { type: Boolean, default: false },
})

const emit = defineEmits(['edit', 'toggle-active'])

const toggleLabel = computed(() => props.supplier.is_active ? 'Desactivar' : 'Activar')
const preparationText = computed(() => describeSupplierPreparationShort(props.supplier))
const leadText = computed(() => {
  if (!preparationText.value) return 'Sin entregas habituales'
  return isOnDemand(props.supplier) ? preparationText.value : `Prepara: ${preparationText.value.charAt(0).toLowerCase()}${preparationText.value.slice(1)}`
})
const deadlineText = computed(() => {
  const time = formatDeadline(props.supplier.order_deadline)
  return time ? `Antes de las ${Number(time.slice(0, 2))}:${time.slice(3)}` : ''
})

const productsPath = computed(() => `/pedidos/proveedores/${props.supplier.id}`)

const menuItems = computed(() => [[
  {
    label: 'Productos',
    icon: 'i-lucide-package',
    to: productsPath.value,
  },
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
        <NuxtLink
          :to="productsPath"
          :aria-label="`${supplier.name}: ver productos habituales`"
          class="group inline-flex max-w-full items-center gap-1 rounded-sm hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <span class="truncate group-hover:underline group-hover:underline-offset-4">{{ supplier.name }}</span>
          <UIcon
            name="i-lucide-chevron-right"
            class="size-4 shrink-0 text-dimmed group-hover:text-primary"
            aria-hidden="true"
          />
        </NuxtLink>
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
        <span
          v-if="deadlineText"
          class="inline-flex items-center gap-1 text-sm text-muted"
        >
          <UIcon
            name="i-lucide-clock"
            class="size-3.5 text-dimmed"
            aria-hidden="true"
          />
          {{ deadlineText }}
        </span>
      </div>
    </div>

    <!-- Entregas (escritorio) -->
    <div class="hidden md:block">
      <SupplierWeekdayChips :days="supplier.delivery_weekdays" />
    </div>

    <!-- Preparación (escritorio) -->
    <div class="hidden min-w-0 text-sm md:block">
      <p
        v-if="preparationText"
        class="truncate text-default"
        :title="preparationText"
      >
        {{ preparationText }}
      </p>
      <p
        v-else
        class="text-dimmed"
      >
        —
      </p>
      <p
        v-if="deadlineText"
        class="flex items-center gap-1 truncate text-xs text-muted"
      >
        <UIcon
          name="i-lucide-clock"
          class="size-3 shrink-0 text-dimmed"
          aria-hidden="true"
        />
        {{ deadlineText }}
      </p>
    </div>

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
