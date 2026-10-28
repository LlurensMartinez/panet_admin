<script setup>
const supabase = useSupabaseClient()
const user = useSupabaseUser()
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
    variant="ghost"
    :loading="loading"
    :disabled="loading"
    @click="logout"
  />
</template>
