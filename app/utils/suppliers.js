// Lógica pura de la gestión de proveedores (sin dependencias de Nuxt ni de
// Supabase) para poder probarla con pruebas unitarias: días de entrega,
// antelación, validación del formulario, nombres duplicados, búsqueda,
// filtros, orden y mensajes de error.
//
// Recordatorio: la validación de la interfaz es una ayuda. La base de datos
// tiene sus propias restricciones (migración 20261028221500) y la RLS es la
// que protege los datos.

import { DB_ERROR_KIND, classifyDatabaseError } from './database-errors.js'
import { normalizeSearchText } from './employees.js'
import { addDaysToDate, isValidDate } from './overtime.js'

// Columnas reales de public.suppliers (las del calendario, desde la migración
// 20261104130000).
export const SUPPLIER_COLUMNS = 'id, name, delivery_weekdays, order_lead_days, lead_days_overrides, delivery_every_weeks, delivery_anchor_date, order_mode, order_deadline, notes, is_active, created_at, updated_at'

// Cómo se piden: con días fijos (la agenda propone los pedidos) o a demanda
// (sin previsiones; los días de entrega son los días en que puede entregar).
export const ORDER_MODE = Object.freeze({
  SCHEDULED: 'scheduled',
  ON_DEMAND: 'on_demand',
})

export const ORDER_MODE_OPTIONS = Object.freeze([
  Object.freeze({ value: ORDER_MODE.SCHEDULED, label: 'Días fijos', description: 'La agenda propone cada pedido.' }),
  Object.freeze({ value: ORDER_MODE.ON_DEMAND, label: 'A demanda', description: 'Se pide cuando hace falta.' }),
])

// Frecuencia de las entregas: cada semana o cada dos (quincenal).
export const DELIVERY_FREQUENCY_OPTIONS = Object.freeze([
  Object.freeze({ value: 1, label: 'Cada semana' }),
  Object.freeze({ value: 2, label: 'Cada 2 semanas' }),
])

export const SUPPLIER_STATUS_FILTER = Object.freeze({
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  ALL: 'all',
})

// Límites de la interfaz. La base de datos no los impone.
export const SUPPLIER_FIELD_LIMITS = Object.freeze({
  name: 80,
  notes: 1000,
})

// Antelación con la que se prepara el pedido respecto a la entrega. Mismo
// rango que la restricción suppliers_order_lead_days_range.
export const MIN_ORDER_LEAD_DAYS = 0
export const MAX_ORDER_LEAD_DAYS = 7
export const DEFAULT_ORDER_LEAD_DAYS = 1

// Días de la semana con la numeración ISO de la base de datos (1 = lunes).
// `short` es la inicial habitual en España (X = miércoles).
export const WEEKDAYS = Object.freeze([
  { value: 1, short: 'L', abbr: 'lun', label: 'lunes' },
  { value: 2, short: 'M', abbr: 'mar', label: 'martes' },
  { value: 3, short: 'X', abbr: 'mié', label: 'miércoles' },
  { value: 4, short: 'J', abbr: 'jue', label: 'jueves' },
  { value: 5, short: 'V', abbr: 'vie', label: 'viernes' },
  { value: 6, short: 'S', abbr: 'sáb', label: 'sábado' },
  { value: 7, short: 'D', abbr: 'dom', label: 'domingo' },
].map(day => Object.freeze(day)))

const WEEKDAY_BY_VALUE = new Map(WEEKDAYS.map(day => [day.value, day]))

// Opciones del selector de antelación.
export const ORDER_LEAD_OPTIONS = Object.freeze(
  Array.from({ length: MAX_ORDER_LEAD_DAYS - MIN_ORDER_LEAD_DAYS + 1 }, (_, i) => {
    const value = MIN_ORDER_LEAD_DAYS + i
    return Object.freeze({ value, label: describeLeadDays(value) })
  }),
)

