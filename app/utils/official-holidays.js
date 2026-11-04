// Festivos oficiales del municipio de la tienda, a partir de los datos
// abiertos de la Generalitat de Catalunya (sin dependencias de Nuxt ni de
// Supabase, para poder probarlo con pruebas unitarias).
//
// Fuentes (API pública de Socrata, sin clave; admite peticiones desde el
// navegador):
// - Festivos laborales de Cataluña (nacionales y autonómicos), dataset
//   yf2b-mjr6 «Calendari laboral de Catalunya»: solo trae las fechas (sin
//   nombre ni ámbito) y alguna fila repetida, así que el nombre y el ámbito se
//   deducen de la fecha.
// - Festivos locales, dataset b4eh-r8up «Calendari de festes locals a
//   Catalunya»: dos fechas por municipio y año, sin el nombre de la fiesta
//   («Festiu local»). Algunos años traen filas erróneas (por ejemplo,
//   «C. A. de Catalunya» o nombres vacíos), que se descartan.
//
// La app solo añade, cambia o retira festivos con source = 'official'; los
// manuales nunca se tocan.

import { addDaysToDate, getTodayDate, isValidDate } from './overtime.js'

export const OFFICIAL_HOLIDAYS_API = 'https://analisi.transparenciacatalunya.cat'
export const LABOUR_CALENDAR_DATASET = 'yf2b-mjr6'
export const LOCAL_HOLIDAYS_DATASET = 'b4eh-r8up'
export const OFFICIAL_SOURCE = 'official'
export const MANUAL_SOURCE = 'manual'
export const OFFICIAL_NOTES = 'Calendario oficial de la Generalitat de Catalunya (actualizado automáticamente).'
// Como mucho una consulta al calendario oficial por día.
export const OFFICIAL_SYNC_MIN_HOURS = 20
// Una ley autonómica permite, como máximo, dos fiestas locales al año.
export const MAX_LOCAL_HOLIDAYS = 2

// Municipios con tiendas Panet (filtro de https://panet.cat/es/botigues/, sin
// Andorra). Código INE de 5 cifras, comprobado en el dataset de la
// Generalitat.
export const PANET_MUNICIPALITIES = Object.freeze([
  { code: '08005', name: 'L\'Ametlla del Vallès' },
  { code: '08006', name: 'Arenys de Mar' },
  { code: '08019', name: 'Barcelona' },
  { code: '08033', name: 'Caldes de Montbui' },
  { code: '08051', name: 'Castellar del Vallès' },
  { code: '08056', name: 'Castelldefels' },
  { code: '08073', name: 'Cornellà de Llobregat' },
  { code: '08089', name: 'Gavà' },
  { code: '08101', name: 'L\'Hospitalet de Llobregat' },
  { code: '08113', name: 'Manresa' },
  { code: '08114', name: 'Martorell' },
  { code: '08118', name: 'El Masnou' },
  { code: '08123', name: 'Molins de Rei' },
  { code: '08124', name: 'Mollet del Vallès' },
  { code: '08169', name: 'El Prat de Llobregat' },
  { code: '08187', name: 'Sabadell' },
  { code: '43905', name: 'Salou' },
  { code: '08200', name: 'Sant Boi de Llobregat' },
  { code: '08211', name: 'Sant Feliu de Llobregat' },
  { code: '43148', name: 'Tarragona' },
  { code: '08279', name: 'Terrassa' },
  { code: '43161', name: 'Valls' },
  { code: '08301', name: 'Viladecans' },
  { code: '08307', name: 'Vilanova i la Geltrú' },
].map(m => Object.freeze(m)))

