<script setup>
// Estado de la ficha: punto + texto. Discreto para no competir con el nombre
// y sin depender solo del color (punto relleno = activo, hueco = inactivo, y
// siempre la palabra).
defineProps({
  active: { type: Boolean, required: true },
})
</script>

<template>
  <span
    class="inline-flex items-center gap-2 whitespace-nowrap text-sm"
    :class="active ? 'text-toned' : 'text-muted'"
  >
    <span
      class="size-2 shrink-0 rounded-full"
      :class="active ? 'bg-success' : 'ring-[1.5px] ring-current ring-inset'"
      aria-hidden="true"
    />
    {{ active ? 'Activo' : 'Inactivo' }}
  </span>
</template>
