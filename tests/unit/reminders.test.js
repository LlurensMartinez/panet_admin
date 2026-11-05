import { describe, expect, it } from 'vitest'
import {
  buildReminder,
  buildReminders,
  describeDeliveryTime,
  describeHiddenReminders,
  getOnDemandSuppliers,
  parseDismissed,
  serializeDismissed,
} from '../../app/utils/reminders.js'

// Jueves 5 de noviembre de 2026.
const TODAY = '2026-11-05'

const supplier = (over = {}) => ({
  id: 's',
  name: 'Proveedor',
  delivery_weekdays: [1, 2, 3, 4, 5],
  order_lead_days: 1,
  lead_days_overrides: {},
  delivery_every_weeks: 1,
  delivery_anchor_date: null,
  order_mode: 'on_demand',
  order_deadline: null,
  notes: null,
  is_active: true,
  ...over,
})

const hielo = supplier({ id: 'hielo', name: 'As de Hielo', order_lead_days: 2, order_deadline: '12:00:00', notes: 'Entrega en 48 h. Es pot demanar qualsevol dia.' })
const europastry = supplier({ id: 'euro', name: 'Europastry', order_lead_days: 1, order_deadline: '12:00:00' })
const kimon = supplier({ id: 'kimon', name: 'Kimon', order_mode: 'scheduled', delivery_weekdays: [1, 4] })
const inactive = supplier({ id: 'old', name: 'Antiguo a demanda', is_active: false })

describe('qué proveedores tienen recordatorio', () => {
  it('solo los activos y a demanda, por nombre', () => {
    expect(getOnDemandSuppliers([kimon, europastry, inactive, hielo]).map(s => s.id)).toEqual(['hielo', 'euro'])
    expect(getOnDemandSuppliers([kimon, inactive])).toEqual([])
    expect(getOnDemandSuppliers(null)).toEqual([])
  })

  it('si deja de ser a demanda o se desactiva, desaparece', () => {
    expect(buildReminders([{ ...hielo, order_mode: 'scheduled' }, { ...europastry, is_active: false }], TODAY)).toEqual([])
  })
})

describe('contenido del recordatorio', () => {
  it('pregunta, plazo, días, próxima entrega, hora límite y notas', () => {
    expect(buildReminder(hielo, TODAY)).toEqual({
      id: 'hielo',
      name: 'As de Hielo',
      question: '¿Necesitas pedir As de Hielo hoy?',
      deliveryTime: 'Tarda 2 días (48 h) en llegar',
      deliveryDays: 'Puede entregar: lunes, martes, miércoles, jueves y viernes',
      // Jueves + 48 h = sábado, que no entrega → lunes.
      nextDelivery: 'Si lo pides hoy, llegaría el lun, 9 nov',
      deliveryDate: '2026-11-09',
      deadline: 'Pedir antes de las 12:00',
      notes: 'Entrega en 48 h. Es pot demanar qualsevol dia.',
    })
  })

  it('entrega mañana: lo indica', () => {
    expect(buildReminder(europastry, TODAY)).toMatchObject({
      question: '¿Necesitas pedir Europastry hoy?',
      deliveryTime: 'Tarda 1 día (24 h) en llegar',
      nextDelivery: 'Si lo pides hoy, llegaría el vie, 6 nov (mañana)',
      notes: '',
    })
  })

  it('sin hora límite, sin días ni notas', () => {
    const r = buildReminder(supplier({ delivery_weekdays: [], order_lead_days: 0, notes: '   ' }), TODAY)
    expect(r).toMatchObject({ deliveryTime: 'Llega el mismo día en que se pide', deliveryDays: '', deadline: '', notes: '' })
    expect(r.nextDelivery).toBe('Si lo pides hoy, llegaría el jue, 5 nov (hoy)')
  })

  it('textos del plazo', () => {
    expect(describeDeliveryTime(2)).toBe('2 días (48 h)')
    expect(describeDeliveryTime(0)).toBe('El mismo día')
    expect(describeDeliveryTime(5)).toBe('5 días')
  })
})

describe('ocultar hasta mañana', () => {
  it('lo ocultado hoy cuenta solo hoy', () => {
    const raw = serializeDismissed(['hielo', 'hielo'], TODAY)
    expect(JSON.parse(raw)).toEqual({ date: TODAY, ids: ['hielo'] })
    expect(parseDismissed(raw, TODAY)).toEqual(['hielo'])
    // Al día siguiente vuelve a aparecer.
    expect(parseDismissed(raw, '2026-11-06')).toEqual([])
  })

  it('ignora lo guardado vacío o dañado', () => {
    expect(parseDismissed(null, TODAY)).toEqual([])
    expect(parseDismissed('no es json', TODAY)).toEqual([])
    expect(parseDismissed('{"date":"2026-11-05","ids":"hielo"}', TODAY)).toEqual([])
    expect(parseDismissed('{"date":"2026-11-05","ids":[1,"",null,"euro"]}', TODAY)).toEqual(['euro'])
  })

  it('texto de los ocultos', () => {
    expect(describeHiddenReminders(0)).toBe('')
    expect(describeHiddenReminders(1)).toBe('Has ocultado 1 recordatorio hasta mañana.')
    expect(describeHiddenReminders(2)).toBe('Has ocultado 2 recordatorios hasta mañana.')
  })
})
