<script setup>
const props = defineProps({
  variant: { type: String, default: 'ghost' },
  size: { type: String, default: 'md' },
  block: { type: Boolean, default: false },
  // Solo el icono (para la cabecera en móvil). El nombre accesible se
  // mantiene con aria-label.
  compact: { type: Boolean, default: false },
})

const supabase = useSupabaseClient()
const user = useSupabaseUser()
const authorization = useAuthorization()
const toast = useToast()

const loading = ref(false)

async function logout() {
  if (loading.value) return
  loading.value = true

  try {
    // scope "local": cierra solo la sesión de este dispositivo.
    const { error } = await supabase.auth.signOut({ scope: 'local' })

    if (error) {
      toast.add({
        title: 'No se ha podido cerrar la sesión',
        description: 'Comprueba la conexión a Internet y vuelve a intentarlo.',
        color: 'error',
      })
      return
    }

    user.value = null
    authorization.reset()
    await navigateTo('/login', { replace: true })
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <UButton
    :label="props.compact ? undefined : 'Cerrar sesión'"
    :aria-label="props.compact ? 'Cerrar sesión' : undefined"
    icon="i-lucide-log-out"
    color="neutral"
    :variant="variant"
    :size="size"
    :block="block"
    :square="props.compact"
    :loading="loading"
    :disabled="loading"
    @click="logout"
  />
</template>
