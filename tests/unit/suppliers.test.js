import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ORDER_LEAD_DAYS,
  ORDER_LEAD_OPTIONS,
  SUPPLIER_FIELD_LIMITS,
  SUPPLIER_STATUS_FILTER,
  WEEKDAYS,
  countSuppliers,
  describeLeadDays,
  describeSupplierSchedule,
  filterSuppliers,
  findDuplicateSupplier,
  formatWeekdayList,
  getPreparationWeekday,
  getSupplierErrorFeedback,
  getSupplierFieldErrors,
  getSupplierNameKey,
  hasSupplierChanges,
  normalizeSupplierInput,
  normalizeWeekdays,
  sortSuppliers,
  toSupplierFormValues,
  upsertSupplier,
  validateSupplierInput,
} from '../../app/utils/suppliers.js'
import { DB_ERROR_KIND } from '../../app/utils/database-errors.js'

const supplier = (over = {}) => ({
  id: 's1',
  name: 'Harinas Sol',
  delivery_weekdays: [1, 4],
  order_lead_days: 1,
  notes: null,
  is_active: true,
  ...over,
})

describe('días de la semana', () => {
  it('usa la numeración ISO de la base de datos, con X para el miércoles', () => {
    expect(WEEKDAYS.map(d => d.value)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(WEEKDAYS.map(d => d.short).join('')).toBe('LMXJVSD')
  })

  it('normaliza: ordena, quita repetidos y valores fuera de 1 a 7', () => {
    expect(normalizeWeekdays([4, '1', 4, 9, 0, -1, 2.5, null, 7])).toEqual([1, 4, 7])
    expect(normalizeWeekdays(null)).toEqual([])
    expect(normalizeWeekdays('1,2')).toEqual([])
  })

  it('calcula el día de preparación según la antelación, también al cruzar la semana', () => {
    expect(getPreparationWeekday(4, 1)).toBe(3) // jueves → miércoles
    expect(getPreparationWeekday(1, 1)).toBe(7) // lunes → domingo
    expect(getPreparationWeekday(1, 3)).toBe(5) // lunes → viernes
    expect(getPreparationWeekday(2, 0)).toBe(2) // el mismo día
    expect(getPreparationWeekday(3, 7)).toBe(3) // una semana antes, mismo día
  })

  it('escribe la lista de días en español', () => {
    expect(formatWeekdayList([4, 1])).toBe('lunes y jueves')
    expect(formatWeekdayList([1, 3, 5])).toBe('lunes, miércoles y viernes')
    expect(formatWeekdayList([1, 2, 3, 4, 5, 6, 7])).toBe('todos los días')
    expect(formatWeekdayList([])).toBe('')
  })

  it('describe la antelación', () => {
    expect(describeLeadDays(0)).toBe('El mismo día')
    expect(describeLeadDays(1)).toBe('1 día antes')
    expect(describeLeadDays(7)).toBe('7 días antes')
    expect(ORDER_LEAD_OPTIONS.map(o => o.value)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
  })

  it('resume el calendario de entregas y preparación', () => {
    expect(describeSupplierSchedule({ delivery_weekdays: [1, 4], order_lead_days: 1 })).toEqual({
      hasDeliveries: true,
      onDemand: false,
      delivery: 'Entrega: lunes y jueves',
      preparation: 'Se prepara el domingo y miércoles (1 día antes).',
      deadline: '',
    })
    expect(describeSupplierSchedule({ delivery_weekdays: [2], order_lead_days: 0 }).preparation)
      .toBe('Se prepara el mismo día de la entrega.')
    const none = describeSupplierSchedule({ delivery_weekdays: [], order_lead_days: 1 })
    expect(none.hasDeliveries).toBe(false)
    expect(none.delivery).toBe('Sin días de entrega habituales')
  })
})

describe('nombre único (misma regla que suppliers_name_unique_idx)', () => {
  it('no distingue mayúsculas, espacios ni acentos', () => {
    expect(getSupplierNameKey('  Panadería   SÒL ')).toBe('panaderia sol')
    expect(getSupplierNameKey('PANADERÍA SOL')).toBe(getSupplierNameKey('panaderia sol'))
    expect(getSupplierNameKey('Pingüino')).toBe('pinguino')
    expect(getSupplierNameKey('Café\tBôn')).toBe('cafe bon')
  })

  it('trata igual un acento escrito como carácter combinado', () => {
    expect(getSupplierNameKey('Café')).toBe(getSupplierNameKey('Café'))
  })

  it('conserva la ñ y la ç como letras propias', () => {
    expect(getSupplierNameKey('Peña')).not.toBe(getSupplierNameKey('Pena'))
    expect(getSupplierNameKey('PEÑA')).toBe('peña')
    expect(getSupplierNameKey('Forn Çà')).toBe('forn ça')
  })

  it('encuentra duplicados activos o inactivos, excepto el propio proveedor', () => {
    const list = [supplier(), supplier({ id: 's2', name: 'Lácteos Norte', is_active: false })]
    expect(findDuplicateSupplier(list, 'harinas  sol')?.id).toBe('s1')
    expect(findDuplicateSupplier(list, 'LACTEOS NORTE')?.id).toBe('s2')
    expect(findDuplicateSupplier(list, 'Harinas Sol', 's1')).toBeNull()
    expect(findDuplicateSupplier(list, 'Harinas Luna')).toBeNull()
    expect(findDuplicateSupplier(list, '   ')).toBeNull()
  })
})

describe('formulario', () => {
  it('normaliza los valores antes de enviarlos', () => {
    expect(normalizeSupplierInput({
      name: '  Harinas \n  Sol ',
      delivery_weekdays: [4, 1, 4],
      order_lead_days: '2',
      notes: '   ',
    })).toEqual({
      name: 'Harinas Sol',
      delivery_weekdays: [1, 4],
      order_lead_days: 2,
      lead_days_overrides: {},
      delivery_every_weeks: 1,
      delivery_anchor_date: null,
      order_mode: 'scheduled',
      order_deadline: null,
      notes: null,
    })
  })

  it('guarda el nombre en forma Unicode NFC', () => {
    expect(normalizeSupplierInput({ name: 'Café', order_lead_days: 1 }).name).toBe('Café')
  })

  it('propone una antelación de 1 día y ningún día de entrega para un proveedor nuevo', () => {
    const allDays = lead => ({ 1: lead, 2: lead, 3: lead, 4: lead, 5: lead, 6: lead, 7: lead })
    expect(toSupplierFormValues()).toEqual({
      name: '',
      order_mode: 'scheduled',
      delivery_weekdays: [],
      order_lead_days: DEFAULT_ORDER_LEAD_DAYS,
      custom_leads: false,
      day_leads: allDays(DEFAULT_ORDER_LEAD_DAYS),
      delivery_every_weeks: 1,
      delivery_anchor_date: '',
      order_deadline: '',
      notes: '',
    })
    expect(toSupplierFormValues(supplier({ notes: 'Llamar antes' }))).toMatchObject({
      name: 'Harinas Sol', delivery_weekdays: [1, 4], order_lead_days: 1, custom_leads: false, notes: 'Llamar antes',
    })
  })

  it('exige el nombre y valida su longitud', () => {
    expect(validateSupplierInput({ name: ' \t ', order_lead_days: 1 })).toEqual([
      { name: 'name', message: 'Escribe el nombre del proveedor.' },
    ])
    const long = 'a'.repeat(SUPPLIER_FIELD_LIMITS.name + 1)
    expect(validateSupplierInput({ name: long, order_lead_days: 1 })[0].name).toBe('name')
    expect(validateSupplierInput({ name: 'a'.repeat(SUPPLIER_FIELD_LIMITS.name), order_lead_days: 1 })).toEqual([])
  })

  it('admite un proveedor sin días de entrega', () => {
    expect(validateSupplierInput({ name: 'Pedidos sueltos', delivery_weekdays: [], order_lead_days: 0 })).toEqual([])
  })

  it('valida la antelación de 0 a 7 días enteros', () => {
    for (const value of [0, 7, '3']) {
      expect(validateSupplierInput({ name: 'X', order_lead_days: value })).toEqual([])
    }
    for (const value of [-1, 8, 1.5, '', null, 'abc']) {
      expect(validateSupplierInput({ name: 'X', order_lead_days: value }).map(e => e.name)).toEqual(['order_lead_days'])
    }
  })

  it('avisa de un nombre duplicado y propone reactivar si el otro está inactivo', () => {
    const list = [supplier(), supplier({ id: 's2', name: 'Lácteos Norte', is_active: false })]
    expect(validateSupplierInput({ name: 'HARINAS SOL', order_lead_days: 1 }, { suppliers: list })).toEqual([
      { name: 'name', message: 'Ya existe un proveedor con este nombre: «Harinas Sol».' },
    ])
    expect(validateSupplierInput({ name: 'lacteos norte', order_lead_days: 1 }, { suppliers: list })[0].message)
      .toBe('Ya existe «Lácteos Norte», desactivado. Actívalo desde «Inactivos» en lugar de crear otro.')
    // Al editar, su propio nombre no cuenta como duplicado.
    expect(validateSupplierInput({ name: 'Harinas Sol', order_lead_days: 1 }, { suppliers: list, currentId: 's1' })).toEqual([])
  })

  it('limita la longitud de las notas', () => {
    const notes = 'n'.repeat(SUPPLIER_FIELD_LIMITS.notes + 1)
    expect(validateSupplierInput({ name: 'X', order_lead_days: 1, notes }).map(e => e.name)).toEqual(['notes'])
  })

  it('detecta si hay cambios respecto al proveedor guardado', () => {
    const current = supplier()
    expect(hasSupplierChanges(current, toSupplierFormValues(current))).toBe(false)
    expect(hasSupplierChanges(current, { ...toSupplierFormValues(current), delivery_weekdays: [4, 1] })).toBe(false)
    expect(hasSupplierChanges(current, { ...toSupplierFormValues(current), name: ' Harinas  Sol ' })).toBe(false)
    expect(hasSupplierChanges(current, { ...toSupplierFormValues(current), delivery_weekdays: [1] })).toBe(true)
    expect(hasSupplierChanges(current, { ...toSupplierFormValues(current), order_lead_days: 2 })).toBe(true)
    expect(hasSupplierChanges(current, { ...toSupplierFormValues(current), notes: 'Nueva nota' })).toBe(true)
    expect(hasSupplierChanges(null, {})).toBe(true)
  })
})

describe('listado', () => {
  const list = [
    supplier({ id: 'a', name: 'Ñora Verduras' }),
    supplier({ id: 'b', name: 'lácteos Norte', is_active: false }),
    supplier({ id: 'c', name: 'Harinas Sol' }),
    supplier({ id: 'd', name: 'Ácido Bakery' }),
  ]

  it('ordena alfabéticamente en español, ignorando tildes y mayúsculas', () => {
    expect(sortSuppliers(list).map(s => s.name)).toEqual(['Ácido Bakery', 'Harinas Sol', 'lácteos Norte', 'Ñora Verduras'])
  })

  it('filtra por estado y busca sin tildes', () => {
    expect(filterSuppliers(list).map(s => s.id).sort()).toEqual(['a', 'c', 'd'])
    expect(filterSuppliers(list, { status: SUPPLIER_STATUS_FILTER.INACTIVE }).map(s => s.id)).toEqual(['b'])
    expect(filterSuppliers(list, { status: SUPPLIER_STATUS_FILTER.ALL, query: 'lacteos' }).map(s => s.id)).toEqual(['b'])
    expect(filterSuppliers(list, { status: SUPPLIER_STATUS_FILTER.ALL, query: 'sol har' }).map(s => s.id)).toEqual(['c'])
  })

  it('cuenta activos, inactivos y todos', () => {
    expect(countSuppliers(list)).toEqual({ active: 3, inactive: 1, all: 4 })
    expect(countSuppliers(null)).toEqual({ active: 0, inactive: 0, all: 0 })
  })

  it('sustituye o añade un proveedor manteniendo el orden', () => {
    const updated = upsertSupplier(list, supplier({ id: 'c', name: 'Zumos Sol' }))
    expect(updated.map(s => s.name).at(-1)).toBe('Zumos Sol')
    expect(updated).toHaveLength(4)
    expect(upsertSupplier(list, supplier({ id: 'e', name: 'Bebidas' }))).toHaveLength(5)
  })
})

describe('errores de la base de datos', () => {
  it('traduce el nombre duplicado (409, 23505) a un error del campo nombre', () => {
    const response = {
      status: 409,
      error: { code: '23505', message: 'duplicate key value violates unique constraint "suppliers_name_unique_idx"' },
    }
    const feedback = getSupplierErrorFeedback(response, 'save')
    expect(feedback.kind).toBe(DB_ERROR_KIND.VALIDATION)
    expect(feedback.message).toMatch(/^Ya existe un proveedor con este nombre/)
    expect(feedback.fields).toEqual([{ name: 'name', message: feedback.message }])
  })

  it('relaciona cada restricción CHECK con su campo', () => {
    const check = constraint => getSupplierFieldErrors({ code: '23514', message: `new row for relation "suppliers" violates check constraint "${constraint}"` })
    expect(check('suppliers_name_not_blank')[0].name).toBe('name')
    expect(check('suppliers_delivery_weekdays_valid')[0].name).toBe('delivery_weekdays')
    expect(check('suppliers_order_lead_days_range')[0].name).toBe('order_lead_days')
    expect(check('otra_restriccion')).toEqual([])
    expect(getSupplierFieldErrors({ code: '23502', message: 'null value in column "name" of relation "suppliers"' })[0].name).toBe('name')
  })

  it('da mensajes comprensibles para red, sesión, permisos y migración pendiente', () => {
    expect(getSupplierErrorFeedback({ error: new TypeError('Failed to fetch'), status: 0 }, 'load').kind).toBe(DB_ERROR_KIND.NETWORK)
    expect(getSupplierErrorFeedback({ error: { code: 'PGRST303' }, status: 401 }).message).toMatch(/sesión ha caducado/)
    expect(getSupplierErrorFeedback({ error: { code: '42501' }, status: 403 }).message).toMatch(/permiso para gestionar proveedores/)
    expect(getSupplierErrorFeedback({ error: { code: 'PGRST205' }, status: 404 }).message).toMatch(/sección 10/)
    expect(getSupplierErrorFeedback({ error: { code: 'PGRST116' }, status: 406 }, 'status').kind).toBe(DB_ERROR_KIND.NOT_FOUND)
    expect(getSupplierErrorFeedback({ error: { code: 'XX000' }, status: 500 }, 'status').message).toBe('No se ha podido cambiar el estado. Vuelve a intentarlo.')
  })
})
