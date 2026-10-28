<script setup>
defineProps({
  variant: { type: String, default: 'ghost' },
  size: { type: String, default: 'md' },
  block: { type: Boolean, default: false },
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
    label="Cerrar sesión"
    icon="i-lucide-log-out"
    color="neutral"
    :variant="variant"
    :size="size"
    :block="block"
    :loading="loading"
    :disabled="loading"
    @click="logout"
  />
</template>
