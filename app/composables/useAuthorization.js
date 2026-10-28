/**
 * Comprueba si la cuenta con sesión iniciada está autorizada, es decir, si
 * tiene fila en public.profiles. La política RLS `profiles_select_own` solo
 * deja leer la propia fila, así que la consulta usa el JWT de la usuaria y la
 * clave publicable (nunca una clave secreta).
 *
 * El resultado «autorizada» o «no autorizada» se guarda para la sesión actual
 * de la usuaria (y viaja del servidor al navegador en el payload de SSR). Los
 * errores no se guardan.
 */
export function useAuthorization() {
  const supabase = useSupabaseClient()
  const user = useSupabaseUser()
  const state = useState('panet-authorization', () => ({ userId: null, status: null }))

  async function check({ force = false } = {}) {
    const userId = user.value?.sub ?? user.value?.id ?? null

    if (
      !force
      && userId
      && state.value.userId === userId
      && CACHEABLE_STATUSES.includes(state.value.status)
    ) {
      return state.value.status
    }

    let response
    if (userId) {
      try {
        response = await supabase
          .from('profiles')
          .select('id')
          .eq('id', userId)
          .maybeSingle()
      }
      catch (error) {
        response = { data: null, error, status: 0 }
      }
    }

    const status = classifyProfileResponse(response, userId)

    state.value = CACHEABLE_STATUSES.includes(status)
      ? { userId, status }
      : { userId: null, status: null }

    return status
  }

  function reset() {
    state.value = { userId: null, status: null }
  }

  return { check, reset, state }
}
