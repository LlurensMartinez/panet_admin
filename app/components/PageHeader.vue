<script setup>
// Cabecera de las páginas de la aplicación: título, descripción breve y
// acciones principales a la derecha (debajo en pantallas estrechas).
defineProps({
  title: { type: String, required: true },
  description: { type: String, default: '' },
})
</script>

<template>
  <header class="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
    <div class="min-w-0 max-w-2xl">
      <h1 class="text-[1.75rem] font-semibold leading-tight tracking-tight text-highlighted sm:text-[2rem]">
        {{ title }}
      </h1>
      <p
        v-if="description"
        class="mt-1.5 text-pretty text-[0.9375rem] leading-relaxed text-muted"
      >
        {{ description }}
      </p>
    </div>

    <div
      v-if="$slots.actions"
      class="flex shrink-0 items-center gap-2"
    >
      <slot name="actions" />
    </div>
  </header>
</template>
