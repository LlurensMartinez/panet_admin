<script setup>
// Confirmación de una acción. Mismo aspecto que la confirmación de
// desactivar empleados (app/components/employee/EmployeeDeactivateModal.vue).
const open = defineModel('open', { type: Boolean, default: false })

defineProps({
  title: { type: String, required: true },
  description: { type: String, default: '' },
  confirmLabel: { type: String, required: true },
  confirmIcon: { type: String, default: undefined },
  confirmColor: { type: String, default: 'neutral' },
  pending: { type: Boolean, default: false },
})

const emit = defineEmits(['confirm'])
</script>

<template>
  <UModal
    v-model:open="open"
    :title="title"
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
        <slot name="description">{{ description }}</slot>
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
        :label="confirmLabel"
        :color="confirmColor"
        :icon="confirmIcon"
        :loading="pending"
        :disabled="pending"
        @click="emit('confirm')"
      />
    </template>
  </UModal>
</template>
