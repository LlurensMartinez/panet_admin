// Lógica pura de la agenda y el historial de pedidos (sin dependencias de
// Nuxt ni de Supabase) para poder probarla con pruebas unitarias.
//
// Reglas (SPEC.md 3.4 y DATA_MODEL.md, tabla `orders`):
// - Las previsiones se CALCULAN a partir de los días de entrega y la antelación
//   de cada proveedor activo. Nunca se guardan al abrir la agenda: solo se crea
//   una fila cuando la encargada actúa sobre una previsión.
// - Una previsión no se muestra si ya hay un pedido guardado del mismo
//   proveedor con esa fecha como entrega prevista de origen
//   (scheduled_delivery_date) o como fecha de entrega (delivery_date).
// - Agenda: pendientes atrasados (preparación en los 7 días anteriores), hoy y
//   los 14 días siguientes, agrupados por fecha de preparación.
// - Los festivos solo generan avisos: nunca mueven ni cancelan pedidos.
//
// Todas las fechas son de calendario (YYYY-MM-DD, zona de la tienda): no hay
// desfases por zona horaria ni por el cambio de hora.

import { DB_ERROR_KIND, classifyDatabaseError } from './database-errors.js'
import { addDaysToDate, isValidDate } from './overtime.js'
import { findHolidayByDate, getScopeLabel, HOLIDAY_MAX_YEAR, HOLIDAY_MIN_YEAR } from './holidays.js'
import { getSupplierNameKey, normalizeWeekdays } from './suppliers.js'

// Columnas reales de public.orders (migración 20261028221500) y el proveedor.
export const ORDER_COLUMNS = 'id, supplier_id, scheduled_delivery_date, delivery_date, prepare_date, status, prepared_at, notes, created_at, updated_at, supplier:suppliers(id, name, is_active, order_lead_days)'

// Columnas que la cuenta autorizada puede modificar (permiso UPDATE por
// columnas). Nunca se envían supplier_id ni scheduled_delivery_date en un
// UPDATE: la base de datos lo rechazaría.
export const ORDER_UPDATABLE_FIELDS = Object.freeze(['delivery_date', 'prepare_date', 'status', 'notes'])

export const ORDER_STATUS = Object.freeze({
  PENDING: 'pending',
  PREPARED: 'prepared',
  SKIPPED: 'skipped',
})

export const ORDER_STATUS_LABELS = Object.freeze({
  pending: 'Pendiente',
  prepared: 'Preparado',
  skipped: 'No se pide',
})

export const AGENDA_OVERDUE_DAYS = 7
export const AGENDA_UPCOMING_DAYS = 14
// La antelación máxima de un proveedor (suppliers_order_lead_days_range).
const MAX_LEAD_DAYS = 7

export const ORDER_FIELD_LIMITS = Object.freeze({ notes: 1000 })
export const HISTORY_PAGE_SIZE = 20

const collator = new Intl.Collator('es', { sensitivity: 'base', numeric: true })
const SHOP_TIME_ZONE = 'Europe/Madrid'

// ------------------------------------------------------------------ Fechas

/** Día de la semana ISO (1 = lunes … 7 = domingo) de una fecha YYYY-MM-DD. */
export function getIsoWeekday(date) {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay()
  return day === 0 ? 7 : day
}

/** Días entre dos fechas (b − a). */
export function daysBetween(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000)
}

/** Fechas que muestra la agenda: preparación entre hace 7 días y dentro de 14. */
export function getAgendaRange(today) {
  return {
    from: addDaysToDate(today, -AGENDA_OVERDUE_DAYS),
    today,
    to: addDaysToDate(today, AGENDA_UPCOMING_DAYS),
  }
}

/**
 * Fechas de los pedidos guardados que hay que cargar para la agenda:
 * - los que se preparan dentro de la agenda;
 * - los que ocultan una previsión de la agenda: su entrega prevista de origen
 *   o su fecha de entrega caen en las entregas posibles de la agenda (la
 *   entrega puede ser hasta 7 días posterior a la preparación).
 */
