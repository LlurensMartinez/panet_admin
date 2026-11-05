// Recordatorios de Inicio para los proveedores «a demanda» (sin día fijo de
// pedido). Lógica pura, sin Nuxt ni Supabase, para poder probarla.
//
// - Un recordatorio por proveedor ACTIVO con order_mode = 'on_demand'.
// - Son solo informativos: no crean pedidos ni cambian la agenda.
// - «Ya lo he tenido en cuenta» los oculta durante el día en este navegador
//   (localStorage). Al día siguiente vuelven solos: lo guardado lleva la
//   fecha y deja de valer al cambiar de día.

import { describeRelativeDay, formatShortDate } from './orders.js'
import {
  DELIVERY_TIME_OPTIONS,
  describeDeadline,
  formatWeekdayList,
  getLeadDaysFor,
  getOnDemandOrderDates,
  isOnDemand,
  normalizeWeekdays,
  sortSuppliers,
} from './suppliers.js'
import { isValidDate } from './overtime.js'

export const REMINDERS_STORAGE_KEY = 'panet-admin:on-demand-reminders'

/** Proveedores que generan recordatorio: activos y a demanda, por nombre. */
export function getOnDemandSuppliers(suppliers) {
  return sortSuppliers((suppliers ?? []).filter(s => s?.is_active === true && isOnDemand(s)))
}

/** «2 días (48 h)», «1 día (24 h)», «El mismo día». */
export function describeDeliveryTime(leadDays) {
  return DELIVERY_TIME_OPTIONS.find(o => o.value === Number(leadDays))?.label ?? `${leadDays} días`
}

/** Datos del recordatorio de un proveedor a demanda para `today`. */
export function buildReminder(supplier, today) {
  const lead = getLeadDaysFor(supplier, 0)
  const days = normalizeWeekdays(supplier.delivery_weekdays)
  const { delivery_date: delivery } = getOnDemandOrderDates(supplier, today)
  const relative = describeRelativeDay(delivery, today)
  return {
    id: supplier.id,
    name: supplier.name,
    question: `¿Necesitas pedir ${supplier.name} hoy?`,
    deliveryTime: lead === 0 ? 'Llega el mismo día en que se pide' : `Tarda ${describeDeliveryTime(lead).toLowerCase()} en llegar`,
    deliveryDays: days.length ? `Puede entregar: ${formatWeekdayList(days)}` : '',
    // Si se pide hoy: la entrega posible más próxima (misma regla que «Nuevo pedido»).
    nextDelivery: `Si lo pides hoy, llegaría el ${formatShortDate(delivery, today)}${['hoy', 'mañana'].includes(relative) ? ` (${relative})` : ''}`,
    deliveryDate: delivery,
    deadline: describeDeadline(supplier.order_deadline),
    notes: supplier.notes?.trim() || '',
  }
}

/** Recordatorios de hoy (todos, ocultos o no), en orden alfabético. */
export function buildReminders(suppliers, today) {
  return getOnDemandSuppliers(suppliers).map(s => buildReminder(s, today))
}

// ------------------------------------------------------ Ocultos hoy

/**
 * Identificadores ocultados HOY a partir de lo guardado. Lo guardado otro día
 * (o dañado) no cuenta: los recordatorios vuelven a aparecer.
 */
export function parseDismissed(raw, today) {
  try {
    const data = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!data || data.date !== today || !isValidDate(today) || !Array.isArray(data.ids)) return []
    return [...new Set(data.ids.filter(id => typeof id === 'string' && id))]
  }
  catch {
    return []
  }
}

/** Texto para guardar los ocultados de hoy. */
export function serializeDismissed(ids, today) {
  return JSON.stringify({ date: today, ids: [...new Set(ids)] })
}

/** «Has ocultado 1 recordatorio hasta mañana.» */
export function describeHiddenReminders(count) {
  if (!count) return ''
  return count === 1
    ? 'Has ocultado 1 recordatorio hasta mañana.'
    : `Has ocultado ${count} recordatorios hasta mañana.`
}
