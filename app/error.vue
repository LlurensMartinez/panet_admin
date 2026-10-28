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

// Errores de la comprobación de autorización (app/middleware/auth.global.js).
// `data` puede llegar como objeto o como texto JSON tras el renderizado en servidor.
const errorData = computed(() => {
  const data = props.error?.data
  if (typeof data === 'string') {
    try {
      return JSON.parse(data)
    }
    catch {
      return {}
    }
  }
  return data ?? {}
})
const authReason = computed(() => {
  const reason = errorData.value?.reason
  return reason === 'connection' || reason === 'setup' ? reason : null
})

const title = computed(() => {
  if (isNotFound.value) return 'Página no encontrada'
  if (supabaseNotConfigured.value) return 'Falta configurar la conexión con Supabase'
  if (authReason.value === 'connection') return 'No se ha podido comprobar el acceso'
  if (authReason.value === 'setup') return 'Falta preparar la base de datos'
  return 'Se ha producido un error'
})

const description = computed(() => {
  if (isNotFound.value) return 'La dirección no existe o ha cambiado.'
  if (supabaseNotConfigured.value) {
    return 'Define NUXT_PUBLIC_SUPABASE_URL y NUXT_PUBLIC_SUPABASE_KEY en el entorno (consulta SUPABASE_SETUP.md) y reinicia la aplicación.'
  }
  if (authReason.value === 'connection') {
    return 'No hay conexión con el servidor o no responde. Comprueba la conexión a Internet y vuelve a intentarlo.'
  }
  if (authReason.value === 'setup') {
    return 'No se puede consultar la lista de cuentas autorizadas. Hay que aplicar la migración de autorización en Supabase (SUPABASE_SETUP.md, sección 5).'
  }
  return 'Vuelve a intentarlo en unos minutos. Si el problema continúa, avisa a quien administra la aplicación.'
})

useHead({ title: computed(() => `${title.value} · Panet Admin`) })

const route = useRoute()
const leaving = ref(false)

function goHome() {
  clearError({ redirect: '/' })
}

function retry() {
  // Recarga completa: la comprobación de acceso se repite desde cero (también
  // cuando el error se produjo en la misma ruta, donde el router no navegaría).
  reloadNuxtApp({ path: getSafeRedirect(errorData.value?.path ?? route.fullPath), force: true })
}

async function logout() {
  if (leaving.value) return
  leaving.value = true
  // Los composables se obtienen antes de cualquier await.
  const user = useSupabaseUser()
  try {
    const authorization = useAuthorization()
    authorization.reset()
    await useSupabaseClient().auth.signOut({ scope: 'local' })
  }
  catch {
    // Sin conexión: se vuelve igualmente a la pantalla de inicio de sesión.
  }
  user.value = null
  // Recarga completa para salir del estado de error con la URL y la sesión limpias.
  reloadNuxtApp({ path: '/login', force: true })
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

        <div
          v-if="authReason && !supabaseNotConfigured"
          class="mt-6 flex flex-col gap-2 sm:flex-row"
        >
          <UButton
            label="Reintentar"
            icon="i-lucide-refresh-cw"
            block
            @click="retry"
          />
          <UButton
            label="Cerrar sesión"
            color="neutral"
            variant="outline"
            block
            :loading="leaving"
            :disabled="leaving"
            @click="logout"
          />
        </div>

        <UButton
          v-else-if="!supabaseNotConfigured || isNotFound"
          class="mt-6"
          label="Volver al inicio"
          @click="goHome"
        />
      </UCard>
    </main>
  </UApp>
</template>
