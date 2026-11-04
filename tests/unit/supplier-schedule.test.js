import { describe, expect, it } from 'vitest'
import {
  buildForecasts,
  buildAgenda,
  getLeadDaysForDate,
  getOrderDeadline,
  getShopTime,
  ORDER_STATUS,
} from '../../app/utils/orders.js'
import {
  describeDeadline,
  describeSupplierSchedule,
  formatDeadline,
  getLeadDaysFor,
  getNextDeliveryDates,
  getOnDemandOrderDates,
  getSupplierErrorFeedback,
  hasScheduledDeliveries,
  hasSupplierChanges,
  isDeliveryWeek,
  normalizeDeadline,
  normalizeLeadOverrides,
  normalizeSupplierInput,
  toSupplierFormValues,
  validateSupplierInput,
} from '../../app/utils/suppliers.js'
import { buildHomeSummary } from '../../app/utils/home.js'

// Miércoles 4 de noviembre de 2026.
const TODAY = '2026-11-04'

const supplier = (over = {}) => ({
  id: 's1',
  name: 'Proveedor',
  delivery_weekdays: [1, 4],
  order_lead_days: 1,
  lead_days_overrides: {},
  delivery_every_weeks: 1,
  delivery_anchor_date: null,
  order_mode: 'scheduled',
  order_deadline: null,
  is_active: true,
  ...over,
})

// Kimon: entrega lunes (pedido el viernes, 3 días) y jueves (pedido el miércoles, 1 día).
const kimon = supplier({ id: 'kimon', name: 'Kimon', lead_days_overrides: { 1: 3 }, order_deadline: '12:00:00' })
// Distriluago: lunes cada 2 semanas, pedido el jueves (4 días); semanas del 9 nov.
const distri = supplier({ id: 'distri', name: 'Distriluago', delivery_weekdays: [1], order_lead_days: 4, delivery_every_weeks: 2, delivery_anchor_date: '2026-11-09' })
// As de Hielo: a demanda, puede entregar de lunes a viernes en 48 h.
const hielo = supplier({ id: 'hielo', name: 'As de Hielo', delivery_weekdays: [1, 2, 3, 4, 5], order_lead_days: 2, order_mode: 'on_demand' })

const range = (from, to) => ({ from, to })
const forecastDates = (s, from, to) => buildForecasts([s], range(from, to)).map(f => [f.prepare_date, f.delivery_date])

describe('antelación distinta según el día de entrega', () => {
  it('usa la del día y, si no tiene, la general', () => {
    expect(getLeadDaysFor(kimon, 1)).toBe(3)
    expect(getLeadDaysFor(kimon, 4)).toBe(1)
    expect(getLeadDaysForDate(kimon, '2026-11-09')).toBe(3)
    expect(getLeadDaysForDate(kimon, '2026-11-05')).toBe(1)
    expect(getLeadDaysFor(supplier({ lead_days_overrides: null }), 1)).toBe(1)
  })

  it('las previsiones se preparan el viernes para el lunes y el miércoles para el jueves', () => {
    expect(forecastDates(kimon, '2026-11-04', '2026-11-13')).toEqual([
      ['2026-11-04', '2026-11-05'], // mié → jue
      ['2026-11-06', '2026-11-09'], // vie → lun
      ['2026-11-11', '2026-11-12'],
      ['2026-11-13', '2026-11-16'],
    ])
  })

  it('una previsión con antelación larga entra en el rango aunque la entrega quede fuera', () => {
    expect(forecastDates(supplier({ delivery_weekdays: [3], order_lead_days: 7 }), '2026-11-04', '2026-11-04'))
      .toEqual([['2026-11-04', '2026-11-11']])
  })

  it('normaliza las antelaciones propias: solo días de entrega, valores válidos y distintos de la general', () => {
    expect(normalizeLeadOverrides({ 1: '3', 4: 1, 2: 5, 7: 9 }, [1, 4], 1)).toEqual({ 1: 3 })
    expect(normalizeLeadOverrides({ 1: 3 }, [4], 1)).toEqual({})
    expect(normalizeLeadOverrides([3], [1], 1)).toEqual({})
    expect(normalizeLeadOverrides(null, [1], 1)).toEqual({})
  })

  it('resume el calendario por días', () => {
    expect(describeSupplierSchedule(kimon).preparation)
      .toBe('Se prepara el viernes para el lunes (3 días antes) y el miércoles para el jueves (1 día antes).')
  })
})

