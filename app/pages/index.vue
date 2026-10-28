<script setup>
useHead({ title: 'Inicio · Panet Admin' })

const user = useSupabaseUser()
</script>

<template>
  <UCard class="mx-auto max-w-md">
    <template #header>
      <h1 class="text-xl font-semibold text-highlighted">
        Área privada
      </h1>
    </template>

    <div class="space-y-3">
      <p>
        Has iniciado sesión como
        <strong class="break-all">{{ user?.email }}</strong>.
      </p>
      <p class="text-sm text-muted">
        Página provisional para comprobar que el acceso está protegido. Los módulos se añadirán en las próximas fases.
      </p>
    </div>
  </UCard>
</template>
