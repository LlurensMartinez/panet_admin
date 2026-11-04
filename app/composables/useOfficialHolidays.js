/**
 * Municipio de la tienda (public.shop_settings) y festivos oficiales que la
 * app mantiene a partir del calendario de la Generalitat
 * (app/utils/official-holidays.js).
 *
 * - La configuración tiene una sola fila (id = 1).
 * - sync() consulta los datos abiertos de la Generalitat desde el navegador
 *   (sin clave; solo se envía el código del municipio) y deja los festivos
 *   oficiales del año actual y del siguiente como en el calendario oficial.
 *   Solo toca festivos con source = 'official'; los manuales nunca.
 * - Sin `force`, como mucho una vez al día (holidays_synced_at).
 *
 * Usa el cliente de Supabase con la clave publicable y el JWT de la sesión;
 * las políticas RLS deciden qué puede leer y escribir la cuenta.
 */
const SETTINGS_COLUMNS = 'id, municipality_code, municipality_name, holidays_synced_at, updated_at'
const SOURCE_TIMEOUT_MS = 15_000

export const OFFICIAL_SYNC_ERROR = Object.freeze({
  SOURCE: 'source', // la API de la Generalitat no responde o responde mal
})

const MISSING_MESSAGE = 'La base de datos aún no está preparada para el municipio de la tienda: falta aplicar su migración (SUPABASE_SETUP.md, sección 13).'
const SOURCE_MESSAGE = 'No se ha podido consultar el calendario oficial de la Generalitat. Se volverá a intentar más tarde.'

function settingsFeedback(response, action = 'load') {
  const kind = classifyDatabaseError(response) ?? DB_ERROR_KIND.UNKNOWN
  if (kind === DB_ERROR_KIND.MISSING || response?.error?.code === '42703') {
    return { kind: DB_ERROR_KIND.MISSING, message: MISSING_MESSAGE }
  }
  if (kind === DB_ERROR_KIND.EXPIRED) return { kind, message: 'Tu sesión ha caducado. Vuelve a iniciar sesión para continuar.' }
  if (kind === DB_ERROR_KIND.PERMISSION) return { kind, message: 'Esta cuenta no tiene permiso para configurar la tienda.' }
  if (kind === DB_ERROR_KIND.NETWORK) {
    return { kind, message: action === 'load' ? 'Comprueba la conexión a Internet y vuelve a intentarlo.' : 'No se ha podido guardar. Comprueba la conexión a Internet y vuelve a intentarlo.' }
  }
  return { kind, message: action === 'load' ? 'No se ha podido cargar la configuración de la tienda.' : 'No se ha podido guardar el municipio. Vuelve a intentarlo.' }
}

async function fetchJson(url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), SOURCE_TIMEOUT_MS)
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = await response.json()
    if (!Array.isArray(data)) throw new Error('Respuesta inesperada')
    return data
  }
  finally {
    clearTimeout(timer)
  }
}

