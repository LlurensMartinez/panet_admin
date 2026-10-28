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

// Columnas reales de public.suppliers.
export const SUPPLIER_COLUMNS = 'id, name, delivery_weekdays, order_lead_days, notes, is_active, created_at, updated_at'

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

/**
 * Resumen legible del calendario de un proveedor (o de los valores del
 * formulario).
 * @returns {{ hasDeliveries: boolean, delivery: string, preparation: string }}
 */
export function describeSupplierSchedule({ delivery_weekdays: days, order_lead_days: lead } = {}) {
  const deliveries = normalizeWeekdays(days)
  if (deliveries.length === 0) {
    return {
      hasDeliveries: false,
      delivery: 'Sin días de entrega habituales',
      preparation: 'No aparecerá en la agenda; podrás crear sus pedidos a mano.',
    }
  }

  const leadDays = Number(lead ?? DEFAULT_ORDER_LEAD_DAYS)
  const preparationDays = deliveries.map(day => getPreparationWeekday(day, leadDays))
  const preparation = leadDays === 0
    ? 'Se prepara el mismo día de la entrega.'
    : `Se prepara el ${listFormatter.format(preparationDays.map(day => getWeekday(day).label))} (${describeLeadDays(leadDays).toLowerCase()}).`

  return {
    hasDeliveries: true,
    delivery: `Entrega: ${formatWeekdayList(deliveries)}`,
    preparation,
  }
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

/**
 * Prepara los valores del formulario para enviarlos a Supabase. Las notas
 * vacías se guardan como null.
 */
export function normalizeSupplierInput(values = {}) {
  return {
    name: cleanName(values.name),
    delivery_weekdays: normalizeWeekdays(values.delivery_weekdays),
    order_lead_days: toLeadDays(values.order_lead_days),
    notes: cleanOptional(values.notes),
  }
}

/** Valores iniciales del formulario: los del proveedor o los predeterminados. */
export function toSupplierFormValues(supplier = null) {
  return {
    name: supplier?.name ?? '',
    delivery_weekdays: normalizeWeekdays(supplier?.delivery_weekdays),
    order_lead_days: supplier?.order_lead_days ?? DEFAULT_ORDER_LEAD_DAYS,
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
  if (!Number.isInteger(lead) || lead < MIN_ORDER_LEAD_DAYS || lead > MAX_ORDER_LEAD_DAYS) {
    errors.push({ name: 'order_lead_days', message: `Elige una antelación de ${MIN_ORDER_LEAD_DAYS} a ${MAX_ORDER_LEAD_DAYS} días.` })
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
  return supplier.name !== data.name
    || (supplier.notes ?? null) !== data.notes
    || Number(supplier.order_lead_days) !== data.order_lead_days
    || normalizeWeekdays(supplier.delivery_weekdays).join(',') !== data.delivery_weekdays.join(',')
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
