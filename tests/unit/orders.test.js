import { describe, expect, it } from 'vitest'
import {
  AGENDA_OVERDUE_DAYS,
  AGENDA_UPCOMING_DAYS,
  ORDER_STATUS,
  buildAgenda,
  buildForecastInsert,
  buildForecasts,
  buildManualInsert,
  buildOrderUpdate,
  daysBetween,
  decorateHistoryRows,
  describeHistoryPage,
  describePreparedAt,
  describeRelativeDay,
  formatAgendaDay,
  formatShortDate,
  getAgendaQueryRange,
  getAgendaRange,
  getDefaultPrepareDate,
  getHistoryRange,
  getHolidayWarning,
  getIsoWeekday,
  getItemHolidayWarning,
  getOrderErrorFeedback,
  getPageCount,
  getSelectableSuppliers,
  hasOrderChanges,
  isForecastCovered,
  toOrderFormValues,
  validateOrderInput,
} from '../../app/utils/orders.js'
import { DB_ERROR_KIND } from '../../app/utils/database-errors.js'

// Miércoles 28 de octubre de 2026.
const TODAY = '2026-10-28'

const supplier = (over = {}) => ({
  id: 'sol',
  name: 'Harinas del Sol',
  delivery_weekdays: [1, 4], // lunes y jueves
  order_lead_days: 1,
  is_active: true,
  ...over,
})

const order = (over = {}) => ({
  id: 'o1',
  supplier_id: 'sol',
  scheduled_delivery_date: '2026-10-29',
  delivery_date: '2026-10-29',
  prepare_date: '2026-10-28',
  status: ORDER_STATUS.PENDING,
  prepared_at: null,
  notes: null,
  ...over,
})

describe('fechas de la agenda', () => {
  it('usa días de la semana ISO', () => {
    expect(getIsoWeekday('2026-10-26')).toBe(1)
    expect(getIsoWeekday('2026-10-28')).toBe(3)
    expect(getIsoWeekday('2026-11-01')).toBe(7)
  })

  it('agenda: 7 días atrasados, hoy y 14 días siguientes', () => {
    expect(AGENDA_OVERDUE_DAYS).toBe(7)
    expect(AGENDA_UPCOMING_DAYS).toBe(14)
    expect(getAgendaRange(TODAY)).toEqual({ from: '2026-10-21', today: TODAY, to: '2026-11-11' })
    expect(getAgendaQueryRange(TODAY)).toEqual({ from: '2026-10-21', to: '2026-11-11', deliveryTo: '2026-11-18' })
  })

  it('cuenta días sin desfases por el cambio de hora (25 oct 2026)', () => {
    expect(daysBetween('2026-10-24', '2026-10-26')).toBe(2)
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2)
    expect(getDefaultPrepareDate('2026-10-26', 2)).toBe('2026-10-24')
  })

  it('preparación por defecto = entrega − antelación, también al cambiar de mes y de año', () => {
    expect(getDefaultPrepareDate('2026-11-02', 3)).toBe('2026-10-30')
    expect(getDefaultPrepareDate('2027-01-01', 1)).toBe('2026-12-31')
    expect(getDefaultPrepareDate('2026-11-02', 0)).toBe('2026-11-02')
    expect(getDefaultPrepareDate('', 1)).toBe('')
  })
})

