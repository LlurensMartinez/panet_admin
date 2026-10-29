import { describe, expect, it } from 'vitest'
import {
  buildHomeSummary,
  describeHomeSummary,
  formatHomeTitle,
  getGreeting,
  groupActiveProducts,
  plural,
} from '../../app/utils/home.js'
import { ORDER_STATUS } from '../../app/utils/orders.js'
import { getTodayDate } from '../../app/utils/overtime.js'

// Jueves 29 de octubre de 2026. Mañana: viernes 30.
const TODAY = '2026-10-29'
const TOMORROW = '2026-10-30'

const supplier = (id, name, weekdays, lead = 1, over = {}) => ({
  id,
  name,
  delivery_weekdays: weekdays,
  order_lead_days: lead,
  is_active: true,
  ...over,
})

// Entrega viernes con 1 día de antelación → se prepara el jueves (hoy).
const harinas = supplier('har', 'Harinas del Sol', [5], 1)
// Entrega sábado con 1 día → se prepara el viernes (mañana).
const lacteos = supplier('lac', 'Lácteos Norte', [6], 1)
// Entrega viernes con 1 día → hoy, sin productos activos.
const envases = supplier('env', 'Envases Ruiz', [5], 1)
// Sin entregas hoy ni mañana.
const frutas = supplier('fru', 'Frutas Mari', [3], 1)

const product = (id, supplierId, name, quantity, unit, over = {}) => ({
  id,
  supplier_id: supplierId,
  name,
  unit,
  usual_quantity: quantity,
  is_active: true,
  ...over,
})

const products = [
  product('p1', 'har', 'Harina de fuerza', 25, 'kg'),
  product('p2', 'har', 'Azúcar', 2.5, 'kg'),
  product('p3', 'har', 'Levadura', 12, 'paquetes'),
  product('p4', 'har', 'Harina integral', 10, 'kg', { is_active: false }),
  product('p5', 'lac', 'Mantequilla', 6, 'bloques'),
  product('p6', 'lac', 'Leche entera', 24, 'l'),
  product('p7', 'env', 'Bolsas', 500, 'uds', { is_active: false }),
]

const order = (over = {}) => ({
  id: 'o1',
  supplier_id: 'har',
  scheduled_delivery_date: '2026-10-30',
  delivery_date: '2026-10-30',
  prepare_date: TODAY,
  status: ORDER_STATUS.PENDING,
  prepared_at: null,
  notes: null,
  ...over,
})

const holiday = (date, name = 'Festivo', scope = 'local') => ({ id: date, holiday_date: date, name, scope })

// Las previsiones de los 7 días anteriores ya preparadas (si no, la agenda
// las considera atrasadas, igual que en /pedidos).
const settled = [
  ['har', '2026-10-23', '2026-10-22'],
  ['lac', '2026-10-24', '2026-10-23'],
  ['env', '2026-10-23', '2026-10-22'],
  ['fru', '2026-10-28', '2026-10-27'],
].map(([supplierId, delivery, prepare]) => ({
  id: `done-${supplierId}`,
  supplier_id: supplierId,
  scheduled_delivery_date: delivery,
  delivery_date: delivery,
  prepare_date: prepare,
  status: ORDER_STATUS.PREPARED,
  prepared_at: `${prepare}T08:00:00Z`,
  notes: null,
}))

const summarize = (over = {}) => buildHomeSummary({
  suppliers: [harinas, lacteos, envases, frutas],
  holidays: [],
  products,
  today: TODAY,
  ...over,
  orders: [...settled, ...(over.orders ?? [])],
})

const names = section => section.cards.map(card => card.name)

