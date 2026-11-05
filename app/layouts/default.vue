<script setup>
// Estructura de las páginas privadas: cabecera con la navegación (escritorio)
// y barra inferior de navegación (móvil). El acceso lo controla
// app/middleware/auth.global.js; este layout solo presenta.
const route = useRoute()
const user = useSupabaseUser()

const NAV_ITEMS = [
  { label: 'Inicio', to: '/', icon: 'i-lucide-house', exact: true },
  // Incluye las subpáginas /pedidos/proveedores y /pedidos/festivos.
  { label: 'Pedidos', to: '/pedidos', icon: 'i-lucide-clipboard-list' },
  { label: 'Empleados', to: '/empleados', icon: 'i-lucide-users-round' },
  { label: 'Horarios', to: '/horarios', icon: 'i-lucide-calendar-days' },
  { label: 'Horas extra', to: '/horas-extra', icon: 'i-lucide-clock' },
]

function isCurrent(item) {
  return item.exact ? route.path === item.to : route.path.startsWith(item.to)
}
</script>

<template>
  <div class="app-canvas flex min-h-dvh flex-col">
    <a
      href="#contenido"
      class="sr-only z-50 rounded-md bg-default px-3 py-2 text-sm font-medium text-highlighted shadow focus:not-sr-only focus:fixed focus:start-3 focus:top-3"
    >
      Saltar al contenido
    </a>

    <header class="sticky top-0 z-20 border-b border-default bg-default/85 backdrop-blur-md">
      <UContainer class="flex h-16 max-w-6xl items-center gap-4 lg:gap-8">
        <NuxtLink
          to="/"
          class="flex shrink-0 items-center gap-2.5 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
        >
          <span
            class="grid size-8 place-items-center rounded-lg bg-primary text-inverted"
            aria-hidden="true"
          >
            <UIcon
              name="i-lucide-wheat"
              class="size-[18px]"
            />
          </span>
          <span class="font-display text-[1.0625rem] tracking-tight">
            <span class="font-semibold text-highlighted">Panet</span>
            <span class="font-normal text-muted"> Admin</span>
          </span>
        </NuxtLink>

        <nav
          aria-label="Principal"
          class="hidden h-full md:block"
        >
          <ul class="flex h-full items-stretch gap-1">
            <li
              v-for="item in NAV_ITEMS"
              :key="item.to"
              class="flex"
            >
              <NuxtLink
                :to="item.to"
                :aria-current="isCurrent(item) ? 'page' : undefined"
                class="relative flex items-center gap-2 px-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary lg:px-3"
                :class="isCurrent(item)
                  ? 'text-highlighted after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full after:bg-primary lg:after:inset-x-3'
                  : 'text-muted hover:text-highlighted'"
              >
                <!-- En tabletas no caben los iconos de las cinco secciones. -->
                <UIcon
                  :name="item.icon"
                  class="hidden size-4 lg:block"
                  aria-hidden="true"
                />
                {{ item.label }}
              </NuxtLink>
            </li>
          </ul>
        </nav>

        <div class="ms-auto flex min-w-0 items-center gap-3">
          <span
            v-if="user?.email"
            class="hidden max-w-56 truncate text-sm text-muted lg:block"
          >
            {{ user.email }}
          </span>
          <LogoutButton
            class="hidden sm:inline-flex"
            size="sm"
          />
          <LogoutButton
            class="sm:hidden"
            compact
          />
        </div>
      </UContainer>
    </header>

    <main
      id="contenido"
      class="flex-1 pb-28 md:pb-0"
    >
      <UContainer class="max-w-6xl py-6 sm:py-10">
        <slot />
      </UContainer>
    </main>

    <!-- Navegación en móvil: al alcance del pulgar. -->
    <nav
      aria-label="Principal"
      class="fixed inset-x-0 bottom-0 z-20 border-t border-default bg-default/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden"
    >
      <ul class="mx-auto flex max-w-md">
        <li
          v-for="item in NAV_ITEMS"
          :key="item.to"
          class="flex-1"
        >
          <NuxtLink
            :to="item.to"
            :aria-current="isCurrent(item) ? 'page' : undefined"
            class="relative flex h-16 flex-col items-center justify-center gap-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-primary"
            :class="isCurrent(item) ? 'text-primary' : 'text-muted hover:text-highlighted'"
          >
            <span
              v-if="isCurrent(item)"
              class="absolute inset-x-1/4 top-0 h-0.5 rounded-full bg-primary"
              aria-hidden="true"
            />
            <UIcon
              :name="item.icon"
              class="size-5"
              aria-hidden="true"
            />
            {{ item.label }}
          </NuxtLink>
        </li>
      </ul>
    </nav>
  </div>
</template>