describe('entregas cada 2 semanas', () => {
  it('solo entrega en las semanas alternas de la fecha de referencia (antes y después)', () => {
    expect(isDeliveryWeek(distri, '2026-11-09')).toBe(true)
    expect(isDeliveryWeek(distri, '2026-11-15')).toBe(true) // domingo de la misma semana
    expect(isDeliveryWeek(distri, '2026-11-16')).toBe(false)
    expect(isDeliveryWeek(distri, '2026-11-23')).toBe(true)
    expect(isDeliveryWeek(distri, '2026-10-26')).toBe(true)
    expect(isDeliveryWeek(distri, '2026-11-02')).toBe(false)
    // Cruza el cambio de año y el de hora.
    expect(isDeliveryWeek(distri, '2027-01-04')).toBe(true)
    expect(isDeliveryWeek(distri, '2027-03-29')).toBe(true)
  })

  it('las previsiones se preparan el jueves, una semana sí y otra no', () => {
    expect(forecastDates(distri, '2026-11-01', '2026-11-30')).toEqual([
      ['2026-11-05', '2026-11-09'],
      ['2026-11-19', '2026-11-23'],
    ])
  })

  it('próximas entregas', () => {
    expect(getNextDeliveryDates(distri, '2026-11-10', 3)).toEqual(['2026-11-23', '2026-12-07', '2026-12-21'])
    expect(getNextDeliveryDates(kimon, '2026-11-04', 2)).toEqual(['2026-11-05', '2026-11-09'])
  })

  it('una semanal o sin fecha de referencia se trata como semanal', () => {
    expect(isDeliveryWeek(supplier(), '2026-11-16')).toBe(true)
    expect(isDeliveryWeek(supplier({ delivery_every_weeks: 2, delivery_anchor_date: null }), '2026-11-16')).toBe(true)
  })

  it('resume la frecuencia', () => {
    expect(describeSupplierSchedule(distri).delivery).toBe('Entrega cada 2 semanas: lunes (semanas del lun, 9 nov, alternas)')
    expect(describeSupplierSchedule(distri).preparation).toBe('Se prepara el jueves (4 días antes).')
  })
})

describe('proveedores a demanda', () => {
  it('no generan previsiones ni cuentan como calendario fijo', () => {
    expect(buildForecasts([hielo], range('2026-11-01', '2026-11-30'))).toEqual([])
    expect(hasScheduledDeliveries(hielo)).toBe(false)
    expect(hasScheduledDeliveries(kimon)).toBe(true)
    expect(hasScheduledDeliveries({ ...kimon, is_active: false })).toBe(false)
  })

  it('pedido de hoy: la entrega posible más próxima con su antelación', () => {
    // Miércoles + 48 h = viernes.
    expect(getOnDemandOrderDates(hielo, '2026-11-04')).toEqual({ delivery_date: '2026-11-06', prepare_date: '2026-11-04' })
    // Viernes + 48 h = domingo, que no entrega → lunes.
    expect(getOnDemandOrderDates(hielo, '2026-11-06')).toEqual({ delivery_date: '2026-11-09', prepare_date: '2026-11-06' })
    // Sin días de entrega: hoy + antelación.
    expect(getOnDemandOrderDates({ ...hielo, delivery_weekdays: [] }, '2026-11-06').delivery_date).toBe('2026-11-08')
  })

  it('sus pedidos guardados sí aparecen en la agenda', () => {
    const agenda = buildAgenda({
      suppliers: [hielo],
      orders: [{ id: 'o1', supplier_id: 'hielo', scheduled_delivery_date: null, delivery_date: '2026-11-06', prepare_date: TODAY, status: ORDER_STATUS.PENDING }],
      today: TODAY,
    })
    expect(agenda.days[0].items.map(i => i.key)).toEqual(['order:o1'])
  })

  it('resume el modo', () => {
    const text = describeSupplierSchedule(hielo)
    expect(text.onDemand).toBe(true)
    expect(text.delivery).toBe('A demanda · puede entregar: lunes, martes, miércoles, jueves y viernes')
    expect(text.preparation).toBe('No aparece en la agenda: crea el pedido cuando haga falta. Se pide 2 días antes de la entrega.')
  })
})

