// Lógica pura del resumen de Inicio (sin dependencias de Nuxt ni de
// Supabase), para poder probarla con pruebas unitarias.
//
// No duplica la agenda: parte de buildAgenda() (app/utils/orders.js), así que
// las previsiones, los pedidos manuales, las fechas cambiadas, los festivos y
// los atrasados se calculan exactamente igual que en /pedidos. Este módulo
// solo selecciona y agrupa:
// - Hoy: pedidos PENDIENTES que se preparan hoy.
// - Mañana: pedidos PENDIENTES que se preparan mañana.
// - Atrasados: los atrasados de la agenda (pendientes de los últimos 7 días),
//   en una sección aparte que la página muestra solo si se pide.
// - Los preparados y los «no se pide» no se muestran (solo se cuentan para
//   el mensaje de «todo listo»).
// - Cada proveedor aparece una sola vez por sección, con sus entregas y sus
//   productos habituales ACTIVOS (cantidades orientativas, nunca inventadas).

import { addDaysToDate } from './overtime.js'
import { buildAgenda, getOrderDeadline, ORDER_STATUS } from './orders.js'
import { sortProducts } from './products.js'
import { isOnDemand } from './suppliers.js'

const collator = new Intl.Collator('es', { sensitivity: 'base', numeric: true })
const hourFormatter = new Intl.DateTimeFormat('es-ES', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Europe/Madrid' })
const titleFormatter = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })

/** Productos activos agrupados por proveedor, en orden alfabético. */
export function groupActiveProducts(products) {
  const bySupplier = new Map()
  for (const product of sortProducts((products ?? []).filter(p => p.is_active))) {
    if (!bySupplier.has(product.supplier_id)) bySupplier.set(product.supplier_id, [])
    bySupplier.get(product.supplier_id).push(product)
  }
  return bySupplier
}

function toDelivery(item, today, now) {
  return {
    key: item.key,
    deliveryDate: item.delivery_date,
    prepareDate: item.prepare_date,
    overdue: item.prepare_date < today,
    isForecast: Boolean(item.isForecast),
    manual: !item.isForecast && !item.scheduled_delivery_date,
    onDemand: isOnDemand(item.supplier),
    moved: Boolean(item.scheduled_delivery_date && item.scheduled_delivery_date !== item.delivery_date),
    holidayWarning: item.holidayWarning ?? null,
    notes: item.notes ?? null,
    // Hora límite del pedido: { time, passed } o null.
    deadline: getOrderDeadline(item, today, now),
  }
}

/**
 * Agrupa los pedidos pendientes de una sección por proveedor: una tarjeta
 * por proveedor con sus entregas (normalmente una) y sus productos activos.
 * Primero los proveedores con algo atrasado; después, por nombre.
 */
export function groupBySupplier(items, productsBySupplier, today, now = new Date()) {
  const cards = new Map()
  for (const item of items) {
    const id = item.supplier_id
    if (!cards.has(id)) {
      cards.set(id, {
        supplierId: id,
        supplier: item.supplier ?? null,
        name: item.supplier?.name ?? 'Proveedor',
        inactive: item.supplier?.is_active === false,
        deliveries: [],
        products: productsBySupplier?.get(id) ?? [],
      })
    }
    cards.get(id).deliveries.push(toDelivery(item, today, now))
  }
  return [...cards.values()]
    .map(card => ({
      ...card,
      deliveries: card.deliveries.sort((a, b) => a.prepareDate.localeCompare(b.prepareDate) || a.deliveryDate.localeCompare(b.deliveryDate)),
      overdue: card.deliveries.some(d => d.overdue),
    }))
    .sort((a, b) => Number(b.overdue) - Number(a.overdue) || collator.compare(a.name, b.name) || String(a.supplierId).localeCompare(String(b.supplierId)))
}

function isPending(item) {
  return item.status === ORDER_STATUS.PENDING
}

function buildSection(date, items, extraItems, productsBySupplier, today, now) {
  const pending = [...extraItems, ...items.filter(isPending)]
  const cards = groupBySupplier(pending, productsBySupplier, today, now)
  return {
    date,
    cards,
    orderCount: pending.length,
    supplierCount: cards.length,
    overdueCount: pending.filter(item => item.prepare_date < today).length,
    // Ya preparados o «no se pide» ese día: no se muestran, solo se cuentan.
    doneCount: items.filter(item => !isPending(item)).length,
  }
}

/**
 * Resumen de Inicio.
 * @returns {{ today: object, tomorrow: object, overdue: object }} cada sección
 *   con { date, cards, orderCount, supplierCount, overdueCount, doneCount }.
 *   Hoy y Mañana no incluyen los atrasados (overdueCount 0); `overdue` los
 *   agrupa por proveedor (date null).
 */
export function buildHomeSummary({ suppliers = [], orders = [], holidays = [], products = [], today, now = new Date() }) {
  const agenda = buildAgenda({ suppliers, orders, holidays, today })
  const tomorrow = addDaysToDate(today, 1)
  const productsBySupplier = groupActiveProducts(products)
  const itemsOf = date => agenda.days.find(day => day.date === date)?.items ?? []

  return {
    today: buildSection(today, itemsOf(today), [], productsBySupplier, today, now),
    tomorrow: buildSection(tomorrow, itemsOf(tomorrow), [], productsBySupplier, today, now),
    overdue: buildSection(null, [], agenda.overdue, productsBySupplier, today, now),
  }
}

// ------------------------------------------------------------------ Textos

/** Saludo según la hora en la tienda (Europe/Madrid). */
export function getGreeting(now = new Date()) {
  const hour = Number(hourFormatter.format(now))
  if (hour >= 6 && hour < 14) return 'Buenos días'
  if (hour >= 14 && hour < 21) return 'Buenas tardes'
  return 'Buenas noches'
}

/** «Jueves, 29 de octubre». */
export function formatHomeTitle(date) {
  const text = titleFormatter.format(new Date(`${date}T00:00:00Z`))
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`
}

/** Frase de la cabecera con los recuentos reales de hoy y mañana. */
export function describeHomeSummary(summary) {
  const today = summary?.today?.orderCount ?? 0
  const tomorrow = summary?.tomorrow?.orderCount ?? 0
  if (today === 0 && tomorrow === 0) return 'No hay pedidos pendientes de preparar ni hoy ni mañana.'
  const todayText = today === 0 ? 'ninguno hoy' : `${today === 1 ? '1 pedido' : `${today} pedidos`} hoy`
  const tomorrowText = tomorrow === 0 ? 'ninguno mañana' : `${tomorrow} mañana`
  return `Por preparar: ${todayText} y ${tomorrowText}.`
}

/** «Hay 1 pedido atrasado» / «Hay 3 pedidos atrasados» (o '' si no hay). */
export function describeOverdue(count) {
  if (!count) return ''
  return count === 1 ? 'Hay 1 pedido atrasado' : `Hay ${count} pedidos atrasados`
}
