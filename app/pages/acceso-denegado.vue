<script setup>
// Solo llegan aquí cuentas con sesión válida que NO están en public.profiles
// (lo garantiza app/middleware/auth.global.js).
definePageMeta({ layout: false })

useHead({ title: 'Acceso no autorizado · Panet Admin' })

const user = useSupabaseUser()
const authorization = useAuthorization()

const checking = ref(false)
const message = ref('')

async function checkAgain() {
  if (checking.value) return
  checking.value = true
  message.value = ''

  try {
    const status = await authorization.check({ force: true })

    if (status === AUTHZ_STATUS.AUTHORIZED) {
      await navigateTo('/', { replace: true })
      return
    }

    if (status === AUTHZ_STATUS.UNAUTHORIZED) {
      message.value = 'La cuenta sigue sin autorización.'
      return
    }

    // Caducada o error: el middleware decide qué mostrar al recargar la ruta.
    await navigateTo('/', { replace: true })
  }
  finally {
    checking.value = false
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
        <h1 class="text-lg font-semibold text-highlighted">
          Acceso no autorizado
        </h1>

        <div class="mt-3 space-y-3 text-muted">
          <p>
            Has iniciado sesión como
            <strong class="break-all text-default">{{ user?.email }}</strong>,
            pero esta cuenta no tiene acceso a Panet Admin.
          </p>
          <p>
            Si crees que es un error, pide a quien administra la aplicación que autorice la cuenta.
          </p>
        </div>

        <UAlert
          v-if="message"
          class="mt-4"
          color="neutral"
          variant="subtle"
          :title="message"
          role="status"
        />

        <div class="mt-6 flex flex-col gap-2">
          <UButton
            label="Comprobar de nuevo"
            color="neutral"
            variant="outline"
            size="lg"
            block
            :loading="checking"
            :disabled="checking"
            @click="checkAgain"
          />
          <LogoutButton
            variant="solid"
            size="lg"
            block
          />
        </div>
      </UCard>
    </div>
  </main>
</template>
