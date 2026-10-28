<script setup>
const props = defineProps({
  error: { type: Object, required: true },
})

const config = useRuntimeConfig()

const status = computed(() => props.error?.status ?? props.error?.statusCode ?? 500)
const isNotFound = computed(() => status.value === 404)
const supabaseNotConfigured = computed(() => {
  const supabase = config.public.supabase
  return !supabase?.url || !supabase?.key
})

const title = computed(() => {
  if (isNotFound.value) return 'Página no encontrada'
  if (supabaseNotConfigured.value) return 'Falta configurar la conexión con Supabase'
  return 'Se ha producido un error'
})

const description = computed(() => {
  if (isNotFound.value) return 'La dirección no existe o ha cambiado.'
  if (supabaseNotConfigured.value) {
    return 'Define NUXT_PUBLIC_SUPABASE_URL y NUXT_PUBLIC_SUPABASE_KEY en el entorno (consulta SUPABASE_SETUP.md) y reinicia la aplicación.'
  }
  return 'Vuelve a intentarlo en unos minutos. Si el problema continúa, avisa a quien administra la aplicación.'
})

useHead({ title: computed(() => `${title.value} · Panet Admin`) })

function goHome() {
  clearError({ redirect: '/' })
}
</script>

<template>
  <UApp>
    <main class="flex min-h-dvh items-center justify-center bg-muted px-4 py-10">
      <UCard class="w-full max-w-md">
        <p class="text-sm font-medium text-muted">
          Error {{ status }}
        </p>
        <h1 class="mt-1 text-xl font-semibold text-highlighted">
          {{ title }}
        </h1>
        <p class="mt-3 text-muted">
          {{ description }}
        </p>

        <UButton
          v-if="!supabaseNotConfigured || isNotFound"
          class="mt-6"
          label="Volver al inicio"
          @click="goHome"
        />
      </UCard>
    </main>
  </UApp>
</template>
