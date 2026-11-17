/**
 * Gestión de usuarios desde la interfaz. Todas las operaciones van a las
 * rutas del servidor (server/api/admin/…), que comprueban la sesión y que la
 * cuenta es la de administración principal; el navegador nunca usa la clave
 * secreta de Supabase.
 *
 * - `checkAdmin`: ¿la cuenta con sesión es la de administración? Se guarda por
 *   cuenta durante la sesión (solo decide qué se muestra; el servidor lo
 *   vuelve a comprobar en cada operación).
 * - `loadUsers`, `inviteUser`, `revokeUser`: devuelven `{ ok, data }` o
 *   `{ ok: false, message, status }` con un mensaje comprensible.
 */
export function useUserAdmin() {
  const user = useSupabaseUser()
  const requestFetch = useRequestFetch()
  const state = useState('panet-admin-status', () => ({ userId: null, isAdmin: false }))

  const currentUserId = () => user.value?.sub ?? user.value?.id ?? null

  async function checkAdmin({ force = false } = {}) {
    const userId = currentUserId()
    if (!userId) return false
    if (!force && state.value.userId === userId) return state.value.isAdmin
    try {
      const result = await requestFetch('/api/admin/me')
      state.value = { userId, isAdmin: result?.isAdmin === true }
    }
    catch {
      // Ante cualquier error, no se muestra la sección (y no se guarda).
      return false
    }
    return state.value.isAdmin
  }

  async function call(action, run) {
    try {
      return { ok: true, data: await run() }
    }
    catch (error) {
      return { ok: false, status: error?.statusCode ?? error?.status ?? 0, message: getUserAdminErrorMessage(error, action) }
    }
  }

  const loadUsers = () => call('load', () => requestFetch('/api/admin/users'))
  const inviteUser = email => call('invite', () => $fetch('/api/admin/users', { method: 'POST', body: { email: normalizeEmail(email) } }))
  const revokeUser = id => call('revoke', () => $fetch(`/api/admin/users/${encodeURIComponent(id)}`, { method: 'DELETE' }))

  return { state, checkAdmin, loadUsers, inviteUser, revokeUser }
}
