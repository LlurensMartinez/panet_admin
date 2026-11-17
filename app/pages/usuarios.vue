<script setup>
// Usuarios con acceso a Panet Admin: lista, invitar por correo y quitar el
// acceso. Solo para la cuenta de administración principal.
//
// El acceso lo controlan app/middleware/auth.global.js (sesión + cuenta
// autorizada) y app/middleware/admin.js (cuenta de administración). Las
// operaciones las hace el servidor (server/api/admin/…), que vuelve a
// comprobarlo todo en cada petición.
definePageMeta({ middleware: ['admin'] })

useHead({ title: 'Usuarios · Panet Admin' })

const toast = useToast()
const { loadUsers, revokeUser } = useUserAdmin()

const list = ref({ status: 'loading', users: [], currentUserId: null, message: '' })

async function load() {
  list.value = { ...list.value, status: 'loading', message: '' }
  const result = await loadUsers()
  list.value = result.ok
    ? { status: 'ready', users: result.data.users ?? [], currentUserId: result.data.currentUserId ?? null, message: '' }
    : { ...list.value, status: 'error', message: result.message }
}

onMounted(load)

const count = computed(() => list.value.users.length)

// --------------------------------------------------------------- Invitar
const inviteOpen = ref(false)

function onInvited(data) {
  toast.add({
    title: data.outcome === INVITE_OUTCOME.RESTORED ? 'Acceso devuelto' : 'Invitación enviada',
    description: data.outcome === INVITE_OUTCOME.RESTORED
      ? `${data.user.email} ya tenía cuenta: vuelve a tener acceso y entra con su contraseña.`
      : `${data.user.email} recibirá un correo para elegir su contraseña.`,
    color: 'success',
    icon: 'i-lucide-circle-check',
  })
  load()
}

// ------------------------------------------------------------ Quitar acceso
const revokeTarget = ref(null)
const revokeOpen = ref(false)
const pendingId = ref(null)

function askRevoke(user) {
  revokeTarget.value = user
  revokeOpen.value = true
}

async function confirmRevoke() {
  const user = revokeTarget.value
  if (!user || pendingId.value) return
  pendingId.value = user.id
  try {
    const result = await revokeUser(user.id)
    revokeOpen.value = false
    if (!result.ok) {
      toast.add({ title: result.message, color: 'error', icon: 'i-lucide-circle-alert' })
      if (result.status === 404) load()
      return
    }
    toast.add({
      title: 'Acceso retirado',
      description: `${user.email} ya no puede usar Panet Admin. Su cuenta se conserva por si vuelves a darle acceso.`,
      color: 'success',
      icon: 'i-lucide-circle-check',
    })
    list.value = { ...list.value, users: list.value.users.filter(item => item.id !== user.id) }
  }
  finally {
    pendingId.value = null
  }
}
</script>

<template>
  <div class="space-y-6">
    <PageHeader
      title="Usuarios"
      description="Personas que pueden entrar en Panet Admin. Todas pueden usar la aplicación; solo la cuenta de administración gestiona los usuarios."
    >
      <template #actions>
        <UButton
          label="Invitar usuario"
          icon="i-lucide-user-plus"
          size="lg"
          data-user-invite
          @click="inviteOpen = true"
        />
      </template>
    </PageHeader>

    <div
      v-if="list.status === 'loading' && !list.users.length"
      class="space-y-2 rounded-xl bg-default p-4 shadow-xs ring ring-default"
      aria-busy="true"
      aria-label="Cargando los usuarios"
    >
      <USkeleton class="h-5 w-64 max-w-full" />
      <USkeleton class="h-4 w-40" />
      <USkeleton class="mt-4 h-5 w-56 max-w-full" />
      <USkeleton class="h-4 w-32" />
    </div>

    <div
      v-else-if="list.status === 'error' && !list.users.length"
      class="rounded-xl bg-default shadow-xs ring ring-default"
      data-user-load-error
    >
      <EmptyState
        tone="error"
        icon="i-lucide-cloud-off"
        title="No se ha podido cargar la lista"
        :description="list.message"
      >
        <UButton
          label="Reintentar"
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="outline"
          @click="load"
        />
      </EmptyState>
    </div>

    <template v-else>
      <UAlert
        v-if="list.status === 'error'"
        color="error"
        variant="subtle"
        icon="i-lucide-circle-alert"
        :title="list.message"
        :actions="[{ label: 'Reintentar', color: 'error', variant: 'outline', icon: 'i-lucide-refresh-cw', onClick: load }]"
      />
      <p
        class="text-sm text-muted"
        data-user-count
      >
        {{ count === 1 ? '1 usuario con acceso' : `${count} usuarios con acceso` }}
      </p>
      <UserList
        :users="list.users"
        :current-user-id="list.currentUserId"
        :pending-id="pendingId"
        @revoke="askRevoke"
      />
    </template>

    <UserInviteModal
      v-model:open="inviteOpen"
      @invited="onInvited"
    />

    <ConfirmModal
      v-model:open="revokeOpen"
      :title="`¿Quitar el acceso a ${revokeTarget?.email ?? ''}?`"
      description="No podrá volver a entrar en Panet Admin ni ver sus datos. Su cuenta se conserva: si más adelante la vuelves a invitar, recuperará el acceso."
      confirm-label="Quitar acceso"
      confirm-icon="i-lucide-user-x"
      confirm-color="error"
      :pending="Boolean(pendingId)"
      @confirm="confirmRevoke"
    />
  </div>
</template>