const collator = new Intl.Collator('es', { sensitivity: 'base' })
// «L'Ametlla», «El Masnou»: se ordenan por el nombre, sin el artículo.
const sortKey = name => name.replace(/^(L'|El |La |Els |Les )/i, '')

/** Opciones del selector, en orden alfabético (sin contar el artículo). */
export const MUNICIPALITY_OPTIONS = Object.freeze(
  [...PANET_MUNICIPALITIES]
    .sort((a, b) => collator.compare(sortKey(a.name), sortKey(b.name)))
    .map(m => Object.freeze({ value: m.code, label: m.name })),
)

export function findMunicipality(code) {
  return PANET_MUNICIPALITIES.find(m => m.code === code) ?? null
}

// ------------------------------------------------------------ Consultas

function soqlUrl(dataset, where, limit) {
  const params = `$where=${encodeURIComponent(where)}&$order=data&$limit=${limit}`
  return `${OFFICIAL_HOLIDAYS_API}/resource/${dataset}.json?${params}`
}

/** Festivos laborales de Cataluña de un año. */
export function buildLabourCalendarUrl(year) {
  return soqlUrl(LABOUR_CALENDAR_DATASET, `any_calendari='${Number(year)}'`, 200)
}

/** Festivos locales de un municipio (núcleo principal, pedanía 000) y año. */
export function buildLocalHolidaysUrl(code, year) {
  if (!/^\d{5}$/.test(String(code))) throw new Error('Código de municipio no válido')
  return soqlUrl(LOCAL_HOLIDAYS_DATASET, `codi_municipi_ine='${code}' and any_calendari='${Number(year)}' and pedania='000'`, 50)
}

/** Años que se mantienen: el actual y el siguiente. */
export function getOfficialSyncYears(today = getTodayDate()) {
  const year = Number(today.slice(0, 4))
  return [year, year + 1]
}

// ------------------------------------------------------------ Lectura

/** '2026-05-25T00:00:00.000' → '2026-05-25' (o null si no es válida). */
export function parseApiDate(value) {
  const date = String(value ?? '').slice(0, 10)
  return isValidDate(date) ? date : null
}

function uniqueSortedDates(dates) {
  return [...new Set(dates.filter(Boolean))].sort()
}

/** Fechas de los festivos laborales de Cataluña de ese año (sin repetir). */
export function parseLabourRows(rows, year) {
  return uniqueSortedDates((Array.isArray(rows) ? rows : [])
    .map(row => parseApiDate(row?.data))
    .filter(date => date?.startsWith(`${year}-`)))
}

const LOCAL_TYPES = new Set(['festiu local', 'festa local'])
const INVALID_PLACES = new Set(['', 'null', 'c. a. de catalunya', 'catalunya'])

/**
 * Fechas de los festivos locales de ese año. Solo filas de fiesta local del
 * propio municipio: se descartan las de Cataluña, las sin nombre y las de
 * otros años.
 */
export function parseLocalRows(rows, year) {
  return uniqueSortedDates((Array.isArray(rows) ? rows : [])
    .filter(row => LOCAL_TYPES.has(String(row?.festiu ?? '').trim().toLowerCase()))
    .filter(row => !INVALID_PLACES.has(String(row?.ajuntament_o_nucli_municipal ?? '').trim().toLowerCase()))
    .map(row => parseApiDate(row?.data))
    .filter(date => date?.startsWith(`${year}-`)))
}

// ----------------------------------------------------------- Nombres

/** Domingo de Pascua (calendario gregoriano, algoritmo de Meeus/Jones/Butcher). */
export function getEasterSunday(year) {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

const FIXED_HOLIDAYS = {
  '01-01': ['Año Nuevo', 'national'],
  '01-06': ['Epifanía del Señor', 'national'],
  '05-01': ['Fiesta del Trabajo', 'national'],
  '06-24': ['San Juan', 'regional'],
  '08-15': ['Asunción de la Virgen', 'national'],
  '09-11': ['Diada Nacional de Cataluña', 'regional'],
  '10-12': ['Fiesta Nacional de España', 'national'],
  '11-01': ['Todos los Santos', 'national'],
  '12-06': ['Día de la Constitución', 'national'],
  '12-08': ['Inmaculada Concepción', 'national'],
  '12-25': ['Navidad', 'national'],
  '12-26': ['San Esteban', 'regional'],
}

/**
 * Nombre y ámbito de un festivo laboral de Cataluña a partir de su fecha
 * (el dataset no los trae). Una fecha desconocida (por ejemplo, un traslado)
 * se trata como festivo autonómico.
 */
export function describeLabourHoliday(date) {
  const year = Number(date.slice(0, 4))
  const easter = getEasterSunday(year)
  if (date === addDaysToDate(easter, -2)) return { name: 'Viernes Santo', scope: 'national' }
  if (date === addDaysToDate(easter, 1)) return { name: 'Lunes de Pascua', scope: 'regional' }
  const fixed = FIXED_HOLIDAYS[date.slice(5)]
  if (fixed) return { name: fixed[0], scope: fixed[1] }
  return { name: 'Festivo oficial de Cataluña', scope: 'regional' }
}

// -------------------------------------------------------- Festivos del año

/**
 * Festivos oficiales de un año para el municipio.
 * @returns {{
 *   year: number,
 *   published: boolean,       // hay calendario laboral de Cataluña ese año
 *   localPublished: boolean,  // hay festivos locales del municipio ese año
 *   localInconsistent: boolean, // más de dos fiestas locales: no se importan
 *   holidays: { holiday_date: string, name: string, scope: string, notes: string }[],
 * }}
 */
export function buildOfficialYear({ year, labourRows, localRows, municipalityName }) {
  const labour = parseLabourRows(labourRows, year)
  const local = parseLocalRows(localRows, year)
  const localInconsistent = local.length > MAX_LOCAL_HOLIDAYS
  const holidays = labour.map(date => ({ holiday_date: date, ...describeLabourHoliday(date), notes: OFFICIAL_NOTES }))
  if (!localInconsistent) {
    for (const date of local) {
      if (labour.includes(date)) continue
      holidays.push({ holiday_date: date, name: `Fiesta local de ${municipalityName}`, scope: 'local', notes: OFFICIAL_NOTES })
    }
  }
  holidays.sort((a, b) => a.holiday_date.localeCompare(b.holiday_date))
  return { year, published: labour.length > 0, localPublished: local.length > 0 && !localInconsistent, localInconsistent, holidays }
}

// -------------------------------------------------------- Sincronización

/**
 * Cambios para dejar los festivos oficiales de los años consultados como en
 * el calendario oficial. Reglas:
 * - Un año sin calendario laboral publicado no se toca (aún no se sabe nada).
 * - Los festivos manuales nunca se cambian ni se borran; si ocupan una fecha
 *   oficial, se respetan (no se puede tener dos festivos el mismo día).
 * - Los oficiales que ya no corresponden (por ejemplo, los locales de otro
 *   municipio) se retiran; los que cambian de nombre o ámbito se actualizan.
 * @returns {{ inserts: object[], updates: object[], deletes: string[], keptManual: number }}
 */
export function planOfficialSync({ existing = [], years = [] }) {
  const plan = { inserts: [], updates: [], deletes: [], keptManual: 0 }
  for (const result of years) {
    if (!result?.published) continue
    const prefix = `${result.year}-`
    const desired = new Map(result.holidays.map(h => [h.holiday_date, h]))
    const current = (existing ?? []).filter(h => String(h.holiday_date).startsWith(prefix))
    const byDate = new Map(current.map(h => [h.holiday_date, h]))

    for (const row of current) {
      if (row.source !== OFFICIAL_SOURCE) continue
      const wanted = desired.get(row.holiday_date)
      if (!wanted) plan.deletes.push(row.id)
      else if (row.name !== wanted.name || row.scope !== wanted.scope || (row.notes ?? null) !== wanted.notes) {
        plan.updates.push({ id: row.id, name: wanted.name, scope: wanted.scope, notes: wanted.notes })
      }
    }
    for (const holiday of desired.values()) {
      const row = byDate.get(holiday.holiday_date)
      if (!row) plan.inserts.push({ ...holiday, source: OFFICIAL_SOURCE })
      else if (row.source !== OFFICIAL_SOURCE) plan.keptManual++
    }
  }
  return plan
}

export function hasPlanChanges(plan) {
  return Boolean(plan && (plan.inserts.length || plan.updates.length || plan.deletes.length))
}

/** true si toca consultar el calendario oficial (nunca, o hace más de ~1 día). */
export function isOfficialSyncDue(syncedAt, now = new Date()) {
  if (!syncedAt) return true
  const last = new Date(syncedAt)
  if (Number.isNaN(last.getTime())) return true
  return now - last >= OFFICIAL_SYNC_MIN_HOURS * 3_600_000
}

/** Resumen por año a partir de los festivos guardados: { year, official, total }. */
export function summarizeOfficialYears(holidays, years) {
  return years.map((year) => {
    const ofYear = (holidays ?? []).filter(h => String(h.holiday_date).startsWith(`${year}-`))
    return {
      year,
      official: ofYear.filter(h => h.source === OFFICIAL_SOURCE).length,
      local: ofYear.filter(h => h.source === OFFICIAL_SOURCE && h.scope === 'local').length,
      total: ofYear.length,
    }
  })
}

/** «3 festivos añadidos, 1 actualizado y 2 retirados». */
export function describePlan(plan) {
  const parts = []
  const n = (count, one, many) => `${count} ${count === 1 ? one : many}`
  if (plan.inserts.length) parts.push(n(plan.inserts.length, 'festivo añadido', 'festivos añadidos'))
  if (plan.updates.length) parts.push(n(plan.updates.length, 'actualizado', 'actualizados'))
  if (plan.deletes.length) parts.push(n(plan.deletes.length, 'retirado', 'retirados'))
  if (!parts.length) return 'Sin cambios'
  const text = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} y ${parts.at(-1)}`
  return text.charAt(0).toUpperCase() + text.slice(1)
}