// Opciones del tiempo de entrega de los proveedores a demanda (mismos valores).
export const DELIVERY_TIME_OPTIONS = Object.freeze(
  Array.from({ length: MAX_ORDER_LEAD_DAYS - MIN_ORDER_LEAD_DAYS + 1 }, (_, i) => {
    const value = MIN_ORDER_LEAD_DAYS + i
    const label = value === 0 ? 'El mismo día' : value === 1 ? '1 día (24 h)' : value === 2 ? '2 días (48 h)' : `${value} días`
    return Object.freeze({ value, label })
  }),
)

const REQUIRED_MESSAGES = {
  name: 'Escribe el nombre del proveedor.',
}

const DUPLICATE_MESSAGE = 'Ya existe un proveedor con este nombre (puede estar entre los inactivos).'

// Restricciones de la migración → campo del formulario y mensaje.
const CONSTRAINT_ERRORS = {
  suppliers_name_not_blank: { name: 'name', message: 'El nombre no puede estar vacío ni contener solo espacios.' },
  suppliers_name_unique_idx: { name: 'name', message: DUPLICATE_MESSAGE },
  suppliers_delivery_weekdays_valid: { name: 'delivery_weekdays', message: 'Elige días de lunes a domingo.' },
  suppliers_order_lead_days_range: { name: 'order_lead_days', message: `La antelación debe ser de ${MIN_ORDER_LEAD_DAYS} a ${MAX_ORDER_LEAD_DAYS} días.` },
  suppliers_lead_days_overrides_valid: { name: 'day_leads', message: `Revisa la antelación de cada día (de ${MIN_ORDER_LEAD_DAYS} a ${MAX_ORDER_LEAD_DAYS} días).` },
  suppliers_delivery_every_weeks_valid: { name: 'delivery_every_weeks', message: 'Elige cada semana o cada 2 semanas.' },
  suppliers_delivery_anchor_valid: { name: 'delivery_anchor_date', message: 'Indica una fecha de entrega para saber qué semanas tocan.' },
  suppliers_order_mode_valid: { name: 'order_mode', message: 'Elige cómo se hace el pedido.' },
  suppliers_on_demand_weekly: { name: 'delivery_every_weeks', message: 'Un proveedor a demanda no tiene entregas quincenales.' },
  suppliers_order_deadline_valid: { name: 'order_deadline', message: 'Escribe la hora con horas y minutos (por ejemplo, 12:00).' },
}

const collator = new Intl.Collator('es', { sensitivity: 'base', numeric: true })
const listFormatter = new Intl.ListFormat('es', { style: 'long', type: 'conjunction' })

// ---------------------------------------------------------------- Días

/** Días válidos (1 a 7), sin repetir y en orden: ['4', 1, 4, 9] → [1, 4]. */
export function normalizeWeekdays(days) {
  const values = (Array.isArray(days) ? days : [])
    .map(Number)
    .filter(day => Number.isInteger(day) && WEEKDAY_BY_VALUE.has(day))
  return [...new Set(values)].sort((a, b) => a - b)
}

export function getWeekday(value) {
  return WEEKDAY_BY_VALUE.get(Number(value)) ?? null
}

/**
 * Día de la semana en que se prepara un pedido que se entrega `deliveryDay`
 * con `leadDays` de antelación: entrega el lunes (1) con 1 día → domingo (7).
 */
export function getPreparationWeekday(deliveryDay, leadDays) {
  const day = Number(deliveryDay)
  const lead = Number(leadDays)
  return ((((day - 1 - lead) % 7) + 7) % 7) + 1
}

/** «lunes y jueves», «lunes, miércoles y viernes», «todos los días». */
export function formatWeekdayList(days) {
  const values = normalizeWeekdays(days)
  if (values.length === 0) return ''
  if (values.length === 7) return 'todos los días'
  return listFormatter.format(values.map(day => getWeekday(day).label))
}

/** «El mismo día», «1 día antes», «3 días antes». */
export function describeLeadDays(leadDays) {
  const lead = Number(leadDays)
  if (lead === 0) return 'El mismo día'
  return lead === 1 ? '1 día antes' : `${lead} días antes`
}

function isValidLead(value) {
  return Number.isInteger(value) && value >= MIN_ORDER_LEAD_DAYS && value <= MAX_ORDER_LEAD_DAYS
}

