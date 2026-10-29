<script setup>
// Navegación entre las secciones de Pedidos: pedidos (agenda e historial),
// proveedores y festivos.
// Son páginas distintas (enlaces, no pestañas), con el mismo aspecto que las
// pestañas de Horas extra. En móvil se ocultan los iconos para que las tres
// quepan sin cortarse.
const route = useRoute()

const SECTIONS = [
  { label: 'Pedidos', to: '/pedidos', icon: 'i-lucide-calendar-days' },
  { label: 'Proveedores', to: '/pedidos/proveedores', icon: 'i-lucide-truck' },
  { label: 'Festivos', to: '/pedidos/festivos', icon: 'i-lucide-calendar-x-2' },
]

function isCurrent(section) {
  return route.path.replace(/\/$/, '') === section.to
}
</script>

<template>
  <nav
    aria-label="Secciones de pedidos"
    class="border-b border-default"
  >
    <ul class="flex gap-1 sm:gap-2">
      <li
        v-for="section in SECTIONS"
        :key="section.to"
        class="flex"
      >
        <NuxtLink
          :to="section.to"
          :aria-current="isCurrent(section) ? 'page' : undefined"
          class="relative flex items-center gap-1.5 whitespace-nowrap px-2 pb-3 pt-1 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary sm:px-3"
          :class="isCurrent(section)
            ? 'text-primary after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:rounded-full after:bg-primary'
            : 'text-muted hover:text-highlighted'"
        >
          <UIcon
            :name="section.icon"
            class="hidden size-5 shrink-0 sm:block"
            aria-hidden="true"
          />
          {{ section.label }}
        </NuxtLink>
      </li>
    </ul>
  </nav>
</template>