describe('previsiones', () => {
  it('calcula las entregas de los días configurados y su preparación', () => {
    const list = buildForecasts([supplier()], { from: '2026-10-28', to: '2026-11-04' })
    expect(list.map(f => [f.prepare_date, f.delivery_date])).toEqual([
      ['2026-10-28', '2026-10-29'], // jue 29 → mié 28
      ['2026-11-01', '2026-11-02'], // lun 2 → dom 1
      ['2026-11-04', '2026-11-05'], // jue 5 → mié 4
    ])
    expect(list.every(f => f.isForecast && f.status === 'pending' && f.scheduled_delivery_date === f.delivery_date)).toBe(true)
  })

  it('con antelación 0 se prepara el mismo día; con 7, una semana antes', () => {
    const same = buildForecasts([supplier({ delivery_weekdays: [3], order_lead_days: 0 })], { from: TODAY, to: TODAY })
    expect(same.map(f => [f.prepare_date, f.delivery_date])).toEqual([[TODAY, TODAY]])
    const week = buildForecasts([supplier({ delivery_weekdays: [3], order_lead_days: 7 })], { from: TODAY, to: TODAY })
    expect(week.map(f => [f.prepare_date, f.delivery_date])).toEqual([[TODAY, '2026-11-04']])
  })

  it('incluye los límites del rango y nada fuera de él', () => {
    const daily = supplier({ delivery_weekdays: [1, 2, 3, 4, 5, 6, 7], order_lead_days: 2 })
    const list = buildForecasts([daily], getAgendaRange(TODAY))
    expect(list).toHaveLength(7 + 1 + 14)
    expect(list[0].prepare_date).toBe('2026-10-21')
    expect(list.at(-1).prepare_date).toBe('2026-11-11')
  })

  it('no genera previsiones de proveedores inactivos ni sin días de entrega', () => {
    expect(buildForecasts([supplier({ is_active: false })], getAgendaRange(TODAY))).toEqual([])
    expect(buildForecasts([supplier({ delivery_weekdays: [] })], getAgendaRange(TODAY))).toEqual([])
  })

  it('es determinista: recalcular (recargar o cambiar de día) no duplica nada', () => {
    const a = buildForecasts([supplier()], getAgendaRange(TODAY))
    const b = buildForecasts([supplier()], getAgendaRange(TODAY))
    expect(a).toEqual(b)
    expect(new Set(a.map(f => f.key)).size).toBe(a.length)
    // Al día siguiente, las previsiones comunes conservan la misma clave.
    const next = buildForecasts([supplier()], getAgendaRange('2026-10-29'))
    const common = next.filter(f => a.some(x => x.key === f.key))
    expect(common.length).toBeGreaterThan(0)
    expect(new Set(next.map(f => f.key)).size).toBe(next.length)
  })

  it('una previsión queda cubierta por un pedido de su entrega prevista o de su fecha de entrega', () => {
    const [forecast] = buildForecasts([supplier()], { from: TODAY, to: TODAY })
    expect(isForecastCovered(forecast, [order()])).toBe(true)
    // Pedido movido a otra fecha: sigue ocupando su previsión de origen.
    expect(isForecastCovered(forecast, [order({ delivery_date: '2026-10-30', prepare_date: '2026-10-29' })])).toBe(true)
    // Pedido manual con la misma fecha de entrega.
    expect(isForecastCovered(forecast, [order({ scheduled_delivery_date: null })])).toBe(true)
    // Otro proveedor u otra fecha: no la cubre.
    expect(isForecastCovered(forecast, [order({ supplier_id: 'otro' })])).toBe(false)
    expect(isForecastCovered(forecast, [order({ scheduled_delivery_date: '2026-11-02', delivery_date: '2026-11-02' })])).toBe(false)
  })
})

