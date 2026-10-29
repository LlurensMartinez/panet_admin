<script setup>
// Un pedido (guardado o previsto) en la agenda o en el historial.
// - Acción principal a la vista y fácil de pulsar en el móvil: «Marcar
//   preparado» si está pendiente; «Volver a pendiente» si no.
// - El resto de acciones, en un menú (y, en pantallas anchas, también a la
//   vista «Editar» y «No se pide»).
// - Si la entrega coincide con un festivo, aviso que recomienda confirmarla;
//   nunca se mueve ni se cancela nada automáticamente.
const props = defineProps({
  item: { type: Object, required: true },
  today: { type: String, required: true },
  // agenda: agrupado por fecha de preparación; history: por entrega.
  context: { type: String, default: 'agenda' },
  pending: { type: Boolean, default: false },
  highlighted: { type: Boolean, default: false },
})

const emit = defineEmits(['prepare', 'reopen', 'skip', 'edit', 'delete'])

const name = computed(() => getOrderSupplierName(props.item))
const isPending = computed(() => props.item.status === ORDER_STATUS.PENDING)
const isOverdue = computed(() => props.context === 'agenda' && isPending.value && props.item.prepare_date < props.today)
const inactive = computed(() => props.item.supplier && props.item.supplier.is_active === false)
const canDelete = computed(() => !props.item.isForecast && isPending.value)
const moved = computed(() =>
  props.item.scheduled_delivery_date && props.item.scheduled_delivery_date !== props.item.delivery_date)
const deliveryText = computed(() => formatShortDate(props.item.delivery_date, props.today))
const prepareText = computed(() => formatShortDate(props.item.prepare_date, props.today))
// En la agenda, la fecha de preparación es la del grupo: solo se repite si
// está atrasado. En el historial se muestra siempre.
const showPrepare = computed(() => props.context === 'history' || isOverdue.value)
const holidayWarning = computed(() => props.item.holidayWarning ?? null)
const preparedText = computed(() => describePreparedAt(props.item.prepared_at, props.today))
const itemLabel = computed(() => `${name.value}, entrega ${deliveryText.value}`)
const holidayActions = computed(() => [{
  'label': 'Cambiar fechas',
  'color': 'warning',
  'variant': 'outline',
  'size': 'sm',
  'aria-label': `Cambiar fechas: ${itemLabel.value}`,
  'onClick': () => emit('edit', props.item),
}])

const menuItems = computed(() => {
  const items = [{
    label: 'Editar fechas y notas',
    icon: 'i-lucide-pencil',
    onSelect: () => emit('edit', props.item),
  }]
  if (isPending.value) {
    items.push({ label: 'No se pide', icon: 'i-lucide-ban', onSelect: () => emit('skip', props.item) })
  }
  else {
    items.push({ label: 'Volver a pendiente', icon: 'i-lucide-undo-2', onSelect: () => emit('reopen', props.item) })
  }
  const groups = [items]
  if (canDelete.value) {
    groups.push([{ label: 'Eliminar', icon: 'i-lucide-trash-2', color: 'error', onSelect: () => emit('delete', props.item) }])
  }
  return groups
})
</script>

<template>
  <li
    class="space-y-3 px-4 py-4 motion-safe:transition-colors motion-safe:duration-700 sm:px-5"
    :class="highlighted ? 'bg-primary/8' : 'bg-transparent'"
    :aria-busy="pending || undefined"
  >
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0 space-y-0.5">
        <p
          class="font-semibold leading-snug"
          :class="item.status === ORDER_STATUS.SKIPPED ? 'text-toned' : 'text-highlighted'"
        >
          {{ name }}
          <span
            v-if="inactive"
            class="ms-1 text-sm font-normal text-muted"
          >(proveedor inactivo)</span>
        </p>
        <p class="text-sm text-muted">
          Entrega: <span class="font-medium text-default">{{ deliveryText }}</span>
          <span class="whitespace-nowrap"> · {{ describeRelativeDay(item.delivery_date, today) }}</span>
        </p>
        <p
          v-if="showPrepare"
          class="text-sm text-muted"
        >
          Preparar: <span class="font-medium text-default">{{ prepareText }}</span>
          <span
            v-if="context === 'agenda'"
            class="whitespace-nowrap"
          > · {{ describeRelativeDay(item.prepare_date, today) }}</span>
        </p>
        <p
          v-if="moved"
          class="text-xs text-muted"
        >
          Fecha cambiada; prevista por el calendario: {{ formatShortDate(item.scheduled_delivery_date, today) }}
        </p>
      </div>
      <OrderStatusBadge
        :status="item.status"
        :overdue="isOverdue"
      />
    </div>

    <UAlert
      v-if="holidayWarning"
      color="warning"
      variant="subtle"
      icon="i-lucide-calendar-x-2"
      :description="holidayWarning.message"
      :actions="holidayActions"
      orientation="vertical"
      :ui="{ root: 'p-3', description: 'text-sm text-default' }"
    />

    <p
      v-if="item.notes"
      class="line-clamp-3 whitespace-pre-line text-pretty text-sm text-default"
    >
      {{ item.notes }}
    </p>

    <p
      v-if="preparedText"
      class="text-xs text-muted"
    >
      {{ preparedText }}
    </p>

    <div class="flex items-center gap-2">
      <UButton
        v-if="isPending"
        label="Marcar preparado"
        :aria-label="`Marcar preparado: ${itemLabel}`"
        icon="i-lucide-check"
        size="lg"
        class="min-h-11 flex-1 justify-center sm:flex-none lg:min-h-0"
        :loading="pending"
        :disabled="pending"
        @click="emit('prepare', item)"
      />
      <UButton
        v-else
        label="Volver a pendiente"
        :aria-label="`Volver a pendiente: ${itemLabel}`"
        icon="i-lucide-undo-2"
        color="neutral"
        variant="outline"
        size="lg"
        class="min-h-11 flex-1 justify-center sm:flex-none lg:min-h-0"
        :loading="pending"
        :disabled="pending"
        @click="emit('reopen', item)"
      />
      <UButton
        v-if="isPending"
        label="No se pide"
        :aria-label="`No se pide: ${itemLabel}`"
        icon="i-lucide-ban"
        color="neutral"
        variant="ghost"
        size="lg"
        class="hidden min-h-11 sm:inline-flex lg:min-h-0"
        :disabled="pending"
        @click="emit('skip', item)"
      />
      <UButton
        label="Editar"
        :aria-label="`Editar fechas y notas: ${itemLabel}`"
        icon="i-lucide-pencil"
        color="neutral"
        variant="ghost"
        size="lg"
        class="hidden min-h-11 sm:inline-flex lg:min-h-0"
        :disabled="pending"
        @click="emit('edit', item)"
      />
      <UDropdownMenu
        :items="menuItems"
        :content="{ align: 'end' }"
        :disabled="pending"
      >
        <UButton
          icon="i-lucide-ellipsis-vertical"
          color="neutral"
          variant="outline"
          size="lg"
          class="min-h-11 min-w-11 justify-center lg:min-h-0 lg:min-w-0"
          :aria-label="`Más acciones: ${itemLabel}`"
          :disabled="pending"
        />
      </UDropdownMenu>
    </div>
  </li>
</template>