/**
 * Antelaciones propias de algunos días ({ "1": 3 }), limpias: solo días de
 * entrega, valores válidos y distintos de la antelación general (si son
 * iguales no hace falta guardarlos).
 */
export function normalizeLeadOverrides(overrides, weekdays, baseLead = null) {
  const days = normalizeWeekdays(weekdays)
  const result = {}
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) return result
  for (const day of days) {
    const raw = overrides[day] ?? overrides[String(day)]
    if (raw === undefined || raw === null || raw === '') continue
    const value = Number(raw)
    if (!isValidLead(value)) continue
    if (baseLead !== null && value === Number(baseLead)) continue
    result[String(day)] = value
  }
  return result
}

/** Antelación con la que se prepara la entrega de ese día de la semana. */
export function getLeadDaysFor(supplier, weekday) {
  const override = supplier?.lead_days_overrides?.[String(weekday)]
  if (override !== undefined && override !== null && isValidLead(Number(override))) return Number(override)
  const lead = Number(supplier?.order_lead_days ?? DEFAULT_ORDER_LEAD_DAYS)
  return isValidLead(lead) ? lead : DEFAULT_ORDER_LEAD_DAYS
}

export function isOnDemand(supplier) {
  return supplier?.order_mode === ORDER_MODE.ON_DEMAND
}

export function isBiweekly(supplier) {
  return Number(supplier?.delivery_every_weeks) === 2 && isValidDate(supplier?.delivery_anchor_date)
}

/** true si el proveedor genera previsiones en la agenda (días fijos y activo). */
export function hasScheduledDeliveries(supplier) {
  return Boolean(supplier?.is_active) && !isOnDemand(supplier) && normalizeWeekdays(supplier?.delivery_weekdays).length > 0
}

function isoWeekdayOf(date) {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay()
  return day === 0 ? 7 : day
}

function mondayOf(date) {
  return addDaysToDate(date, 1 - isoWeekdayOf(date))
}

function weeksBetween(a, b) {
  const ms = new Date(`${mondayOf(b)}T00:00:00Z`) - new Date(`${mondayOf(a)}T00:00:00Z`)
  return Math.round(ms / 604_800_000)
}

/**
 * true si la semana (de lunes a domingo) de `date` es de entrega. Las
 * semanales siempre; las quincenales, las semanas a un número par de semanas
 * de la fecha de referencia (antes o después).
 */
export function isDeliveryWeek(supplier, date) {
  if (!isBiweekly(supplier)) return true
  return weeksBetween(supplier.delivery_anchor_date, date) % 2 === 0
}

/** Próximas `count` fechas de entrega desde `from` (incluida), según el calendario. */
export function getNextDeliveryDates(supplier, from, count = 1) {
  const days = normalizeWeekdays(supplier?.delivery_weekdays)
  const dates = []
  if (!days.length || !isValidDate(from)) return dates
  for (let i = 0, date = from; i < 7 * 4 * 2 && dates.length < count; i++, date = addDaysToDate(date, 1)) {
    if (days.includes(isoWeekdayOf(date)) && isDeliveryWeek(supplier, date)) dates.push(date)
  }
  return dates
}

/**
 * Pedido a demanda que se hace hoy: la entrega posible más próxima (un día de
 * entrega al que le dé tiempo con su antelación) y la preparación, hoy.
 * Sin días de entrega: hoy + antelación general.
 * @returns {{ delivery_date: string, prepare_date: string }}
 */
export function getOnDemandOrderDates(supplier, today) {
  const days = normalizeWeekdays(supplier?.delivery_weekdays)
  if (!days.length) {
    return { delivery_date: addDaysToDate(today, getLeadDaysFor(supplier, 0)), prepare_date: today }
  }
  for (let i = 0, date = today; i < 21; i++, date = addDaysToDate(date, 1)) {
    const weekday = isoWeekdayOf(date)
    if (days.includes(weekday) && addDaysToDate(today, getLeadDaysFor(supplier, weekday)) <= date) {
      return { delivery_date: date, prepare_date: today }
    }
  }
  return { delivery_date: addDaysToDate(today, getLeadDaysFor(supplier, days[0])), prepare_date: today }
}

