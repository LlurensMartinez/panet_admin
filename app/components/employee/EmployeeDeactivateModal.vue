<script setup>
// Confirmación antes de desactivar. Explica que la ficha y su historial se
// conservan: desactivar no borra nada.
const open = defineModel('open', { type: Boolean, default: false })

const props = defineProps({
  employee: { type: Object, default: null },
  pending: { type: Boolean, default: false },
})

const emit = defineEmits(['confirm'])

const fullName = computed(() => getEmployeeFullName(props.employee))
</script>

<template>
  <UModal
    v-model:open="open"
    :title="`¿Desactivar a ${fullName}?`"
    :dismissible="!pending"
    :close="false"
    :ui="{
      content: 'sm:max-w-md',
      title: 'font-display text-lg font-semibold',
      footer: 'justify-end gap-2',
    }"
  >
    <template #description>
      <span class="block text-pretty">
        Dejará de aparecer entre los empleados activos. Su ficha y su historial de horas extra se conservan, y puedes volver a activarla cuando quieras desde «Inactivos».
      </span>
    </template>

    <template #footer>
      <UButton
        label="Cancelar"
        color="neutral"
        variant="ghost"
        :disabled="pending"
        @click="open = false"
      />
      <UButton
        label="Desactivar"
        color="neutral"
        icon="i-lucide-circle-pause"
        :loading="pending"
        :disabled="pending"
        @click="emit('confirm')"
      />
    </template>
  </UModal>
</template>
