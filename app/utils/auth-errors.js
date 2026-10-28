/**
 * Traduce un error de inicio de sesión de Supabase a un mensaje comprensible.
 * No distingue entre "el correo no existe" y "contraseña incorrecta" para no
 * revelar qué cuentas existen.
 *
 * Códigos: https://supabase.com/docs/guides/auth/debugging/error-codes
 *
 * @param {unknown} error
 * @returns {string}
 */
export function getLoginErrorMessage(error) {
  const code = error?.code
  const status = error?.status

  if (code === 'invalid_credentials' || error?.message === 'Invalid login credentials') {
    return 'El correo electrónico o la contraseña no son correctos.'
  }

  if (code === 'email_not_confirmed') {
    return 'Esta cuenta todavía no está activada. Contacta con quien administra la aplicación.'
  }

  if (code === 'user_banned') {
    return 'Esta cuenta está bloqueada. Contacta con quien administra la aplicación.'
  }

  if (code === 'over_request_rate_limit' || status === 429) {
    return 'Se han hecho demasiados intentos seguidos. Espera unos minutos y vuelve a intentarlo.'
  }

  if (error?.name === 'AuthRetryableFetchError' || error?.name === 'TypeError' || status === 0) {
    return 'No se ha podido conectar con el servidor. Comprueba la conexión a Internet y vuelve a intentarlo.'
  }

  return 'No se ha podido iniciar sesión. Vuelve a intentarlo en unos minutos.'
}