// ------------------------------------------------------------ Hora límite

/** '12:00:00' → '12:00'; vacío o no válido → ''. */
export function formatDeadline(value) {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(value ?? ''))
  if (!match) return ''
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return ''
  return `${String(hours).padStart(2, '0')}:${match[2]}`
}

/** Texto para guardar: 'HH:MM' o null. */
export function normalizeDeadline(value) {
  return formatDeadline(value) || null
}

/** «Pedir antes de las 12:00» o «Pedir antes de la 1:00». */
export function describeDeadline(value) {
  const time = formatDeadline(value)
  if (!time) return ''
  const hours = Number(time.slice(0, 2))
  const shown = `${hours}:${time.slice(3)}`
  return `Pedir antes de ${hours === 1 ? 'la' : 'las'} ${shown}`
}

/**
 * Texto corto para la lista de proveedores: «1 día antes», «3 días antes
 * (lun) · 1 día antes (jue)», «A demanda · 2 días» o «Cada 2 semanas · …».
 */
export function describeSupplierPreparationShort(supplier) {
  const days = normalizeWeekdays(supplier?.delivery_weekdays)
  if (isOnDemand(supplier)) {
    return `A demanda · ${describeLeadDays(getLeadDaysFor(supplier, days[0] ?? 0)).replace(' antes', '').toLowerCase()}`
  }
  if (!days.length) return ''
  const groups = new Map()
  for (const day of days) {
    const lead = getLeadDaysFor(supplier, day)
    if (!groups.has(lead)) groups.set(lead, [])
    groups.get(lead).push(getWeekday(day).abbr)
  }
  const lead = groups.size === 1
    ? describeLeadDays([...groups.keys()][0])
    : [...groups.entries()].map(([value, abbrs]) => `${describeLeadDays(value)} (${abbrs.join(', ')})`).join(' · ')
  return isBiweekly(supplier) ? `Cada 2 semanas · ${lead.charAt(0).toLowerCase()}${lead.slice(1)}` : lead
}

// ---------------------------------------------------------- Resumen

const anchorFormatter = new Intl.DateTimeFormat('es-ES', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })

function formatAnchor(date) {
  return anchorFormatter.format(new Date(`${date}T00:00:00Z`)).replaceAll('.', '')
}

/**
 * Resumen legible del calendario de un proveedor (o de los valores del
 * formulario, ya normalizados o no).
 * @returns {{ hasDeliveries: boolean, onDemand: boolean, delivery: string, preparation: string, deadline: string }}
 */
export function describeSupplierSchedule(values = {}) {
  const data = 'day_leads' in values || 'custom_leads' in values ? scheduleFromForm(values) : values
  const deliveries = normalizeWeekdays(data.delivery_weekdays)
  const onDemand = isOnDemand(data)
  const deadline = describeDeadline(data.order_deadline)
  const supplier = { ...data, lead_days_overrides: data.lead_days_overrides ?? {} }

  if (deliveries.length === 0) {
    return {
      hasDeliveries: false,
      onDemand,
      delivery: onDemand ? 'A demanda, sin días de entrega concretos' : 'Sin días de entrega habituales',
      preparation: onDemand
        ? `No aparece en la agenda: crea el pedido cuando haga falta (entrega ${describeLeadDays(getLeadDaysFor(supplier, 0)).replace(' antes', ' después').toLowerCase()}).`
        : 'No aparecerá en la agenda; podrás crear sus pedidos a mano.',
      deadline,
    }
  }

  // Días con la misma antelación, agrupados: «el viernes para el lunes (3 días antes)».
  const groups = new Map()
  for (const day of deliveries) {
    const lead = getLeadDaysFor(supplier, day)
    if (!groups.has(lead)) groups.set(lead, [])
    groups.get(lead).push(day)
  }

  let preparation
  if (onDemand) {
    const parts = [...groups.entries()].map(([lead, days]) =>
      groups.size === 1 ? describeLeadDays(lead).toLowerCase() : `${describeLeadDays(lead).toLowerCase()} para el ${formatWeekdayList(days)}`)
    preparation = `No aparece en la agenda: crea el pedido cuando haga falta. Se pide ${listFormatter.format(parts)} de la entrega.`
  }
  else if (groups.size === 1) {
    const [[lead]] = groups
    preparation = lead === 0
      ? 'Se prepara el mismo día de la entrega.'
      : `Se prepara el ${listFormatter.format(deliveries.map(day => getWeekday(getPreparationWeekday(day, lead)).label))} (${describeLeadDays(lead).toLowerCase()}).`
  }
  else {
    const parts = deliveries.map((day) => {
      const lead = getLeadDaysFor(supplier, day)
      return lead === 0
        ? `el mismo ${getWeekday(day).label}`
        : `el ${getWeekday(getPreparationWeekday(day, lead)).label} para el ${getWeekday(day).label} (${describeLeadDays(lead).toLowerCase()})`
    })
    preparation = `Se prepara ${listFormatter.format(parts)}.`
  }

  let delivery
  if (onDemand) delivery = `A demanda · puede entregar: ${formatWeekdayList(deliveries)}`
  else if (Number(data.delivery_every_weeks) === 2) {
    delivery = `Entrega cada 2 semanas: ${formatWeekdayList(deliveries)}`
    if (isValidDate(data.delivery_anchor_date)) {
      delivery += ` (semanas del ${formatAnchor(data.delivery_anchor_date)}, alternas)`
    }
  }
  else delivery = `Entrega: ${formatWeekdayList(deliveries)}`

  return { hasDeliveries: true, onDemand, delivery, preparation, deadline }
}