describe('agenda', () => {
  const holidays = [{ id: 'h', holiday_date: '2026-11-02', name: 'Fiesta local', scope: 'local' }]

  it('agrupa por fecha de preparación: hoy siempre, después solo días con pedidos', () => {
    const agenda = buildAgenda({ suppliers: [supplier()], orders: [], holidays, today: TODAY })
    expect(agenda.days[0]).toMatchObject({ date: TODAY, isToday: true })
    expect(agenda.days.map(d => d.date)).toEqual(['2026-10-28', '2026-11-01', '2026-11-04', '2026-11-08', '2026-11-11'])
    const empty = buildAgenda({ suppliers: [], orders: [], holidays: [], today: TODAY })
    expect(empty.days).toEqual([{ date: TODAY, isToday: true, items: [] }])
    expect(empty.total).toBe(0)
  })

  it('atrasados: solo pendientes de los 7 días anteriores (previsiones y pedidos)', () => {
    const orders = [
      order({ id: 'p', scheduled_delivery_date: '2026-10-26', delivery_date: '2026-10-26', prepare_date: '2026-10-25', status: 'prepared', prepared_at: '2026-10-25T08:00:00Z' }),
      order({ id: 's', scheduled_delivery_date: '2026-10-22', delivery_date: '2026-10-22', prepare_date: '2026-10-21', status: 'skipped' }),
      order({ id: 'old', scheduled_delivery_date: null, delivery_date: '2026-10-15', prepare_date: '2026-10-14' }),
    ]
    const agenda = buildAgenda({ suppliers: [supplier()], orders, holidays: [], today: TODAY })
    // Las dos previsiones atrasadas (jueves 22 y lunes 26) están cubiertas por
    // pedidos ya descartado y preparado, que no se muestran como atrasados; el
    // pedido pendiente de hace más de 7 días queda fuera de la agenda.
    expect(agenda.overdue).toEqual([])

    const pending = buildAgenda({ suppliers: [supplier()], orders: [], holidays: [], today: TODAY })
    expect(pending.overdue.map(i => [i.prepare_date, i.isForecast])).toEqual([
      ['2026-10-21', true], // jue 22
      ['2026-10-25', true], // lun 26
    ])
  })

  it('no duplica una previsión que ya tiene pedido guardado', () => {
    const orders = [order({ status: 'prepared', prepared_at: '2026-10-28T08:00:00Z' })]
    const today = buildAgenda({ suppliers: [supplier()], orders, holidays: [], today: TODAY }).days[0]
    expect(today.items).toHaveLength(1)
    expect(today.items[0]).toMatchObject({ isForecast: false, id: 'o1', status: 'prepared' })
  })

  it('un pedido movido aparece en su nueva fecha y su previsión no reaparece', () => {
    const moved = order({ delivery_date: '2026-10-31', prepare_date: '2026-10-30' })
    const agenda = buildAgenda({ suppliers: [supplier()], orders: [moved], holidays: [], today: TODAY })
    const all = [...agenda.overdue, ...agenda.days.flatMap(d => d.items)]
    expect(all.filter(i => i.scheduled_delivery_date === '2026-10-29')).toHaveLength(1)
    expect(agenda.days.find(d => d.date === '2026-10-30').items[0].id).toBe('o1')
    expect(agenda.days[0].items).toEqual([])
  })

  it('muestra los pedidos de hoy en adelante en cualquier estado, y los de proveedores inactivos', () => {
    const inactive = supplier({ id: 'cafe', name: 'Cafés', is_active: false })
    const orders = [
      order({ id: 'a', status: 'skipped' }),
      order({ id: 'b', supplier_id: 'cafe', supplier: inactive, scheduled_delivery_date: null, delivery_date: '2026-10-30', prepare_date: '2026-10-29' }),
    ]
    const agenda = buildAgenda({ suppliers: [supplier(), inactive], orders, holidays: [], today: TODAY })
    expect(agenda.days[0].items.map(i => i.status)).toEqual(['skipped'])
    expect(agenda.days.find(d => d.date === '2026-10-29').items[0].supplier.is_active).toBe(false)
  })

  it('ordena los pedidos de un día por proveedor', () => {
    const suppliers = [supplier({ id: 'z', name: 'Zumos' }), supplier({ id: 'a', name: 'Ácido' }), supplier()]
    const day = buildAgenda({ suppliers, orders: [], holidays: [], today: TODAY }).days[0]
    expect(day.items.map(i => i.supplier.name)).toEqual(['Ácido', 'Harinas del Sol', 'Zumos'])
  })

  it('avisa si la entrega coincide con un festivo, sin cambiar fechas ni estado', () => {
    const agenda = buildAgenda({ suppliers: [supplier()], orders: [], holidays, today: TODAY })
    const item = agenda.days.find(d => d.date === '2026-11-01').items[0]
    expect(item).toMatchObject({ delivery_date: '2026-11-02', prepare_date: '2026-11-01', status: 'pending' })
    expect(item.holidayWarning.message).toBe('La entrega coincide con un festivo: Fiesta local (local). Confirma con el proveedor si mantiene la entrega.')
    expect(item.holidayWarning.message).not.toMatch(/cerrad|no entrega|cancel/i)
    expect(agenda.days[0].items[0].holidayWarning).toBeNull()
    expect(getHolidayWarning('2026-11-03', holidays)).toBeNull()
  })

  it('no avisa de festivos en pedidos «no se pide» ni en entregas ya pasadas', () => {
    const onHoliday = { status: 'pending', delivery_date: '2026-11-02' }
    expect(getItemHolidayWarning(onHoliday, holidays, TODAY)).not.toBeNull()
    expect(getItemHolidayWarning({ ...onHoliday, status: 'prepared' }, holidays, TODAY)).not.toBeNull()
    expect(getItemHolidayWarning({ ...onHoliday, status: 'skipped' }, holidays, TODAY)).toBeNull()
    expect(getItemHolidayWarning(onHoliday, holidays, '2026-11-03')).toBeNull()
    expect(getItemHolidayWarning(onHoliday, holidays, '2026-11-02')).not.toBeNull()

    const skipped = order({ id: 's', status: 'skipped', scheduled_delivery_date: '2026-11-02', delivery_date: '2026-11-02', prepare_date: '2026-11-01' })
    const agenda = buildAgenda({ suppliers: [supplier()], orders: [skipped], holidays, today: TODAY })
    const item = agenda.days.find(d => d.date === '2026-11-01').items[0]
    expect(item).toMatchObject({ status: 'skipped', holidayWarning: null })
  })

  it('el historial lleva los mismos avisos que la agenda', () => {
    const rows = [
      order({ id: 'p', status: 'pending', delivery_date: '2026-11-02', prepare_date: '2026-11-01' }),
      order({ id: 'k', status: 'skipped', delivery_date: '2026-11-02', prepare_date: '2026-11-01', supplier_id: 'otro' }),
      order({ id: 'v', status: 'prepared', delivery_date: '2026-10-20', prepare_date: '2026-10-19' }),
    ]
    const decorated = decorateHistoryRows(rows, [...holidays, { id: 'h2', holiday_date: '2026-10-20', name: 'Pasado', scope: 'local' }], TODAY)
    expect(decorated.map(r => [r.key, r.isForecast, Boolean(r.holidayWarning)])).toEqual([
      ['order:p', false, true],
      ['order:k', false, false],
      ['order:v', false, false],
    ])
  })
})

