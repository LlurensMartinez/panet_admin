<script setup>
definePageMeta({ layout: false })

useHead({ title: 'Iniciar sesión · Panet Admin' })

const supabase = useSupabaseClient()
const user = useSupabaseUser()
const authorization = useAuthorization()
const route = useRoute()

// Aviso cuando el middleware ha cerrado una sesión que Supabase ya no acepta.
const sessionExpired = computed(() => route.query.reason === 'expired')

const state = reactive({
  email: '',
  password: '',
})

const loading = ref(false)
const errorMessage = ref('')
const showPassword = ref(false)

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function validate(values) {
  const errors = []
  const email = values.email?.trim()

  if (!email) {
    errors.push({ name: 'email', message: 'Introduce tu correo electrónico.' })
  }
  else if (!EMAIL_PATTERN.test(email)) {
    errors.push({ name: 'email', message: 'El correo electrónico no tiene un formato válido.' })
  }

  if (!values.password) {
    errors.push({ name: 'password', message: 'Introduce tu contraseña.' })
  }

  return errors
}

async function onSubmit() {
  // Evita envíos repetidos mientras hay una petición en curso.
  if (loading.value) return

  loading.value = true
  errorMessage.value = ''

  try {
    const { error } = await supabase.auth.signInWithPassword({
      email: state.email.trim(),
      password: state.password,
    })

    if (error) {
      errorMessage.value = getLoginErrorMessage(error)
      return
    }

    // Se actualiza el usuario verificado antes de navegar para que el
    // middleware de rutas ya lo encuentre.
    const { data, error: claimsError } = await supabase.auth.getClaims()

    if (claimsError || !data?.claims) {
      errorMessage.value = getLoginErrorMessage(claimsError)
      return
    }

    // Nueva sesión: la autorización se vuelve a comprobar en el middleware.
    authorization.reset()
    user.value = data.claims
    state.password = ''

    await navigateTo(getSafeRedirect(route.query.redirect), { replace: true })
  }
  catch (error) {
    errorMessage.value = getLoginErrorMessage(error)
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <main class="flex min-h-dvh items-center justify-center bg-muted px-4 py-10">
    <div class="w-full max-w-sm">
      <p class="mb-6 text-center text-2xl font-semibold text-highlighted">
        Panet Admin
      </p>

      <UCard>
        <h1 class="mb-5 text-lg font-semibold text-highlighted">
          Iniciar sesión
        </h1>

        <UForm
          :state="state"
          :validate="validate"
          :disabled="loading"
          class="space-y-5"
          @submit="onSubmit"
        >
          <UAlert
            v-if="errorMessage"
            color="error"
            variant="subtle"
            icon="i-lucide-circle-alert"
            :title="errorMessage"
            role="alert"
          />

          <UAlert
            v-else-if="sessionExpired"
            color="warning"
            variant="subtle"
            icon="i-lucide-clock"
            title="Tu sesión ha caducado. Vuelve a iniciar sesión."
            role="status"
          />

          <UFormField
            label="Correo electrónico"
            name="email"
            required
          >
            <UInput
              v-model="state.email"
              type="email"
              autocomplete="email"
              inputmode="email"
              autocapitalize="none"
              :spellcheck="false"
              size="xl"
              class="w-full"
            />
          </UFormField>

          <UFormField
            label="Contraseña"
            name="password"
            required
          >
            <UInput
              v-model="state.password"
              :type="showPassword ? 'text' : 'password'"
              autocomplete="current-password"
              size="xl"
              class="w-full"
              :ui="{ trailing: 'pe-1' }"
            >
              <template #trailing>
                <UButton
                  color="neutral"
                  variant="link"
                  size="sm"
                  :icon="showPassword ? 'i-lucide-eye-off' : 'i-lucide-eye'"
                  :aria-label="showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'"
                  :aria-pressed="showPassword"
                  @click="showPassword = !showPassword"
                />
              </template>
            </UInput>
          </UFormField>

          <UButton
            type="submit"
            label="Entrar"
            size="xl"
            block
            :loading="loading"
            :disabled="loading"
          />
        </UForm>
      </UCard>

      <p class="mt-6 text-center text-sm text-muted">
        Acceso restringido a la persona responsable de la tienda.
      </p>
    </div>
  </main>
</template>
