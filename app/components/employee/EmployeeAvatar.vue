<script setup>
// Iniciales del empleado. Decorativo: el nombre ya aparece al lado.
const props = defineProps({
  employee: { type: Object, required: true },
})

const initials = computed(() => getEmployeeInitials(props.employee))
</script>

<template>
  <span
    class="grid size-10 shrink-0 place-items-center rounded-full text-sm font-semibold tracking-wide"
    :class="employee.is_active
      ? 'bg-primary/10 text-primary'
      : 'bg-elevated text-muted'"
    aria-hidden="true"
  >
    {{ initials }}
  </span>
</template>