describe('datos que se guardan', () => {
  const [forecast] = buildForecasts([supplier()], { from: TODAY, to: TODAY })

  it('una previsión se guarda con su entrega prevista de origen', () => {
    expect(buildForecastInsert(forecast, { status: 'prepared' })).toEqual({
      supplier_id: 'sol', scheduled_delivery_date: '2026-10-29', delivery_date: '2026-10-29', prepare_date: '2026-10-28', status: 'prepared', notes: null,
    })
    expect(buildForecastInsert(forecast, { delivery_date: '2026-10-30', prepare_date: '2026-10-29', notes: '  2 sacos ' })).toMatchObject({
      scheduled_delivery_date: '2026-10-29', delivery_date: '2026-10-30', prepare_date: '2026-10-29', status: 'pending', notes: '2 sacos',
    })
  })

  it('un pedido manual no tiene previsión de origen', () => {
    expect(buildManualInsert({ supplier_id: 'sol', delivery_date: '2026-11-03', prepare_date: '2026-11-02', notes: '' })).toEqual({
      supplier_id: 'sol', scheduled_delivery_date: null, delivery_date: '2026-11-03', prepare_date: '2026-11-02', status: 'pending', notes: null,
    })
  })

  it('al modificar solo se envían columnas permitidas (nunca proveedor ni previsión)', () => {
    expect(buildOrderUpdate({ supplier_id: 'x', scheduled_delivery_date: '2026-01-01', prepared_at: 'x', status: 'prepared' })).toEqual({ status: 'prepared' })
    expect(buildOrderUpdate({ delivery_date: '2026-10-30', prepare_date: '2026-10-29', notes: '  ' })).toEqual({ delivery_date: '2026-10-30', prepare_date: '2026-10-29', notes: null })
  })

  it('detecta cambios de fechas y notas', () => {
    const current = order({ notes: 'Llamar' })
    expect(hasOrderChanges(current, toOrderFormValues(current))).toBe(false)
    expect(hasOrderChanges(current, { ...toOrderFormValues(current), notes: ' Llamar ' })).toBe(false)
    expect(hasOrderChanges(current, { ...toOrderFormValues(current), prepare_date: '2026-10-27' })).toBe(true)
  })
})