export function getAgendaQueryRange(today) {
  const { from, to } = getAgendaRange(today)
  return { from, to, deliveryTo: addDaysToDate(to, MAX_LEAD_DAYS) }
}

/** Fecha de preparación por defecto: la entrega menos la antelación. */
export function getDefaultPrepareDate(deliveryDate, leadDays) {
  if (!isValidDate(deliveryDate)) return ''
  const lead = Number.isInteger(Number(leadDays)) ? Number(leadDays) : 0
  return addDaysToDate(deliveryDate, -lead)
}

// -------------------------------------------------------------- Previsiones

function forecastKey(supplierId, deliveryDate) {
  return `forecast:${supplierId}:${deliveryDate}`
}

/**
 * Previsiones del calendario de los proveedores activos cuya fecha de
 * preparación cae entre `from` y `to` (ambos incluidos). No consultan ni
 * escriben nada: se recalculan cada vez, así que recargar la página o cambiar
 * de día no puede duplicar pedidos.
 */
export function buildForecasts(suppliers, { from, to }) {
  const forecasts = []
  for (const supplier of suppliers ?? []) {
    if (!supplier?.is_active) continue
    const days = normalizeWeekdays(supplier.delivery_weekdays)
    if (days.length === 0) continue
    const lead = Number(supplier.order_lead_days ?? 0)

    // Entregas cuya preparación (entrega − antelación) cae en el rango.
    const last = addDaysToDate(to, lead)
    for (let delivery = addDaysToDate(from, lead); delivery <= last; delivery = addDaysToDate(delivery, 1)) {
      if (!days.includes(getIsoWeekday(delivery))) continue
      forecasts.push({
        key: forecastKey(supplier.id, delivery),
        isForecast: true,
        id: null,
        supplier_id: supplier.id,
        supplier,
        scheduled_delivery_date: delivery,
        delivery_date: delivery,
        prepare_date: addDaysToDate(delivery, -lead),
        status: ORDER_STATUS.PENDING,
        prepared_at: null,
        notes: null,
      })
    }
  }
  return forecasts
}

/** true si un pedido guardado ya ocupa esa previsión. */
export function isForecastCovered(forecast, orders) {
  return (orders ?? []).some(order =>
    order.supplier_id === forecast.supplier_id
    && (order.scheduled_delivery_date === forecast.scheduled_delivery_date
      || order.delivery_date === forecast.scheduled_delivery_date),
  )
}

/** Un pedido guardado con el formato de la agenda. */
export function toAgendaItem(order, suppliersById = new Map()) {
  return {
    ...order,
    key: `order:${order.id}`,
    isForecast: false,
    supplier: order.supplier ?? suppliersById.get(order.supplier_id) ?? null,
  }
}

function compareItems(a, b) {
  return collator.compare(a.supplier?.name ?? '', b.supplier?.name ?? '')
    || String(a.delivery_date).localeCompare(String(b.delivery_date))
    || String(a.key).localeCompare(String(b.key))
}

/** Aviso de festivo para la fecha de entrega, o null. */
export function getHolidayWarning(deliveryDate, holidays) {
  const holiday = findHolidayByDate(holidays, deliveryDate)
  if (!holiday) return null
  return {
    holiday,
    message: `La entrega coincide con un festivo: ${holiday.name} (${getScopeLabel(holiday.scope).toLowerCase()}). Confirma con el proveedor si mantiene la entrega.`,
  }
}

/**
 * Aviso de festivo de un pedido (guardado o previsto), o null. Solo tiene
 * sentido avisar si el pedido sigue en marcha: no se avisa de los marcados
 * como «no se pide» ni de las entregas ya pasadas.
 */
export function getItemHolidayWarning(item, holidays, today) {
  if (!item || item.status === ORDER_STATUS.SKIPPED) return null
  if (!isValidDate(item.delivery_date) || item.delivery_date < today) return null
  return getHolidayWarning(item.delivery_date, holidays)
}

