<script setup>
// Periodos rápidos (Hoy, Semanal, Mensual, Anual, Personalizado). Mismo
// control que el filtro de estado de Empleados: botones de opción nativos,
// que funcionan con el teclado (flechas) y con lectores de pantalla.
// Sin ninguna opción marcada = sin filtro de fechas.
const model = defineModel({ type: String, default: null })

defineProps({
  disabled: { type: Boolean, default: false },
})

const groupName = useId()
</script>

<template>
  <fieldset
    class="min-w-0"
    :disabled="disabled"
  >
    <legend class="mb-1 block text-sm font-medium text-default">
      Periodo
    </legend>
    <!-- En móvil, dos filas (3 + 2) para no desbordar; desde sm, una sola. -->
    <div class="grid grid-cols-3 gap-1 rounded-lg bg-elevated p-1 sm:flex sm:gap-0">
      <label
        v-for="option in OVERTIME_PERIOD_OPTIONS"
        :key="option.value"
        class="relative min-w-0 cursor-pointer has-disabled:cursor-not-allowed has-disabled:opacity-75"
        :class="option.value === OVERTIME_PERIOD.CUSTOM ? 'col-span-2' : ''"
      >
        <input
          v-model="model"
          type="radio"
          class="peer sr-only"
          :name="groupName"
          :value="option.value"
        >
        <span
          class="flex h-7 items-center justify-center whitespace-nowrap rounded-md px-3 text-sm font-medium text-muted transition-colors hover:text-highlighted peer-checked:bg-default peer-checked:text-highlighted peer-checked:shadow-xs peer-checked:ring peer-checked:ring-default peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary"
        >
          {{ option.label }}
        </span>
      </label>
    </div>
  </fieldset>
</template>