describe('validación del formulario', () => {
  const suppliers = [supplier(), supplier({ id: 'cafe', name: 'Cafés', is_active: false })]

  it('exige fechas válidas y preparación no posterior a la entrega', () => {
    expect(validateOrderInput({}, { supplierId: 'sol' }).map(e => e.name)).toEqual(['delivery_date', 'prepare_date'])
    expect(validateOrderInput({ delivery_date: '2026-10-29', prepare_date: '2026-10-30' }, { supplierId: 'sol' })).toEqual([
      { name: 'prepare_date', message: 'La preparación no puede ser posterior a la entrega.' },
    ])
    expect(validateOrderInput({ delivery_date: '2026-10-29', prepare_date: '2026-10-29' }, { supplierId: 'sol' })).toEqual([])
    expect(validateOrderInput({ delivery_date: '2026-02-30', prepare_date: '2026-02-01' }, { supplierId: 'sol' })[0].message).toBe('La fecha no es válida.')
  })

  it('un pedido nuevo necesita un proveedor activo', () => {
    const values = { delivery_date: '2026-11-03', prepare_date: '2026-11-02' }
    expect(validateOrderInput(values, { isNew: true, suppliers })[0]).toEqual({ name: 'supplier_id', message: 'Elige el proveedor.' })
    expect(validateOrderInput({ ...values, supplier_id: 'cafe' }, { isNew: true, suppliers })[0].name).toBe('supplier_id')
    expect(validateOrderInput({ ...values, supplier_id: 'sol' }, { isNew: true, suppliers })).toEqual([])
  })

  it('avisa si el proveedor ya tiene otro pedido con esa entrega, salvo el propio', () => {
    const orders = [order()]
    const values = { delivery_date: '2026-10-29', prepare_date: '2026-10-28' }
    expect(validateOrderInput({ ...values, supplier_id: 'sol' }, { isNew: true, suppliers, orders })).toEqual([
      { name: 'delivery_date', message: 'Este proveedor ya tiene un pedido con entrega el jue, 29 oct.' },
    ])
    expect(validateOrderInput(values, { supplierId: 'sol', orders, currentId: 'o1' })).toEqual([])
    expect(validateOrderInput(values, { supplierId: 'otro', orders })).toEqual([])
  })

  it('limita las notas a 1000 caracteres', () => {
    expect(validateOrderInput({ delivery_date: '2026-10-29', prepare_date: '2026-10-28', notes: 'n'.repeat(1001) }, { supplierId: 'sol' }).map(e => e.name)).toEqual(['notes'])
  })

  it('solo ofrece proveedores activos para pedidos manuales', () => {
    expect(getSelectableSuppliers(suppliers).map(s => s.id)).toEqual(['sol'])
  })
})

describe('historial', () => {
  it('pagina de 20 en 20', () => {
    expect(getHistoryRange(0)).toEqual({ start: 0, end: 19 })
    expect(getHistoryRange(2)).toEqual({ start: 40, end: 59 })
    expect(getPageCount(0)).toBe(1)
    expect(getPageCount(45)).toBe(3)
    expect(describeHistoryPage(1, 45)).toBe('Mostrando 21–40 de 45')
    expect(describeHistoryPage(2, 45)).toBe('Mostrando 41–45 de 45')
    expect(describeHistoryPage(0, 0)).toBe('')
  })
})

describe('textos', () => {
  it('fechas cortas y relativas', () => {
    expect(formatShortDate('2026-10-29', TODAY)).toBe('jue, 29 oct')
    expect(formatShortDate('2027-01-04', TODAY)).toBe('lun, 4 ene 2027')
    expect(describeRelativeDay('2026-10-28', TODAY)).toBe('hoy')
    expect(describeRelativeDay('2026-10-29', TODAY)).toBe('mañana')
    expect(describeRelativeDay('2026-10-27', TODAY)).toBe('ayer')
    expect(describeRelativeDay('2026-10-24', TODAY)).toBe('hace 4 días')
    expect(describeRelativeDay('2026-11-02', TODAY)).toBe('dentro de 5 días')
  })

  it('cabeceras de los días de la agenda', () => {
    expect(formatAgendaDay(TODAY, TODAY)).toEqual({ title: 'Hoy', subtitle: 'miércoles, 28 de octubre' })
    expect(formatAgendaDay('2026-10-29', TODAY)).toEqual({ title: 'Mañana', subtitle: 'jueves, 29 de octubre' })
    expect(formatAgendaDay('2026-11-02', TODAY)).toEqual({ title: 'Lunes', subtitle: '2 de noviembre' })
  })

  it('hora de preparación en la zona de la tienda', () => {
    expect(describePreparedAt('2026-10-28T09:32:00Z', TODAY)).toBe('Preparado hoy a las 10:32')
    expect(describePreparedAt('2026-10-26T23:30:00Z', TODAY)).toBe('Preparado el mar, 27 oct a las 00:30')
    expect(describePreparedAt(null, TODAY)).toBe('')
  })
})

