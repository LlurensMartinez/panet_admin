<script setup>
// Aceptar una invitación: el enlace del correo de Supabase Auth trae aquí la
// sesión de la persona invitada (en el fragmento #access_token…, que lee el
// cliente de Supabase en el navegador). Elige su contraseña y entra.
//
// Es una página pública (app/middleware/auth.global.js): sin una sesión
// válida no se puede hacer nada. Si la cuenta ya no está autorizada, al
// entrar va a /acceso-denegado como cualquier otra.
definePageMeta({ layout: false })

useHead({ title: 'Bienvenida · Panet Admin' })

const supabase = useSupabaseClient()
const user = useSupabaseUser()
const authorization = useAuthorization()

const step = ref('checking')
const email = ref('')
const linkMessage = ref('')
const state = reactive({ password: '', repeat: '' })
const loading = ref(false)
const errorMessage = ref('')
const showPassword = ref(false)

// Marca de esta pestaña: la sesión viene de un enlace de invitación (por si
// se recarga la página después de quitar los tokens de la dirección).
const INVITE_FLAG = 'panet-invite-session'

function readFlag() {
  try {
    return sessionStorage.getItem(INVITE_FLAG) === '1'
  }
  catch {
    return false
  }
}

function writeFlag(value) {
  try {
    if (value) sessionStorage.setItem(INVITE_FLAG, '1')
    else sessionStorage.removeItem(INVITE_FLAG)
  }
  catch {
    // Sin almacenamiento: solo afecta a una recarga de esta página.
  }
}

onMounted(async () => {
  // El enlace del correo trae la sesión (o el error) en el fragmento #….
  // El cliente de Supabase de la app usa el flujo PKCE y no lo procesa por sí
  // solo, así que se guarda aquí la sesión con setSession.
  const params = Object.fromEntries(new URLSearchParams(window.location.hash.replace(/^#/, '')))
  if (window.location.hash) history.replaceState(null, '', window.location.pathname + window.location.search)

  let session = null
  try {
    if (params.access_token && params.refresh_token) {
      const { data, error } = await supabase.auth.setSession({ access_token: params.access_token, refresh_token: params.refresh_token })
      session = error ? null : data?.session ?? null
      writeFlag(Boolean(session))
    }
    else if (readFlag()) {
      const { data } = await supabase.auth.getSession()
      session = data?.session ?? null
    }
  }
  catch {
    session = null
  }

  if (session?.user) {
    email.value = session.user.email ?? ''
    step.value = 'form'
    return
  }
  linkMessage.value = getInviteLinkErrorMessage(params.access_token ? { error: 'invalid_session' } : params)
  step.value = 'invalid'
})

function validate(values) {
  return validateNewPassword(values.password, values.repeat)
}

async function onSubmit() {
  if (loading.value) return
  loading.value = true
  errorMessage.value = ''
  try {
    const { error } = await supabase.auth.updateUser({ password: state.password })
    if (error) {
      errorMessage.value = getPasswordUpdateErrorMessage(error)
      return
    }
    const { data } = await supabase.auth.getClaims()
    writeFlag(false)
    authorization.reset()
    user.value = data?.claims ?? user.value
    state.password = ''
    state.repeat = ''
    await navigateTo('/', { replace: true })
  }
  catch (error) {
    errorMessage.value = getPasswordUpdateErrorMessage(error)
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

      <UCard data-invite-accept>
        <div
          v-if="step === 'checking'"
          class="space-y-3"
          aria-busy="true"
          aria-label="Comprobando la invitación"
        >
          <USkeleton class="h-6 w-40" />
          <USkeleton class="h-4 w-full" />
          <USkeleton class="h-10 w-full" />
        </div>

        <div
          v-else-if="step === 'invalid'"
          class="space-y-5"
          data-invite-invalid
        >
          <h1 class="text-lg font-semibold text-highlighted">
            No se puede abrir la invitación
          </h1>
          <p class="text-pretty text-muted">
            {{ linkMessage }}
          </p>
          <UButton
            to="/login"
            label="Ir a iniciar sesión"
            size="lg"
            block
          />
        </div>

        <template v-else>
          <h1 class="text-lg font-semibold text-highlighted">
            Elige tu contraseña
          </h1>
          <p
            class="mt-1 mb-5 text-sm text-muted"
            data-invite-email
          >
            Para entrar en Panet Admin con {{ email }}.
          </p>

          <UForm
            :state="state"
            :validate="validate"
            :disabled="loading"
            class="space-y-5"
            data-invite-form
            @submit="onSubmit"
          >
            <UAlert
              v-if="errorMessage"
              color="error"
              variant="subtle"
              icon="i-lucide-circle-alert"
              :title="errorMessage"
              role="alert"
              data-invite-error
            />

            <UFormField
              label="Contraseña"
              name="password"
              :help="`Al menos ${PASSWORD_MIN_LENGTH} caracteres.`"
              required
            >
              <UInput
                v-model="state.password"
                :type="showPassword ? 'text' : 'password'"
                autocomplete="new-password"
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

            <UFormField
              label="Repite la contraseña"
              name="repeat"
              required
            >
              <UInput
                v-model="state.repeat"
                :type="showPassword ? 'text' : 'password'"
                autocomplete="new-password"
                size="xl"
                class="w-full"
              />
            </UFormField>

            <UButton
              type="submit"
              label="Guardar y entrar"
              size="xl"
              block
              :loading="loading"
              :disabled="loading"
            />
          </UForm>
        </template>
      </UCard>
    </div>
  </main>
</template>