export function useOfficialHolidays() {
  const supabase = useSupabaseClient()

  async function request(run) {
    try {
      return await run()
    }
    catch (error) {
      return { data: null, error, status: 0 }
    }
  }

  async function fetchSettings() {
    const response = await request(() => supabase
      .from('shop_settings')
      .select(SETTINGS_COLUMNS)
      .eq('id', 1)
      .maybeSingle())
    if (response.error) {
      const feedback = settingsFeedback(response, 'load')
      throw createError({
        statusCode: response.status || 500,
        statusMessage: 'Shop settings load failed',
        data: { kind: feedback.kind, message: feedback.message },
      })
    }
    return response.data ?? null
  }

  const {
    data: settings,
    status: settingsStatus,
    error,
    refresh: refreshSettings,
  } = useLazyAsyncData('shop-settings', fetchSettings, { default: () => null })

  const settingsError = computed(() => {
    if (!error.value) return null
    const data = typeof error.value.data === 'string' ? safeParse(error.value.data) : error.value.data
    return { kind: data?.kind ?? DB_ERROR_KIND.UNKNOWN, message: data?.message ?? settingsFeedback({ error: {} }).message }
  })

  // Estado compartido entre páginas: una sola actualización a la vez.
  const syncing = useState('official-holidays-syncing', () => false)
  const lastSync = useState('official-holidays-last', () => null)

  /** Guarda el municipio de la tienda (o lo quita con null). */
  async function saveMunicipality(code) {
    const municipality = code ? findMunicipality(code) : null
    if (code && !municipality) return { ok: false, message: 'Elige un municipio de la lista.' }
    const response = await request(() => supabase
      .from('shop_settings')
      .upsert({ id: 1, municipality_code: municipality?.code ?? null, municipality_name: municipality?.name ?? null }, { onConflict: 'id' })
      .select(SETTINGS_COLUMNS)
      .single())
    if (response.error) return { ok: false, ...settingsFeedback(response, 'save') }
    settings.value = response.data
    return { ok: true, settings: response.data }
  }

  async function fetchOfficialYears(municipality, years) {
    return Promise.all(years.map(async (year) => {
      const [labourRows, localRows] = await Promise.all([
        fetchJson(buildLabourCalendarUrl(year)),
        fetchJson(buildLocalHolidaysUrl(municipality.code, year)),
      ])
      return buildOfficialYear({ year, labourRows, localRows, municipalityName: municipality.name })
    }))
  }

  async function loadYearsHolidays(years) {
    const response = await request(() => supabase
      .from('holidays')
      .select(HOLIDAY_COLUMNS)
      .gte('holiday_date', `${years[0]}-01-01`)
      .lte('holiday_date', `${years.at(-1)}-12-31`))
    return response
  }

  async function applyPlan(plan) {
    if (plan.deletes.length) {
      const response = await request(() => supabase.from('holidays').delete().in('id', plan.deletes).eq('source', OFFICIAL_SOURCE))
      if (response.error) return response
    }
    for (const update of plan.updates) {
      const { id, ...changes } = update
      const response = await request(() => supabase.from('holidays').update(changes).eq('id', id).eq('source', OFFICIAL_SOURCE))
      if (response.error) return response
    }
    for (const holiday of plan.inserts) {
      const response = await request(() => supabase.from('holidays').insert(holiday))
      // 23505: otro dispositivo ya ha añadido un festivo ese día; se respeta.
      if (response.error && response.error.code !== '23505') return response
    }
    return { error: null }
  }

  /**
   * Actualiza los festivos oficiales. Devuelve el resultado y lo guarda en
   * `lastSync`: { ok, skipped?, plan?, years?, kind?, message?, at }.
   */
  async function sync({ today = getTodayDate(), force = false } = {}) {
    const current = settings.value
    if (!current?.municipality_code) return { ok: false, skipped: 'no-municipality' }
    if (!force && !isOfficialSyncDue(current.holidays_synced_at)) return { ok: true, skipped: 'recent' }
    if (syncing.value) return { ok: false, skipped: 'busy' }
    const municipality = findMunicipality(current.municipality_code)
      ?? { code: current.municipality_code, name: current.municipality_name }

    syncing.value = true
    let result
    try {
      const years = getOfficialSyncYears(today)
      let official
      try {
        official = await fetchOfficialYears(municipality, years)
      }
      catch {
        result = { ok: false, kind: OFFICIAL_SYNC_ERROR.SOURCE, message: SOURCE_MESSAGE }
        return result
      }

      const existing = await loadYearsHolidays(years)
      if (existing.error) {
        result = { ok: false, ...getHolidayErrorFeedback(existing, 'load') }
        return result
      }
      const plan = planOfficialSync({ existing: existing.data ?? [], years: official })
      const applied = await applyPlan(plan)
      if (applied.error) {
        result = { ok: false, ...getHolidayErrorFeedback(applied, 'save') }
        return result
      }

      const stamp = await request(() => supabase
        .from('shop_settings')
        .update({ holidays_synced_at: new Date().toISOString() })
        .eq('id', 1)
        .select(SETTINGS_COLUMNS)
        .single())
      if (!stamp.error) settings.value = stamp.data

      result = {
        ok: true,
        plan,
        years: official.map(({ year, published, localPublished, localInconsistent }) => ({ year, published, localPublished, localInconsistent })),
      }
      return result
    }
    finally {
      syncing.value = false
      if (result) lastSync.value = { ...result, at: new Date().toISOString(), municipality: municipality.name }
    }
  }

  return {
    settings,
    settingsStatus,
    settingsError,
    refreshSettings,
    saveMunicipality,
    sync,
    syncing,
    lastSync,
  }
}

function safeParse(value) {
  try {
    return JSON.parse(value)
  }
  catch {
    return null
  }
}