describe('errores y conflictos', () => {
  it('misma previsión guardada desde otro dispositivo: conflicto (recargar)', () => {
    const feedback = getOrderErrorFeedback({ status: 409, error: { code: '23505', message: 'duplicate key value violates unique constraint "orders_supplier_scheduled_unique"' } })
    expect(feedback).toMatchObject({ conflict: true, fields: [] })
    expect(feedback.message).toMatch(/otro dispositivo/)
  })

  it('la misma previsión puede chocar con la restricción de fecha de entrega: también es «otro dispositivo»', () => {
    const response = { status: 409, error: { code: '23505', message: 'duplicate key value violates unique constraint "orders_supplier_delivery_unique"' } }
    const insert = { supplier_id: 'sol', scheduled_delivery_date: '2026-10-29', delivery_date: '2026-10-29' }
    expect(getOrderErrorFeedback(response, 'status', { insert })).toMatchObject({ conflict: true, fields: [] })
    expect(getOrderErrorFeedback(response, 'status', { insert }).message).toMatch(/otro dispositivo/)
    // Si se había cambiado la fecha, es otra entrega ocupada (error de campo).
    const moved = { ...insert, delivery_date: '2026-10-30' }
    expect(getOrderErrorFeedback(response, 'save', { insert: moved }).fields[0].name).toBe('delivery_date')
  })

  it('otra entrega ocupada: error en la fecha de entrega y conflicto', () => {
    const feedback = getOrderErrorFeedback({ status: 409, error: { code: '23505', message: 'duplicate key value violates unique constraint "orders_supplier_delivery_unique"' } })
    expect(feedback.conflict).toBe(true)
    expect(feedback.fields).toEqual([{ name: 'delivery_date', message: 'Este proveedor ya tiene otro pedido con esa fecha de entrega.' }])
  })

  it('preparación posterior a la entrega rechazada por la base de datos', () => {
    const feedback = getOrderErrorFeedback({ status: 400, error: { code: '23514', message: 'violates check constraint "orders_prepare_not_after_delivery"' } })
    expect(feedback).toMatchObject({ conflict: false, kind: DB_ERROR_KIND.VALIDATION })
    expect(feedback.fields[0].name).toBe('prepare_date')
  })

  it('fila inexistente o que ya no es pendiente: conflicto con mensaje propio', () => {
    expect(getOrderErrorFeedback({ status: 406, error: { code: 'PGRST116' } }, 'delete').message).toMatch(/solo se eliminan pedidos pendientes/)
    expect(getOrderErrorFeedback({ status: 406, error: { code: 'PGRST116' } }, 'status')).toMatchObject({ conflict: true })
  })

  it('red, permisos, sesión caducada y migración pendiente', () => {
    expect(getOrderErrorFeedback({ error: new TypeError('Failed to fetch'), status: 0 }, 'status').message).toBe('No se ha podido cambiar el estado. Comprueba la conexión a Internet y vuelve a intentarlo.')
    expect(getOrderErrorFeedback({ error: { code: '42501' }, status: 403 }).message).toBe('Esta cuenta no tiene permiso para gestionar pedidos.')
    expect(getOrderErrorFeedback({ error: { code: 'PGRST303' }, status: 401 }).kind).toBe(DB_ERROR_KIND.EXPIRED)
    expect(getOrderErrorFeedback({ error: { code: 'PGRST205' }, status: 404 }, 'load').message).toMatch(/sección 10/)
  })
})
