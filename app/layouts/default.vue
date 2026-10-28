<template>
  <div class="flex min-h-dvh flex-col">
    <header class="sticky top-0 z-10 border-b border-default bg-default/90 backdrop-blur">
      <UContainer class="flex h-14 items-center justify-between gap-4">
        <NuxtLink
          to="/"
          class="font-semibold text-highlighted"
        >
          Panet Admin
        </NuxtLink>

        <LogoutButton />
      </UContainer>
    </header>

    <main class="flex-1">
      <UContainer class="py-6">
        <slot />
      </UContainer>
    </main>
  </div>
</template>
