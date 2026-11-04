/**
 * Hora actual que se actualiza cada 30 segundos en el navegador, para avisos
 * que dependen de la hora (por ejemplo, la hora límite de los pedidos). Un solo
 * temporizador para toda la aplicación.
 * @returns {import('vue').ComputedRef<Date>}
 */
let timerStarted = false

export function useMinuteClock() {
  const now = useState('minute-clock', () => Date.now())
  if (import.meta.client && !timerStarted) {
    timerStarted = true
    now.value = Date.now()
    setInterval(() => {
      now.value = Date.now()
    }, 30_000)
  }
  return computed(() => new Date(now.value))
}
