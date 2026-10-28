<script setup>
// Selector de días de entrega: siete casillas nativas (L M X J V S D) con
// aspecto de botón. Se pueden marcar varios días o ninguno. Funcionan con el
// teclado (Tab y espacio) y los lectores de pantalla leen el nombre completo
// del día.
const model = defineModel({ type: Array, default: () => [] })

defineProps({
  // Nombre del grupo para lectores de pantalla (la etiqueta visible la pone
  // UFormField, que no se puede asociar a un grupo de casillas).
  legend: { type: String, default: 'Días de entrega' },
  disabled: { type: Boolean, default: false },
  invalid: { type: Boolean, default: false },
})

function isChecked(day) {
  return model.value.includes(day)
}

function toggle(day, checked) {
  const next = checked
    ? [...model.value, day]
    : model.value.filter(value => value !== day)
  model.value = normalizeWeekdays(next)
}
</script>

<template>
  <fieldset class="grid min-w-0 grid-cols-7 gap-1.5">
    <legend class="sr-only">
      {{ legend }}
    </legend>
    <label
      v-for="day in WEEKDAYS"
      :key="day.value"
      class="relative"
      :class="disabled ? 'cursor-not-allowed opacity-75' : 'cursor-pointer'"
    >
      <input
        type="checkbox"
        class="peer sr-only"
        :value="day.value"
        :checked="isChecked(day.value)"
        :disabled="disabled"
        :aria-invalid="invalid || undefined"
        @change="toggle(day.value, $event.target.checked)"
      >
      <span
        class="flex h-11 select-none items-center justify-center rounded-lg text-sm font-semibold ring ring-inset transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary"
        :class="isChecked(day.value)
          ? 'bg-primary text-inverted ring-primary'
          : invalid
            ? 'bg-default text-toned ring-error'
            : 'bg-default text-toned ring-accented hover:bg-elevated'"
      >
        <span aria-hidden="true">{{ day.short }}</span>
        <span class="sr-only">{{ day.label }}</span>
      </span>
    </label>
  </fieldset>
</template>
