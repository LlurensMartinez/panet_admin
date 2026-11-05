/**
 * Recordatorios de Inicio ocultados HOY en este navegador («Ya lo he tenido
 * en cuenta»). Solo usa localStorage: no escribe en Supabase ni cambia
 * pedidos. Lo guardado lleva la fecha (app/utils/reminders.js), así que al
 * cambiar de día los recordatorios vuelven a aparecer.
 *
 * `ready` es false hasta que el navegador ha leído lo guardado: así no se
 * enseña un instante un recordatorio que ya estaba oculto.
 *
 * @param {import('vue').Ref<string>} today Fecha de hoy (YYYY-MM-DD, tienda).
 */
export function useDismissedReminders(today) {
  const ready = ref(false)
  const stored = ref(null)

  onMounted(() => {
    try {
      stored.value = window.localStorage.getItem(REMINDERS_STORAGE_KEY)
    }
    catch {
      stored.value = null
    }
    ready.value = true
  })

  const dismissed = computed(() => parseDismissed(stored.value, today.value))

  function save(ids) {
    const raw = serializeDismissed(ids, today.value)
    stored.value = raw
    try {
      window.localStorage.setItem(REMINDERS_STORAGE_KEY, raw)
    }
    catch {
      // Sin almacenamiento (modo privado estricto): se oculta hasta recargar.
    }
  }

  function dismiss(id) {
    save([...dismissed.value, id])
  }

  function restoreAll() {
    save([])
  }

  return { ready, dismissed, dismiss, restoreAll }
}
