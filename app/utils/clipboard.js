// Copiar texto al portapapeles desde la interfaz.
//
// 1. API moderna (navigator.clipboard), disponible en HTTPS y en localhost.
// 2. Si no existe o el navegador la rechaza (por ejemplo, al probar desde el
//    móvil por http:// en la red local), método clásico con un textarea
//    temporal y document.execCommand('copy').
// 3. Si ninguno funciona, devuelve { ok: false } para que la pantalla pida
//    copiar el texto a mano.
//
// `env` permite probar la función sin navegador (pruebas unitarias).

/**
 * @param {string} text
 * @param {{ navigator?: any, document?: any, isSecureContext?: boolean }} [env]
 * @returns {Promise<{ ok: boolean, method?: 'clipboard' | 'execCommand' }>}
 */
export async function copyTextToClipboard(text, env = globalThis) {
  const clipboard = env.navigator?.clipboard
  if (clipboard?.writeText && env.isSecureContext !== false) {
    try {
      await clipboard.writeText(text)
      return { ok: true, method: 'clipboard' }
    }
    catch {
      // Permiso denegado o contexto no válido: se prueba el método clásico.
    }
  }

  const doc = env.document
  if (!doc?.body || typeof doc.execCommand !== 'function') return { ok: false }

  const previousFocus = doc.activeElement
  const area = doc.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.setAttribute('aria-hidden', 'true')
  area.style.position = 'fixed'
  area.style.top = '0'
  area.style.left = '0'
  area.style.opacity = '0'
  area.style.pointerEvents = 'none'
  doc.body.appendChild(area)

  try {
    area.select()
    return doc.execCommand('copy') ? { ok: true, method: 'execCommand' } : { ok: false }
  }
  catch {
    return { ok: false }
  }
  finally {
    area.remove()
    previousFocus?.focus?.()
  }
}