describe('buildHomeSummary: hoy y mañana', () => {
  it('agrupa por proveedor las previsiones de hoy y de mañana', () => {
    const summary = summarize()
    expect(summary.today.date).toBe(TODAY)
    expect(summary.tomorrow.date).toBe(TOMORROW)
    expect(names(summary.today)).toEqual(['Envases Ruiz', 'Harinas del Sol'])
    expect(names(summary.tomorrow)).toEqual(['Lácteos Norte'])
    expect(summary.today).toMatchObject({ orderCount: 2, supplierCount: 2, overdueCount: 0, doneCount: 0 })
    expect(summary.tomorrow).toMatchObject({ orderCount: 1, supplierCount: 1 })
  })

  it('muestra solo productos activos, ordenados y con su unidad', () => {
    const card = summarize().today.cards.find(c => c.supplierId === 'har')
    expect(card.products.map(p => [p.name, p.usual_quantity, p.unit])).toEqual([
      ['Azúcar', 2.5, 'kg'],
      ['Harina de fuerza', 25, 'kg'],
      ['Levadura', 12, 'paquetes'],
    ])
    const tomorrowCard = summarize().tomorrow.cards[0]
    expect(tomorrowCard.products.map(p => p.unit)).toEqual(['l', 'bloques'])
  })

  it('el proveedor sin productos activos aparece igualmente, con la lista vacía', () => {
    const card = summarize().today.cards.find(c => c.supplierId === 'env')
    expect(card).toBeTruthy()
    expect(card.products).toEqual([])
  })

  it('no inventa cantidades: devuelve las habituales tal cual', () => {
    const summary = summarize({ products: [product('x', 'har', 'Sal', 1.25, 'kg')] })
    expect(summary.today.cards.find(c => c.supplierId === 'har').products[0].usual_quantity).toBe(1.25)
  })

  it('no muestra los pedidos preparados ni los «no se pide», pero los cuenta', () => {
    const summary = summarize({
      orders: [
        order({ id: 'a', supplier_id: 'har', status: ORDER_STATUS.PREPARED, prepared_at: '2026-10-29T08:00:00Z' }),
        order({ id: 'b', supplier_id: 'env', status: ORDER_STATUS.SKIPPED }),
        order({ id: 'c', supplier_id: 'lac', scheduled_delivery_date: '2026-10-31', delivery_date: '2026-10-31', prepare_date: TOMORROW, status: ORDER_STATUS.SKIPPED }),
      ],
    })
    expect(summary.today.cards).toEqual([])
    expect(summary.today).toMatchObject({ orderCount: 0, doneCount: 2 })
    expect(summary.tomorrow.cards).toEqual([])
    expect(summary.tomorrow.doneCount).toBe(1)
  })

  it('un pedido guardado sustituye a su previsión: el proveedor no se duplica', () => {
    const summary = summarize({ orders: [order({ id: 'g', notes: 'Pedir más harina' })] })
    const card = summary.today.cards.find(c => c.supplierId === 'har')
    expect(card.deliveries).toHaveLength(1)
    expect(card.deliveries[0]).toMatchObject({ key: 'order:g', isForecast: false, manual: false, moved: false })
    expect(summary.today.orderCount).toBe(2)
  })

  it('respeta las fechas cambiadas: un pedido movido a mañana sale de hoy', () => {
    const summary = summarize({
      orders: [order({ id: 'm', delivery_date: '2026-10-31', prepare_date: TOMORROW })],
    })
    expect(names(summary.today)).toEqual(['Envases Ruiz'])
    const card = summary.tomorrow.cards.find(c => c.supplierId === 'har')
    expect(card.deliveries[0]).toMatchObject({ moved: true, deliveryDate: '2026-10-31', prepareDate: TOMORROW })
  })

  it('respeta la fecha de preparación cambiada a mano', () => {
    // Previsto para preparar hoy, adelantado a ayer (y aún pendiente) → atrasado.
    const summary = summarize({ orders: [order({ id: 'p', prepare_date: '2026-10-28' })] })
    const card = summary.today.cards.find(c => c.supplierId === 'har')
    expect(card.overdue).toBe(true)
    expect(card.deliveries[0]).toMatchObject({ overdue: true, prepareDate: '2026-10-28' })
  })

  it('incluye los pedidos manuales, marcados como tales', () => {
    const summary = summarize({
      orders: [order({ id: 'x', supplier_id: 'fru', scheduled_delivery_date: null, delivery_date: '2026-10-31', prepare_date: TOMORROW })],
    })
    const card = summary.tomorrow.cards.find(c => c.supplierId === 'fru')
    expect(card.deliveries[0]).toMatchObject({ manual: true, isForecast: false })
    expect(card.products).toEqual([])
  })

  it('agrupa en una tarjeta varias entregas del mismo proveedor el mismo día', () => {
    const summary = summarize({
      orders: [order({ id: 'x', supplier_id: 'har', scheduled_delivery_date: null, delivery_date: '2026-11-02', prepare_date: TODAY })],
    })
    const cards = summary.today.cards.filter(c => c.supplierId === 'har')
    expect(cards).toHaveLength(1)
    expect(cards[0].deliveries.map(d => d.deliveryDate)).toEqual(['2026-10-30', '2026-11-02'])
    expect(summary.today).toMatchObject({ orderCount: 3, supplierCount: 2 })
  })

  it('añade a hoy los pendientes atrasados de la agenda, primero y marcados', () => {
    const summary = summarize({
      orders: [order({ id: 'old', supplier_id: 'fru', scheduled_delivery_date: null, delivery_date: '2026-10-29', prepare_date: '2026-10-26' })],
    })
    expect(names(summary.today)).toEqual(['Frutas Mari', 'Envases Ruiz', 'Harinas del Sol'])
    expect(summary.today.cards[0]).toMatchObject({ overdue: true })
    expect(summary.today.overdueCount).toBe(1)
    expect(summary.tomorrow.overdueCount).toBe(0)
  })

  it('no trae atrasados preparados, «no se pide» ni de hace más de 7 días', () => {
    const summary = summarize({
      orders: [
        order({ id: 'old1', supplier_id: 'fru', scheduled_delivery_date: null, delivery_date: '2026-10-27', prepare_date: '2026-10-26', status: ORDER_STATUS.PREPARED }),
        order({ id: 'old2', supplier_id: 'fru', scheduled_delivery_date: null, delivery_date: '2026-10-25', prepare_date: '2026-10-24', status: ORDER_STATUS.SKIPPED }),
        order({ id: 'old3', supplier_id: 'fru', scheduled_delivery_date: null, delivery_date: '2026-10-21', prepare_date: '2026-10-20' }),
      ],
    })
    expect(summary.today.overdueCount).toBe(0)
    expect(names(summary.today)).not.toContain('Frutas Mari')
  })

  it('como en la agenda, una previsión de los últimos 7 días sin marcar está atrasada', () => {
    const summary = buildHomeSummary({ suppliers: [frutas, harinas], products, today: TODAY })
    // Frutas Mari: entrega el miércoles 28, preparación el martes 27, sin marcar.
    expect(names(summary.today)).toEqual(['Frutas Mari', 'Harinas del Sol'])
    const harinasCard = summary.today.cards[1]
    // Harinas: la previsión del jueves 22 (atrasada) y la de hoy, en una sola tarjeta.
    expect(harinasCard.deliveries.map(d => [d.prepareDate, d.overdue])).toEqual([
      ['2026-10-22', true],
      ['2026-10-29', false],
    ])
    expect(summary.today).toMatchObject({ orderCount: 3, supplierCount: 2, overdueCount: 2 })
  })

  it('avisa del festivo en la fecha de entrega, sin mover nada', () => {
    const summary = summarize({ holidays: [holiday('2026-10-30', 'Fiesta local')] })
    const card = summary.today.cards.find(c => c.supplierId === 'har')
    expect(card.deliveries[0].deliveryDate).toBe('2026-10-30')
    expect(card.deliveries[0].holidayWarning.message).toContain('Fiesta local')
    expect(summary.tomorrow.cards[0].deliveries[0].holidayWarning).toBeNull()
  })

  it('no muestra proveedores desactivados sin pedidos guardados', () => {
    const summary = summarize({ suppliers: [{ ...harinas, is_active: false }, lacteos] })
    expect(names(summary.today)).toEqual([])
  })

  it('sin datos devuelve secciones vacías', () => {
    const summary = buildHomeSummary({ today: TODAY })
    expect(summary.today).toMatchObject({ cards: [], orderCount: 0, supplierCount: 0, doneCount: 0 })
    expect(summary.tomorrow).toMatchObject({ cards: [], orderCount: 0 })
  })

  it('mañana cruza el cambio de mes', () => {
    const summary = buildHomeSummary({
      suppliers: [supplier('s', 'Pan', [7], 0)],
      today: '2026-10-31',
    })
    expect(summary.tomorrow.date).toBe('2026-11-01')
    expect(names(summary.tomorrow)).toEqual(['Pan'])
    expect(summary.tomorrow.cards[0].deliveries[0]).toMatchObject({ deliveryDate: '2026-11-01', prepareDate: '2026-11-01' })
  })
})