/** Filas del historial con su aviso de festivo (mismas reglas que la agenda). */
export function decorateHistoryRows(rows, holidays, today) {
  return (rows ?? []).map(row => ({
    ...row,
    key: `order:${row.id}`,
    isForecast: false,
    holidayWarning: getItemHolidayWarning(row, holidays, today),
  }))
}

/**
 * Agenda completa.
 * @returns {{
 *   range: { from: string, today: string, to: string },
 *   overdue: object[],              // pendientes con preparación anterior a hoy
 *   days: { date: string, isToday: boolean, items: object[] }[], // hoy siempre; después, solo días con pedidos
 *   total: number,
 * }}
 */
export function buildAgenda({ suppliers = [], orders = [], holidays = [], today }) {
  const range = getAgendaRange(today)
  const suppliersById = new Map((suppliers ?? []).map(s => [s.id, s]))

  const stored = (orders ?? [])
    .filter(order => order.prepare_date >= range.from && order.prepare_date <= range.to)
    .map(order => toAgendaItem(order, suppliersById))
  const forecasts = buildForecasts(suppliers, range)
    .filter(forecast => !isForecastCovered(forecast, orders))

  const items = [...stored, ...forecasts]
    .filter(item => item.prepare_date >= today || item.status === ORDER_STATUS.PENDING)
    .map(item => ({ ...item, holidayWarning: getItemHolidayWarning(item, holidays, today) }))
    .sort(compareItems)

  const overdue = items
    .filter(item => item.prepare_date < today)
    .sort((a, b) => String(a.prepare_date).localeCompare(String(b.prepare_date)) || compareItems(a, b))

  const byDate = new Map([[today, []]])
  for (const item of items) {
    if (item.prepare_date < today) continue
    if (!byDate.has(item.prepare_date)) byDate.set(item.prepare_date, [])
    byDate.get(item.prepare_date).push(item)
  }
  const days = [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, list]) => ({ date, isToday: date === today, items: list }))

  return { range, overdue, days, total: items.length }
}

/** Sustituye (o añade) un pedido guardado en la lista cargada. */
export function upsertOrder(orders, order) {
  return [...(orders ?? []).filter(o => o.id !== order.id), order]
}

export function removeOrder(orders, id) {
  return (orders ?? []).filter(o => o.id !== id)
}

// ------------------------------------------------------- Datos a guardar

/** Texto sin espacios sobrantes; null si queda vacío. */
function cleanOptional(value) {
  const text = String(value ?? '').trim()
  return text === '' ? null : text
}

export function normalizeOrderInput(values = {}) {
  return {
    supplier_id: values.supplier_id || null,
    delivery_date: String(values.delivery_date ?? '').trim(),
    prepare_date: String(values.prepare_date ?? '').trim(),
    notes: cleanOptional(values.notes),
  }
}

/** Fila nueva a partir de una previsión (con cambios opcionales). */
export function buildForecastInsert(forecast, changes = {}) {
  const status = changes.status ?? ORDER_STATUS.PENDING
  return {
    supplier_id: forecast.supplier_id,
    scheduled_delivery_date: forecast.scheduled_delivery_date,
    delivery_date: changes.delivery_date ?? forecast.delivery_date,
    prepare_date: changes.prepare_date ?? forecast.prepare_date,
    status,
    notes: changes.notes === undefined ? null : cleanOptional(changes.notes),
  }
}

/** Pedido creado a mano (sin previsión de origen). */
export function buildManualInsert(values) {
  const data = normalizeOrderInput(values)
  return {
    supplier_id: data.supplier_id,
    scheduled_delivery_date: null,
    delivery_date: data.delivery_date,
    prepare_date: data.prepare_date,
    status: ORDER_STATUS.PENDING,
    notes: data.notes,
  }
}

