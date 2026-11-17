<script setup>
// Invitar a una persona por correo. La invitación la envía el servidor
// (server/api/admin/users), nunca el navegador.
const open = defineModel('open', { type: Boolean, default: false })

const emit = defineEmits(['invited'])

const { inviteUser } = useUserAdmin()
const formId = useId()
const state = reactive({ email: '' })
const sending = ref(false)
const errorMessage = ref('')

watch(open, (isOpen) => {
  if (!isOpen) return
  state.email = ''
  errorMessage.value = ''
})

function validate(values) {
  const message = validateInviteEmail(values.email)
  return message ? [{ name: 'email', message }] : []
}

async function onSubmit() {
  if (sending.value) return
  errorMessage.value = ''
  sending.value = true
  try {
    const result = await inviteUser(state.email)
    if (!result.ok) {
      errorMessage.value = result.message
      return
    }
    open.value = false
    emit('invited', result.data)
  }
  finally {
    sending.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    title="Invitar usuario"
    description="Recibirá un correo con un enlace para elegir su contraseña y entrar en Panet Admin."
    :dismissible="!sending"
    :ui="{
      content: 'sm:max-w-md',
      title: 'font-display text-lg font-semibold',
      footer: 'justify-end gap-2',
    }"
  >
    <template #body>
      <UForm
        :id="formId"
        :state="state"
        :validate="validate"
        :validate-on="['blur']"
        :disabled="sending"
        class="space-y-4"
        data-user-invite-form
        @submit="onSubmit"
      >
        <UAlert
          v-if="errorMessage"
          color="error"
          variant="subtle"
          icon="i-lucide-circle-alert"
          :title="errorMessage"
          role="alert"
          data-user-invite-error
        />
        <UFormField
          label="Correo electrónico"
          name="email"
          required
        >
          <UInput
            v-model="state.email"
            type="email"
            autocomplete="off"
            inputmode="email"
            autocapitalize="none"
            :spellcheck="false"
            size="lg"
            class="w-full"
            data-user-invite-email
          />
        </UFormField>
      </UForm>
    </template>

    <template #footer>
      <UButton
        label="Cancelar"
        color="neutral"
        variant="ghost"
        :disabled="sending"
        @click="open = false"
      />
      <UButton
        type="submit"
        :form="formId"
        label="Enviar invitación"
        icon="i-lucide-send"
        :loading="sending"
        :disabled="sending"
        data-user-invite-submit
      />
    </template>
  </UModal>
</template>