// --------------------------------------------------------- Nombre único

// Misma regla que el índice suppliers_name_unique_idx: vocales con acento
// agudo, grave, circunflejo o diéresis → sin acento. «ñ» y «ç» se conservan.
const ACCENTED = 'ÁÀÂÄáàâäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÖóòôöÚÙÛÜúùûüÑÇ'
const PLAIN = 'aaaaaaaaeeeeeeeeiiiiiiiioooooooouuuuuuuuñç'
const ACCENT_MAP = new Map(Array.from(ACCENTED).map((char, i) => [char, PLAIN[i]]))

/**
 * Clave con la que se comparan los nombres de proveedor, igual que el índice
 * único de la base de datos: forma Unicode NFC, espacios repetidos reducidos
 * a uno y recortados, sin acentos en las vocales y en minúsculas.
 * «  Panadería  SÒL » → «panaderia sol»; «Peña» y «Pena» siguen siendo distintos.
 */
export function getSupplierNameKey(name) {
  const compact = String(name ?? '')
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .trim()
  return Array.from(compact, char => ACCENT_MAP.get(char) ?? char)
    .join('')
    .toLowerCase()
}

/** Otro proveedor (activo o no) con el mismo nombre, o null. */
export function findDuplicateSupplier(suppliers, name, excludeId = null) {
  const key = getSupplierNameKey(name)
  if (!key) return null
  return (suppliers ?? []).find(supplier =>
    supplier.id !== excludeId && getSupplierNameKey(supplier.name) === key,
  ) ?? null
}

// ------------------------------------------------------------- Formulario

/** Texto sin espacios sobrantes; null si queda vacío. */
function cleanOptional(value) {
  const text = String(value ?? '').trim()
  return text === '' ? null : text
}

/** Una sola línea, sin espacios repetidos, en forma Unicode NFC. */
function cleanName(value) {
  return String(value ?? '').normalize('NFC').replace(/\s+/g, ' ').trim()
}

function toLeadDays(value) {
  if (value === '' || value === null || value === undefined) return Number.NaN
  return Number(value)
}