/** Cambios de un pedido guardado: solo las columnas que se pueden modificar. */
export function buildOrderUpdate(changes = {}) {
  const update = {}
  for (const field of ORDER_UPDATABLE_FIELDS) {
    if (changes[field] === undefined) continue
    update[field] = field === 'notes' ? cleanOptional(changes[field]) : changes[field]
  }
  return update
}

export function toOrderFormValues(item) {
  return {
    supplier_id: item?.supplier_id ?? undefined,
    delivery_date: item?.delivery_date ?? '',
    prepare_date: item?.prepare_date ?? '',
    notes: item?.notes ?? '',
  }
}

export function hasOrderChanges(item, values) {
  if (!item) return true
  const data = normalizeOrderInput(values)
  return item.delivery_date !== data.delivery_date
    || item.prepare_date !== data.prepare_date
    || (item.notes ?? null) !== data.notes
}

function checkDate(value, field, label) {
  if (!value) return { name: field, message: `Elige la fecha de ${label}.` }
  if (!isValidDate(value)) return { name: field, message: 'La fecha no es válida.' }
  const year = Number(value.slice(0, 4))
  if (year < HOLIDAY_MIN_YEAR || year > HOLIDAY_MAX_YEAR) {
    return { name: field, message: `Elige una fecha entre ${HOLIDAY_MIN_YEAR} y ${HOLIDAY_MAX_YEAR}.` }
  }
  return null
}

/**
 * Errores de validación con el formato de UForm: [{ name, message }].
 * - `isNew`: pedido creado a mano (hay que elegir un proveedor activo).
 * - `suppliers`: lista cargada (para comprobar que el proveedor está activo).
 * - `orders`: pedidos guardados cargados, para avisar si el proveedor ya
 *   tiene otro pedido con esa fecha de entrega (la base de datos también lo
 *   rechaza).
 * - `currentId`: pedido que se edita (null si es nuevo o una previsión).
 */
export function validateOrderInput(values = {}, { isNew = false, supplierId = null, suppliers = [], orders = [], currentId = null } = {}) {
  const data = normalizeOrderInput(values)
  const errors = []
  const targetSupplier = isNew ? data.supplier_id : supplierId

  if (isNew) {
    const supplier = (suppliers ?? []).find(s => s.id === data.supplier_id)
    if (!data.supplier_id) errors.push({ name: 'supplier_id', message: 'Elige el proveedor.' })
    else if (supplier && !supplier.is_active) errors.push({ name: 'supplier_id', message: 'Este proveedor está desactivado: actívalo antes de crearle pedidos.' })
  }

  const deliveryError = checkDate(data.delivery_date, 'delivery_date', 'entrega')
  const prepareError = checkDate(data.prepare_date, 'prepare_date', 'preparación')
  if (deliveryError) errors.push(deliveryError)
  if (prepareError) errors.push(prepareError)

  if (!deliveryError && !prepareError && data.prepare_date > data.delivery_date) {
    errors.push({ name: 'prepare_date', message: 'La preparación no puede ser posterior a la entrega.' })
  }

  if (!deliveryError && targetSupplier) {
    const taken = (orders ?? []).find(order =>
      order.id !== currentId
      && order.supplier_id === targetSupplier
      && order.delivery_date === data.delivery_date)
    if (taken) {
      errors.push({ name: 'delivery_date', message: `Este proveedor ya tiene un pedido con entrega el ${formatShortDate(data.delivery_date)}.` })
    }
  }

  if (data.notes && Array.from(data.notes).length > ORDER_FIELD_LIMITS.notes) {
    errors.push({ name: 'notes', message: `Máximo ${ORDER_FIELD_LIMITS.notes} caracteres.` })
  }

  return errors
}

// ------------------------------------------------------------- Historial

export function getHistoryRange(page, size = HISTORY_PAGE_SIZE) {
  const start = Math.max(0, Number(page) || 0) * size
  return { start, end: start + size - 1 }
}

export function getPageCount(total, size = HISTORY_PAGE_SIZE) {
  return Math.max(1, Math.ceil((Number(total) || 0) / size))
}

