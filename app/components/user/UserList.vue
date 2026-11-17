<script setup>
// Lista de cuentas con acceso a Panet Admin: correo, si ha aceptado la
// invitación y la acción de quitar el acceso (salvo a la propia cuenta).
defineProps({
  // buildAuthorizedUsers()
  users: { type: Array, required: true },
  currentUserId: { type: String, default: null },
  pendingId: { type: String, default: null },
})

const emit = defineEmits(['revoke'])

const STATUS = {
  [USER_STATUS.ACTIVE]: { label: 'Activo', color: 'primary' },
  [USER_STATUS.INVITED]: { label: 'Invitación pendiente', color: 'warning' },
  [USER_STATUS.UNKNOWN]: { label: 'Sin datos', color: 'neutral' },
}

function detail(user) {
  if (user.status === USER_STATUS.INVITED && user.invitedAt) return `Invitado el ${formatLeaveDate(user.invitedAt.slice(0, 10))}`
  if (user.lastSignInAt) return `Último acceso: ${formatLeaveDate(user.lastSignInAt.slice(0, 10))}`
  return ''
}
</script>

<template>
  <ul
    class="divide-y divide-default overflow-hidden rounded-xl bg-default shadow-xs ring ring-default"
    aria-label="Usuarios con acceso"
    data-user-list
  >
    <li
      v-for="user in users"
      :key="user.id"
      class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 py-3.5 sm:px-5"
      :data-user-row="user.id"
      :data-user-status="user.status"
      :aria-busy="pendingId === user.id || undefined"
    >
      <div class="min-w-0 space-y-1">
        <p class="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span
            class="min-w-0 truncate font-semibold text-highlighted"
            data-user-email
          >{{ user.email || 'Correo no disponible' }}</span>
          <UBadge
            v-if="user.isAdmin"
            label="Administración"
            color="neutral"
            variant="subtle"
            size="sm"
          />
          <UBadge
            v-if="user.id === currentUserId"
            label="Tú"
            color="neutral"
            variant="outline"
            size="sm"
          />
        </p>
        <p class="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
          <UBadge
            :label="STATUS[user.status].label"
            :color="STATUS[user.status].color"
            variant="subtle"
            size="sm"
            data-user-status-label
          />
          <span v-if="detail(user)">{{ detail(user) }}</span>
        </p>
      </div>

      <UButton
        v-if="user.id !== currentUserId && !user.isAdmin"
        label="Quitar acceso"
        icon="i-lucide-user-x"
        color="neutral"
        variant="outline"
        size="sm"
        :aria-label="`Quitar el acceso a ${user.email}`"
        :loading="pendingId === user.id"
        :disabled="Boolean(pendingId)"
        data-user-revoke
        @click="emit('revoke', user)"
      />
    </li>
  </ul>
</template>
