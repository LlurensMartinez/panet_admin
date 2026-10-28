<script setup>
// Ámbito del festivo (nacional, autonómico o local): botones de opción
// nativos con el mismo aspecto que los filtros por estado. Caben los tres en
// una fila también en móvil.
const model = defineModel({ type: String, required: true })

defineProps({
  disabled: { type: Boolean, default: false },
})

const groupName = useId()
</script>

<template>
  <fieldset class="min-w-0">
    <legend class="sr-only">
      Ámbito
    </legend>
    <div class="flex w-full rounded-lg bg-elevated p-1 sm:inline-flex sm:w-auto">
      <label
        v-for="scope in HOLIDAY_SCOPES"
        :key="scope.value"
        class="relative flex-1 sm:flex-none"
        :class="disabled ? 'cursor-not-allowed' : 'cursor-pointer'"
      >
        <input
          v-model="model"
          type="radio"
          class="peer sr-only"
          :name="groupName"
          :value="scope.value"
          :disabled="disabled"
        >
        <span
          class="flex h-10 items-center justify-center rounded-md px-3.5 text-sm font-medium text-muted transition-colors hover:text-highlighted peer-checked:bg-default peer-checked:text-highlighted peer-checked:shadow-xs peer-checked:ring peer-checked:ring-default peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary"
        >
          {{ scope.label }}
        </span>
      </label>
    </div>
  </fieldset>
</template>