/** Calendario (columnas de la base de datos) a partir de los valores del formulario. */
function scheduleFromForm(values = {}) {
  const orderMode = values.order_mode === ORDER_MODE.ON_DEMAND ? ORDER_MODE.ON_DEMAND : ORDER_MODE.SCHEDULED
  const weekdays = normalizeWeekdays(values.delivery_weekdays)
  const lead = toLeadDays(values.order_lead_days)
  const everyWeeks = orderMode === ORDER_MODE.SCHEDULED && Number(values.delivery_every_weeks) === 2 ? 2 : 1
  const anchor = String(values.delivery_anchor_date ?? '').trim()
  return {
    delivery_weekdays: weekdays,
    order_lead_days: lead,
    lead_days_overrides: orderMode === ORDER_MODE.SCHEDULED && values.custom_leads
      ? normalizeLeadOverrides(values.day_leads, weekdays, lead)
      : {},
    delivery_every_weeks: everyWeeks,
    delivery_anchor_date: everyWeeks === 2 ? (anchor || null) : null,
    order_mode: orderMode,
    order_deadline: normalizeDeadline(values.order_deadline),
  }
}

/**
 * Prepara los valores del formulario para enviarlos a Supabase. Las notas
 * vacías se guardan como null; las antelaciones por día solo se guardan si
 * son distintas de la general.
 */
export function normalizeSupplierInput(values = {}) {
  return {
    name: cleanName(values.name),
    ...scheduleFromForm(values),
    notes: cleanOptional(values.notes),
  }
}

/** Valores iniciales del formulario: los del proveedor o los predeterminados. */
export function toSupplierFormValues(supplier = null) {
  const weekdays = normalizeWeekdays(supplier?.delivery_weekdays)
  const overrides = normalizeLeadOverrides(supplier?.lead_days_overrides, weekdays)
  const lead = supplier?.order_lead_days ?? DEFAULT_ORDER_LEAD_DAYS
  return {
    name: supplier?.name ?? '',
    order_mode: supplier?.order_mode === ORDER_MODE.ON_DEMAND ? ORDER_MODE.ON_DEMAND : ORDER_MODE.SCHEDULED,
    delivery_weekdays: weekdays,
    order_lead_days: lead,
    custom_leads: Object.keys(overrides).length > 0,
    // Antelación de cada día de la semana (los que no tienen propia, la general).
    day_leads: Object.fromEntries(WEEKDAYS.map(day => [day.value, overrides[day.value] ?? lead])),
    delivery_every_weeks: Number(supplier?.delivery_every_weeks) === 2 ? 2 : 1,
    delivery_anchor_date: supplier?.delivery_anchor_date ?? '',
    order_deadline: formatDeadline(supplier?.order_deadline),
    notes: supplier?.notes ?? '',
  }
}

function duplicateMessage(duplicate) {
  return duplicate.is_active
    ? `Ya existe un proveedor con este nombre: «${duplicate.name}».`
    : `Ya existe «${duplicate.name}», desactivado. Actívalo desde «Inactivos» en lugar de crear otro.`
}

/**
 * Errores de validación con el formato de UForm: [{ name, message }].
 * `suppliers` (opcional) es la lista cargada, para avisar de nombres
 * duplicados antes de guardar; `currentId` es el proveedor que se edita.
 */
