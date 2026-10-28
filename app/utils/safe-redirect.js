/**
 * Devuelve una ruta interna segura a la que volver después de iniciar sesión.
 * Rechaza URLs externas (p. ej. "//otro-sitio.com") para evitar redirecciones abiertas.
 *
 * @param {unknown} value Valor recibido, normalmente `route.query.redirect`.
 * @returns {string}
 */
export function getSafeRedirect(value) {
  const path = Array.isArray(value) ? value[0] : value

  if (
    typeof path !== 'string'
    || !path.startsWith('/')
    || path.startsWith('//')
    || path.startsWith('/\\')
    || path.startsWith('/login')
  ) {
    return '/'
  }

  return path
}
