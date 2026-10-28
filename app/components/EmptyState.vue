<script setup>
// Estado vacío o de error dentro de una lista: icono, título, explicación y
// una acción para salir de él.
defineProps({
  icon: { type: String, default: 'i-lucide-inbox' },
  title: { type: String, required: true },
  description: { type: String, default: '' },
  tone: { type: String, default: 'neutral' }, // neutral | error
})
</script>

<template>
  <div class="flex flex-col items-center px-6 py-14 text-center sm:py-16">
    <span
      class="grid size-12 place-items-center rounded-full ring-8"
      :class="tone === 'error'
        ? 'bg-error/10 text-error ring-error/5'
        : 'bg-primary/10 text-primary ring-primary/5'"
      aria-hidden="true"
    >
      <UIcon
        :name="icon"
        class="size-6"
      />
    </span>
    <h2 class="mt-5 text-lg font-semibold text-highlighted">
      {{ title }}
    </h2>
    <p
      v-if="description"
      class="mt-1.5 max-w-sm text-pretty text-sm leading-relaxed text-muted"
    >
      {{ description }}
    </p>
    <div
      v-if="$slots.default"
      class="mt-6 flex flex-wrap justify-center gap-2"
    >
      <slot />
    </div>
  </div>
</template>