export function validateSupplierInput(values = {}, { suppliers = [], currentId = null } = {}) {
  const data = normalizeSupplierInput(values)
  const errors = []

  if (!data.name) {
    errors.push({ name: 'name', message: REQUIRED_MESSAGES.name })
  }
  else if (Array.from(data.name).length > SUPPLIER_FIELD_LIMITS.name) {
    errors.push({ name: 'name', message: `Máximo ${SUPPLIER_FIELD_LIMITS.name} caracteres.` })
  }
  else {
    const duplicate = findDuplicateSupplier(suppliers, data.name, currentId)
    if (duplicate) errors.push({ name: 'name', message: duplicateMessage(duplicate) })
  }

  const lead = data.order_lead_days
  if (!isValidLead(lead)) {
    errors.push({ name: 'order_lead_days', message: `Elige una antelación de ${MIN_ORDER_LEAD_DAYS} a ${MAX_ORDER_LEAD_DAYS} días.` })
  }

  if (data.order_mode === ORDER_MODE.SCHEDULED && values.custom_leads) {
    const invalid = data.delivery_weekdays.some((day) => {
      const value = values.day_leads?.[day] ?? values.day_leads?.[String(day)]
      return !isValidLead(Number(value === '' || value === null || value === undefined ? Number.NaN : value))
    })
    if (invalid) {
      errors.push({ name: 'day_leads', message: `Elige la antelación de cada día (de ${MIN_ORDER_LEAD_DAYS} a ${MAX_ORDER_LEAD_DAYS} días).` })
    }
  }

  if (data.delivery_every_weeks === 2) {
    if (data.delivery_weekdays.length === 0) {
      errors.push({ name: 'delivery_weekdays', message: 'Elige al menos un día de entrega para las entregas cada 2 semanas.' })
    }
    const anchor = data.delivery_anchor_date
    if (!anchor) {
      errors.push({ name: 'delivery_anchor_date', message: 'Indica una fecha de entrega para saber qué semanas tocan.' })
    }
    else if (!isValidDate(anchor)) {
      errors.push({ name: 'delivery_anchor_date', message: 'Escribe una fecha válida.' })
    }
    else if (data.delivery_weekdays.length && !data.delivery_weekdays.includes(isoWeekdayOf(anchor))) {
      errors.push({ name: 'delivery_anchor_date', message: `Elige una fecha que caiga en ${formatWeekdayList(data.delivery_weekdays)}.` })
    }
  }

  if (String(values.order_deadline ?? '').trim() && !data.order_deadline) {
    errors.push({ name: 'order_deadline', message: 'Escribe la hora con horas y minutos (por ejemplo, 12:00).' })
  }

  if (data.notes && Array.from(data.notes).length > SUPPLIER_FIELD_LIMITS.notes) {
    errors.push({ name: 'notes', message: `Máximo ${SUPPLIER_FIELD_LIMITS.notes} caracteres.` })
  }

  return errors
}

/** true si los datos normalizados difieren del proveedor guardado. */
export function hasSupplierChanges(supplier, values) {
  if (!supplier) return true
  const data = normalizeSupplierInput(values)
  const savedOverrides = normalizeLeadOverrides(supplier.lead_days_overrides, supplier.delivery_weekdays)
  return supplier.name !== data.name
    || (supplier.notes ?? null) !== data.notes
    || Number(supplier.order_lead_days) !== data.order_lead_days
    || normalizeWeekdays(supplier.delivery_weekdays).join(',') !== data.delivery_weekdays.join(',')
    || JSON.stringify(savedOverrides) !== JSON.stringify(data.lead_days_overrides)
    || (Number(supplier.delivery_every_weeks) === 2 ? 2 : 1) !== data.delivery_every_weeks
    || (supplier.delivery_anchor_date ?? null) !== data.delivery_anchor_date
    || (supplier.order_mode ?? ORDER_MODE.SCHEDULED) !== data.order_mode
    || (normalizeDeadline(supplier.order_deadline)) !== data.order_deadline
}

// -------------------------------------------------------- Listado

/** Busca en el nombre, sin distinguir mayúsculas ni tildes. */
export function matchesSupplierSearch(supplier, query) {
  const terms = normalizeSearchText(query).split(' ').filter(Boolean)
  if (terms.length === 0) return true
  const haystack = normalizeSearchText(supplier?.name)
  return terms.every(term => haystack.includes(term))
}

export function matchesSupplierStatus(supplier, status) {
  if (status === SUPPLIER_STATUS_FILTER.ACTIVE) return supplier.is_active === true
  if (status === SUPPLIER_STATUS_FILTER.INACTIVE) return supplier.is_active === false
  return true
}

export function filterSuppliers(suppliers, { status = SUPPLIER_STATUS_FILTER.ACTIVE, query = '' } = {}) {
  return (suppliers ?? []).filter(supplier =>
    matchesSupplierStatus(supplier, status) && matchesSupplierSearch(supplier, query),
  )
}

export function countSuppliers(suppliers) {
  const list = suppliers ?? []
  const active = list.filter(s => s.is_active === true).length
  return { active, inactive: list.length - active, all: list.length }
}

/** Orden alfabético en español (ignora tildes y mayúsculas). */
export function sortSuppliers(suppliers) {
  return [...(suppliers ?? [])].sort((a, b) =>
    collator.compare(a.name ?? '', b.name ?? '')
    || String(a.id).localeCompare(String(b.id)),
  )
}

