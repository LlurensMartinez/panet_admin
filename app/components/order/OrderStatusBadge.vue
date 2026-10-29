<script setup>
// Estado de un pedido: icono + texto (no depende solo del color).
// Un pendiente con la preparación ya pasada se muestra como «Atrasado».
const props = defineProps({
  status: { type: String, required: true },
  overdue: { type: Boolean, default: false },
})

const look = computed(() => {
  if (props.status === ORDER_STATUS.PREPARED) return { label: 'Preparado', color: 'success', icon: 'i-lucide-circle-check' }
  if (props.status === ORDER_STATUS.SKIPPED) return { label: 'No se pide', color: 'neutral', icon: 'i-lucide-ban' }
  if (props.overdue) return { label: 'Atrasado', color: 'warning', icon: 'i-lucide-alarm-clock' }
  return { label: 'Pendiente', color: 'neutral', icon: 'i-lucide-clock' }
})
</script>

<template>
  <UBadge
    :label="look.label"
    :color="look.color"
    :icon="look.icon"
    variant="subtle"
    class="shrink-0 whitespace-nowrap"
  />
</template>