describe('hora límite', () => {
  it('formatea y normaliza', () => {
    expect(formatDeadline('12:00:00')).toBe('12:00')
    expect(formatDeadline('8:00')).toBe('08:00')
    expect(formatDeadline('25:00')).toBe('')
    expect(normalizeDeadline('')).toBeNull()
    expect(describeDeadline('08:00:00')).toBe('Pedir antes de las 8:00')
    expect(describeDeadline('01:30')).toBe('Pedir antes de la 1:30')
    expect(describeDeadline(null)).toBe('')
  })

  it('compara con la hora de Madrid', () => {
    // 10:59 UTC = 11:59 en Madrid (invierno).
    expect(getShopTime(new Date('2026-11-04T10:59:00Z'))).toBe('11:59')
    const item = { status: ORDER_STATUS.PENDING, prepare_date: TODAY, supplier: kimon }
    expect(getOrderDeadline(item, TODAY, new Date('2026-11-04T10:59:00Z'))).toEqual({ time: '12:00', passed: false })
    expect(getOrderDeadline(item, TODAY, new Date('2026-11-04T11:00:00Z'))).toEqual({ time: '12:00', passed: true })
    expect(getOrderDeadline({ ...item, prepare_date: '2026-11-05' }, TODAY, new Date('2026-11-04T15:00:00Z'))).toEqual({ time: '12:00', passed: false })
    expect(getOrderDeadline({ ...item, prepare_date: '2026-11-03' }, TODAY).passed).toBe(true)
    expect(getOrderDeadline({ ...item, status: ORDER_STATUS.PREPARED }, TODAY)).toBeNull()
    expect(getOrderDeadline({ ...item, supplier: supplier() }, TODAY)).toBeNull()
  })

  it('llega a Inicio con cada entrega', () => {
    const summary = buildHomeSummary({ suppliers: [kimon], today: TODAY, now: new Date('2026-11-04T09:00:00Z') })
    const delivery = summary.today.cards[0].deliveries.find(d => d.prepareDate === TODAY)
    expect(delivery.deadline).toEqual({ time: '12:00', passed: false })
  })
})