/** «Mostrando 21–40 de 45». */
export function describeHistoryPage(page, total, size = HISTORY_PAGE_SIZE) {
  if (!total) return ''
  const { start } = getHistoryRange(page, size)
  const end = Math.min(total, start + size)
  return `Mostrando ${start + 1}–${end} de ${total}`
}

// ----------------------------------------------------------- Textos

const shortFormatter = new Intl.DateTimeFormat('es-ES', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
const shortYearFormatter = new Intl.DateTimeFormat('es-ES', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
const weekdayFormatter = new Intl.DateTimeFormat('es-ES', { weekday: 'long', timeZone: 'UTC' })
const dayMonthFormatter = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long', timeZone: 'UTC' })
const timeFormatter = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: SHOP_TIME_ZONE })
const dateInShopFormatter = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: SHOP_TIME_ZONE })

function clean(text) {
  return text.replaceAll('.', '')
}

/** «jue, 30 oct» (con el año si no es el de `today`). */
export function formatShortDate(date, today = null) {
  if (!isValidDate(date)) return ''
  const value = new Date(`${date}T00:00:00Z`)
  const sameYear = !today || date.slice(0, 4) === today.slice(0, 4)
  return clean((sameYear ? shortFormatter : shortYearFormatter).format(value))
}

/** «hoy», «mañana», «ayer», «hace 3 días», «dentro de 5 días». */
export function describeRelativeDay(date, today) {
  const diff = daysBetween(today, date)
  if (diff === 0) return 'hoy'
  if (diff === 1) return 'mañana'
  if (diff === -1) return 'ayer'
  return diff < 0 ? `hace ${-diff} días` : `dentro de ${diff} días`
}

/** Cabecera de un día de la agenda: { title: 'Hoy' | 'Mañana' | 'Viernes', subtitle: '30 de octubre' }. */
export function formatAgendaDay(date, today) {
  const value = new Date(`${date}T00:00:00Z`)
  const diff = daysBetween(today, date)
  const weekday = weekdayFormatter.format(value)
  const title = diff === 0 ? 'Hoy' : diff === 1 ? 'Mañana' : weekday.charAt(0).toUpperCase() + weekday.slice(1)
  const subtitle = diff <= 1 ? `${weekday}, ${dayMonthFormatter.format(value)}` : dayMonthFormatter.format(value)
  return { title, subtitle }
}

/** «Preparado hoy a las 10:32» o «Preparado el 27 oct a las 10:32». */
export function describePreparedAt(timestamp, today) {
  if (!timestamp) return ''
  const value = new Date(timestamp)
  if (Number.isNaN(value.getTime())) return ''
  const date = dateInShopFormatter.format(value)
  const time = timeFormatter.format(value)
  return date === today
    ? `Preparado hoy a las ${time}`
    : `Preparado el ${formatShortDate(date, today)} a las ${time}`
}

export function getStatusLabel(status) {
  return ORDER_STATUS_LABELS[status] ?? ''
}

/** Nombre del proveedor de un pedido (o un texto de reserva). */
export function getOrderSupplierName(item) {
  return item?.supplier?.name ?? 'Proveedor'
}

/** Proveedores activos para crear pedidos a mano, por orden alfabético. */
export function getSelectableSuppliers(suppliers) {
  return [...(suppliers ?? [])]
    .filter(s => s.is_active)
    .sort((a, b) => collator.compare(a.name, b.name) || getSupplierNameKey(a.name).localeCompare(getSupplierNameKey(b.name)))
}

// ------------------------------------------------------------- Errores

const DUPLICATE_DELIVERY = 'Este proveedor ya tiene otro pedido con esa fecha de entrega.'

const CONSTRAINT_FIELDS = {
  orders_supplier_delivery_unique: { name: 'delivery_date', message: DUPLICATE_DELIVERY },
  orders_prepare_not_after_delivery: { name: 'prepare_date', message: 'La preparación no puede ser posterior a la entrega.' },
}

