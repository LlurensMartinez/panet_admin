<script setup>
// Un producto habitual del proveedor. En escritorio, columnas alineadas con
// la cabecera de ProductList; en móvil, nombre y cantidad apilados y las
// acciones en un menú (mismo patrón que proveedores y empleados).
const props = defineProps({
  product: { type: Object, required: true },
  pending: { type: Boolean, default: false },
  highlighted: { type: Boolean, default: false },
})

const emit = defineEmits(['edit', 'toggle-active'])

const quantity = computed(() => formatProductQuantity(props.product))
const toggleLabel = computed(() => props.product.is_active ? 'Desactivar' : 'Activar')

const menuItems = computed(() => [[
  {
    label: 'Editar',
    icon: 'i-lucide-pencil',
    onSelect: () => emit('edit', props.product),
  },
  {
    label: toggleLabel.value,
    icon: props.product.is_active ? 'i-lucide-circle-pause' : 'i-lucide-circle-play',
    onSelect: () => emit('toggle-active', props.product),
  },
]])
</script>

<template>
  <li
    class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-4 py-3.5 motion-safe:transition-colors motion-safe:duration-700 sm:px-5 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_6.5rem_13rem]"
    :class="highlighted ? 'bg-primary/8' : 'bg-transparent'"
    :aria-busy="pending || undefined"
  >
    <!-- Nombre (y, en móvil, cantidad habitual) -->
    <div class="min-w-0">
      <p
        class="truncate font-semibold"
        :class="product.is_active ? 'text-highlighted' : 'text-toned'"
      >
        {{ product.name }}
      </p>
      <p class="truncate text-sm text-muted md:hidden">
        Habitual: <span class="font-medium text-default">{{ quantity }}</span>
      </p>
    </div>

    <!-- Cantidad habitual (escritorio) -->
    <p class="hidden truncate text-sm text-default md:block">
      {{ quantity }}
    </p>

    <!-- Estado + menú (móvil) -->
    <div class="flex items-center justify-end gap-1.5 md:justify-start">
      <EmployeeStatusBadge :active="product.is_active" />
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
          :aria-label="`Acciones para ${product.name}`"
          class="md:hidden"
        />
      </UDropdownMenu>
    </div>

    <!-- Acciones (escritorio) -->
    <div class="hidden items-center justify-end gap-1 md:flex">
      <UButton
        label="Editar"
        :aria-label="`Editar ${product.name}`"
        icon="i-lucide-pencil"
        color="neutral"
        variant="ghost"
        size="sm"
        :disabled="pending"
        @click="emit('edit', product)"
      />
      <UButton
        :label="toggleLabel"
        :aria-label="`${toggleLabel} ${product.name}`"
        :icon="product.is_active ? 'i-lucide-circle-pause' : 'i-lucide-circle-play'"
        :color="product.is_active ? 'neutral' : 'primary'"
        variant="ghost"
        size="sm"
        class="w-28"
        :loading="pending"
        :disabled="pending"
        @click="emit('toggle-active', product)"
      />
    </div>
  </li>
</template>