describe('formulario del calendario', () => {
  const base = { name: 'Kimon', order_mode: 'scheduled', delivery_weekdays: [1, 4], order_lead_days: 1 }

  it('guarda solo las antelaciones distintas de la general, y nada si no se personalizan', () => {
    expect(normalizeSupplierInput({ ...base, custom_leads: true, day_leads: { 1: 3, 4: 1, 2: 6 } }).lead_days_overrides).toEqual({ 1: 3 })
    expect(normalizeSupplierInput({ ...base, custom_leads: false, day_leads: { 1: 3 } }).lead_days_overrides).toEqual({})
  })

  it('a demanda: sin antelaciones por día ni quincenal', () => {
    const data = normalizeSupplierInput({ ...base, order_mode: 'on_demand', custom_leads: true, day_leads: { 1: 3 }, delivery_every_weeks: 2, delivery_anchor_date: '2026-11-09' })
    expect(data).toMatchObject({ order_mode: 'on_demand', lead_days_overrides: {}, delivery_every_weeks: 1, delivery_anchor_date: null })
  })

  it('quincenal: exige fecha en uno de los días de entrega', () => {
    const errors = values => validateSupplierInput({ ...base, delivery_weekdays: [1], delivery_every_weeks: 2, ...values })
    expect(errors({ delivery_anchor_date: '' })).toEqual([{ name: 'delivery_anchor_date', message: 'Indica una fecha de entrega para saber qué semanas tocan.' }])
    expect(errors({ delivery_anchor_date: '2026-11-10' })).toEqual([{ name: 'delivery_anchor_date', message: 'Elige una fecha que caiga en lunes.' }])
    expect(errors({ delivery_anchor_date: '2026-11-09' })).toEqual([])
    expect(validateSupplierInput({ ...base, delivery_weekdays: [], delivery_every_weeks: 2, delivery_anchor_date: '2026-11-09' })[0].name).toBe('delivery_weekdays')
  })

  it('valida la antelación de cada día y la hora límite', () => {
    expect(validateSupplierInput({ ...base, custom_leads: true, day_leads: { 1: '', 4: 1 } })[0].name).toBe('day_leads')
    expect(validateSupplierInput({ ...base, custom_leads: true, day_leads: { 1: 3, 4: 1 } })).toEqual([])
    expect(validateSupplierInput({ ...base, order_deadline: '99:99' })[0].name).toBe('order_deadline')
    expect(validateSupplierInput({ ...base, order_deadline: '12:00' })).toEqual([])
  })

  it('carga el calendario guardado y detecta cambios', () => {
    const values = toSupplierFormValues(kimon)
    expect(values).toMatchObject({ custom_leads: true, order_deadline: '12:00', order_mode: 'scheduled' })
    expect(values.day_leads).toMatchObject({ 1: 3, 4: 1 })
    expect(hasSupplierChanges(kimon, values)).toBe(false)
    expect(hasSupplierChanges(kimon, { ...values, order_deadline: '11:00' })).toBe(true)
    expect(hasSupplierChanges(kimon, { ...values, day_leads: { ...values.day_leads, 1: 2 } })).toBe(true)
    expect(hasSupplierChanges(distri, toSupplierFormValues(distri))).toBe(false)
    expect(hasSupplierChanges(distri, { ...toSupplierFormValues(distri), delivery_anchor_date: '2026-11-16' })).toBe(true)
    expect(hasSupplierChanges(hielo, toSupplierFormValues(hielo))).toBe(false)
  })

  it('los errores de las restricciones nuevas van a su campo', () => {
    const feedback = getSupplierErrorFeedback({
      status: 400,
      error: { code: '23514', message: 'new row for relation "suppliers" violates check constraint "suppliers_delivery_anchor_valid"' },
    })
    expect(feedback.fields).toEqual([{ name: 'delivery_anchor_date', message: 'Indica una fecha de entrega para saber qué semanas tocan.' }])
  })
})

describe('alta del proveedor', () => {
  it('no hay previsiones anteriores al día de alta (hora de Madrid)', () => {
    // Alta el miércoles 4 a las 00:30 de Madrid (23:30 UTC del día 3).
    const nuevo = supplier({ delivery_weekdays: [1, 2, 3, 4, 5], order_lead_days: 0, created_at: '2026-11-03T23:30:00Z' })
    expect(forecastDates(nuevo, '2026-10-28', '2026-11-05')).toEqual([
      ['2026-11-04', '2026-11-04'],
      ['2026-11-05', '2026-11-05'],
    ])
    const agenda = buildAgenda({ suppliers: [nuevo], today: '2026-11-04' })
    expect(agenda.overdue).toEqual([])
  })

  it('sin fecha de alta, como hasta ahora', () => {
    expect(forecastDates(supplier({ delivery_weekdays: [3], order_lead_days: 0 }), '2026-10-28', '2026-11-04')).toHaveLength(2)
  })
})

describe('migración del calendario sin aplicar', () => {
  it('una columna inexistente (42703) se explica como migración pendiente', () => {
    const feedback = getSupplierErrorFeedback({ status: 400, error: { code: '42703', message: 'column suppliers.order_mode does not exist' } }, 'load')
    expect(feedback.kind).toBe('missing')
    expect(feedback.message).toContain('sección 12')
  })
})