/** Errores de campo a partir de un error de restricción de la base de datos. */
export function getOrderFieldErrors(error) {
  const message = String(error?.message ?? '')
  if (['23505', '23514'].includes(error?.code)) {
    const constraint = Object.keys(CONSTRAINT_FIELDS).find(name => message.includes(name))
    if (constraint) return [{ ...CONSTRAINT_FIELDS[constraint] }]
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
  delete: {
    [DB_ERROR_KIND.NETWORK]: 'No se ha podido eliminar el pedido. Comprueba la conexión a Internet y vuelve a intentarlo.',
    [DB_ERROR_KIND.UNKNOWN]: 'No se ha podido eliminar el pedido. Vuelve a intentarlo.',
  },
}

const COMMON_MESSAGES = {
  [DB_ERROR_KIND.EXPIRED]: 'Tu sesión ha caducado. Vuelve a iniciar sesión para continuar.',
  [DB_ERROR_KIND.PERMISSION]: 'Esta cuenta no tiene permiso para gestionar pedidos.',
  [DB_ERROR_KIND.MISSING]: 'La base de datos aún no está preparada para gestionar pedidos: falta aplicar su migración (SUPABASE_SETUP.md, sección 10).',
  [DB_ERROR_KIND.VALIDATION]: 'Revisa los datos del pedido.',
}

/**
 * Mensaje para la persona usuaria (nunca el mensaje técnico original), los
 * errores de cada campo y si la agenda debe recargarse porque el pedido ha
 * cambiado en otro dispositivo (`conflict`).
 *
 * @param {{ error?: any, status?: number }} response
 * @param {'load' | 'save' | 'status' | 'delete'} action
 * @param {{ insert?: object }} [options] fila que se intentaba crear, si era un INSERT
 */
export function getOrderErrorFeedback(response, action = 'save', { insert = null } = {}) {
  const kind = classifyDatabaseError(response) ?? DB_ERROR_KIND.UNKNOWN
  const error = response?.error
  const message = String(error?.message ?? '')

  // La misma previsión ya se había guardado (otro dispositivo o pestaña).
  // Al guardar una previsión sin cambiar su fecha, PostgreSQL puede informar
  // de cualquiera de las dos restricciones únicas: ambas significan lo mismo.
  const sameForecast = Boolean(insert?.scheduled_delivery_date)
    && insert.delivery_date === insert.scheduled_delivery_date
  if (error?.code === '23505' && (message.includes('orders_supplier_scheduled_unique') || sameForecast)) {
    return {
      kind,
      conflict: true,
      fields: [],
      message: 'Este pedido ya se había guardado desde otro dispositivo. La agenda se ha actualizado: revisa su estado.',
    }
  }

  // La fila ya no existe o no se puede tocar (por ejemplo, se ha eliminado o
  // ha dejado de estar pendiente en otro dispositivo).
  if (kind === DB_ERROR_KIND.NOT_FOUND) {
    return {
      kind,
      conflict: true,
      fields: [],
      message: action === 'delete'
        ? 'No se ha podido eliminar: solo se eliminan pedidos pendientes y puede que haya cambiado en otro dispositivo. La agenda se ha actualizado.'
        : 'Este pedido ya no existe o ha cambiado en otro dispositivo. La agenda se ha actualizado.',
    }
  }

  const fields = kind === DB_ERROR_KIND.VALIDATION ? getOrderFieldErrors(error) : []
  const duplicate = fields.some(field => field.message === DUPLICATE_DELIVERY)
  return {
    kind,
    // Otro pedido ocupa esa fecha: puede haberse creado en otro dispositivo.
    conflict: duplicate,
    fields,
    message: duplicate
      ? DUPLICATE_DELIVERY
      : COMMON_MESSAGES[kind]
        ?? MESSAGES[action]?.[kind]
        ?? MESSAGES[action]?.[DB_ERROR_KIND.UNKNOWN]
        ?? MESSAGES.save[DB_ERROR_KIND.UNKNOWN],
  }
}