describe('groupActiveProducts', () => {
  it('agrupa por proveedor e ignora los inactivos', () => {
    const groups = groupActiveProducts(products)
    expect([...groups.keys()].sort()).toEqual(['har', 'lac'])
    expect(groups.get('env')).toBeUndefined()
    expect(groupActiveProducts(null).size).toBe(0)
  })
})

describe('textos de Inicio', () => {
  it('saluda según la hora de Madrid, no la del navegador', () => {
    // 05:30 UTC = 06:30 en Madrid (horario de invierno, UTC+1).
    expect(getGreeting(new Date('2026-10-29T05:30:00Z'))).toBe('Buenos días')
    expect(getGreeting(new Date('2026-10-29T04:30:00Z'))).toBe('Buenas noches')
    expect(getGreeting(new Date('2026-10-29T13:00:00Z'))).toBe('Buenas tardes')
    expect(getGreeting(new Date('2026-10-29T20:30:00Z'))).toBe('Buenas noches')
    // Verano (UTC+2): 12:30 UTC = 14:30 en Madrid.
    expect(getGreeting(new Date('2026-07-01T12:30:00Z'))).toBe('Buenas tardes')
  })

  it('«hoy» es el día de Madrid también cerca de medianoche', () => {
    // 23:30 UTC del 29 = 00:30 del 30 en Madrid.
    expect(getTodayDate(new Date('2026-10-29T23:30:00Z'))).toBe('2026-10-30')
    const summary = buildHomeSummary({ suppliers: [lacteos], today: getTodayDate(new Date('2026-10-29T23:30:00Z')) })
    expect(summary.today.date).toBe('2026-10-30')
    // Lácteos (entrega sábado, 1 día) se prepara el viernes 30: hoy en Madrid.
    expect(summary.today.cards[0].deliveries.at(-1)).toMatchObject({ prepareDate: '2026-10-30', overdue: false })
    expect(summary.tomorrow.date).toBe('2026-10-31')
  })

  it('formatea el título del día', () => {
    expect(formatHomeTitle('2026-10-29')).toBe('Jueves, 29 de octubre')
    expect(formatHomeTitle('2026-11-01')).toBe('Domingo, 1 de noviembre')
  })

  it('resume los recuentos reales', () => {
    expect(describeHomeSummary(summarize())).toBe('Por preparar: 2 pedidos hoy y 1 mañana.')
    expect(describeHomeSummary(buildHomeSummary({ today: TODAY }))).toBe('No hay pedidos pendientes de preparar ni hoy ni mañana.')
    expect(describeHomeSummary({ today: { orderCount: 1, overdueCount: 1 }, tomorrow: { orderCount: 0 } }))
      .toBe('Por preparar: 1 pedido hoy (1 atrasado) y ninguno mañana.')
    expect(describeHomeSummary({ today: { orderCount: 0 }, tomorrow: { orderCount: 3 } }))
      .toBe('Por preparar: ninguno hoy y 3 mañana.')
  })

  it('plural', () => {
    expect(plural(1, 'proveedor', 'proveedores')).toBe('1 proveedor')
    expect(plural(0, 'proveedor', 'proveedores')).toBe('0 proveedores')
  })
})