/** Sustituye (o añade) un proveedor y devuelve la lista ordenada. */
export function upsertSupplier(suppliers, supplier) {
  const others = (suppliers ?? []).filter(s => s.id !== supplier.id)
  return sortSuppliers([...others, supplier])
}

// -------------------------------------------------------- Errores

/**
 * Errores de campo a partir de un error de restricción de la base de datos.
 * @returns {{ name: string, message: string }[]}
 */
export function getSupplierFieldErrors(error) {
  const message = String(error?.message ?? '')

  if (['23514', '23505'].includes(error?.code)) {
    const constraint = Object.keys(CONSTRAINT_ERRORS).find(name => message.includes(name))
    if (constraint) return [{ ...CONSTRAINT_ERRORS[constraint] }]
  }

  if (error?.code === '23502' && message.includes('"name"')) {
    return [{ name: 'name', message: REQUIRED_MESSAGES.name }]
  }

  return []
}

const MESSAGES = {
  load: {
    [DB_ERROR_KIND.NETWORK]: 'Comprueba la conexión a Internet y vuelve a intentarlo.',
    [DB_ERROR_KIND.UNKNOWN]: 'El servidor no ha respondido como se esperaba. Vuelve a intentarlo en unos minutos.',
  },
  save: {
    [DB_ERROR_KIND.NETWORK]: 'No se han podido guardar los cambios. Comprueba la conexión a Internet y vuelve a intentarlo.',
    [DB_ERROR_KIND.UNKNOWN]: 'No se han podido guardar los cambios. Vuelve a intentarlo.',
  },
  status: {
    [DB_ERROR_KIND.NETWORK]: 'No se ha podido cambiar el estado. Comprueba la conexión a Internet y vuelve a intentarlo.',
    [DB_ERROR_KIND.UNKNOWN]: 'No se ha podido cambiar el estado. Vuelve a intentarlo.',
  },
}

const SCHEDULE_MISSING_MESSAGE = 'La base de datos aún no está preparada para el calendario de proveedores: falta aplicar su migración (SUPABASE_SETUP.md, sección 12).'

const COMMON_MESSAGES = {
  [DB_ERROR_KIND.EXPIRED]: 'Tu sesión ha caducado. Vuelve a iniciar sesión para continuar.',
  [DB_ERROR_KIND.PERMISSION]: 'Esta cuenta no tiene permiso para gestionar proveedores.',
  [DB_ERROR_KIND.MISSING]: 'La base de datos aún no está preparada para gestionar proveedores: falta aplicar su migración (SUPABASE_SETUP.md, sección 10).',
  [DB_ERROR_KIND.NOT_FOUND]: 'No se ha encontrado este proveedor. Recarga la lista para ver los datos actuales.',
  [DB_ERROR_KIND.VALIDATION]: 'Revisa los datos del formulario.',
}

/**
 * Mensaje para la persona usuaria (nunca el mensaje técnico original) y, si
 * se puede, los errores de cada campo.
 *
 * @param {{ error?: any, status?: number }} response
 * @param {'load' | 'save' | 'status'} action
 */
export function getSupplierErrorFeedback(response, action = 'save') {
  // Columna inexistente (42703): falta la migración del calendario de
  // proveedores (20261104130000), que añade columnas que la app ya usa.
  if (response?.error?.code === '42703') {
    return { kind: DB_ERROR_KIND.MISSING, message: SCHEDULE_MISSING_MESSAGE, fields: [] }
  }
  const kind = classifyDatabaseError(response) ?? DB_ERROR_KIND.UNKNOWN
  const fields = kind === DB_ERROR_KIND.VALIDATION ? getSupplierFieldErrors(response?.error) : []
  const duplicate = fields.some(field => field.message === DUPLICATE_MESSAGE)
  const message = duplicate
    ? DUPLICATE_MESSAGE
    : COMMON_MESSAGES[kind]
      ?? MESSAGES[action]?.[kind]
      ?? MESSAGES[action]?.[DB_ERROR_KIND.UNKNOWN]
      ?? MESSAGES.save[DB_ERROR_KIND.UNKNOWN]

  return { kind, message, fields }
}
