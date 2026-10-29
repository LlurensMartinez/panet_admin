import { describe, expect, it } from 'vitest'
import {
  COMMON_UNITS,
  MAX_USUAL_QUANTITY,
  PRODUCT_FIELD_LIMITS,
  countProducts,
  filterProducts,
  findDuplicateProduct,
  formatProductQuantity,
  formatQuantity,
  getProductErrorFeedback,
  getProductFieldErrors,
  getProductNameKey,
  hasProductChanges,
  isUuid,
  normalizeProductInput,
  parseQuantity,
  sortProducts,
  toProductFormValues,
  upsertProduct,
  validateProductInput,
} from '../../app/utils/products.js'
import { SUPPLIER_STATUS_FILTER } from '../../app/utils/suppliers.js'
import { DB_ERROR_KIND } from '../../app/utils/database-errors.js'

const product = (over = {}) => ({
  id: 'p1',
  supplier_id: 's1',
  name: 'Harina de fuerza',
  unit: 'sacos',
  usual_quantity: 2,
  is_active: true,
  ...over,
})
const valid = (over = {}) => ({ name: 'Levadura', unit: 'kg', usual_quantity: '2,5', ...over })

describe('identificador del proveedor', () => {
  it('reconoce un UUID y rechaza otros textos', () => {
    expect(isUuid('aaaaaaaa-0000-4000-8000-000000000001')).toBe(true)
    expect(isUuid('no-existe')).toBe(false)
    expect(isUuid('')).toBe(false)
    expect(isUuid(undefined)).toBe(false)
  })
})

describe('cantidades', () => {
  it('admite coma o punto decimal y hasta dos decimales', () => {
    expect(parseQuantity('2,5')).toBe(2.5)
    expect(parseQuantity(' 2.25 ')).toBe(2.25)
    expect(parseQuantity('12')).toBe(12)
    expect(parseQuantity(3)).toBe(3)
  })

  it('rechaza textos que no son una cantidad clara', () => {
    for (const value of ['', 'abc', '2,555', '1.000,5', '-1', '1e3', '2,', ',5', '1 000', null, undefined, Number.NaN, Infinity]) {
      expect(Number.isNaN(parseQuantity(value)), String(value)).toBe(true)
    }
  })

  it('muestra la cantidad en formato español', () => {
    expect(formatQuantity(2.5)).toBe('2,5')
    expect(formatQuantity(12)).toBe('12')
    expect(formatQuantity(99999.99)).toBe('99.999,99')
    expect(formatQuantity('abc')).toBe('')
    expect(formatProductQuantity(product({ usual_quantity: 2.5, unit: 'kg' }))).toBe('2,5 kg')
  })

  it('propone unidades habituales', () => {
    expect(COMMON_UNITS).toEqual(expect.arrayContaining(['unidades', 'cajas', 'kg', 'sacos']))
  })
})

describe('nombres', () => {
  it('usa la misma regla que los proveedores (mayúsculas, espacios y acentos)', () => {
    expect(getProductNameKey('  HARÍNA de\tfuerza ')).toBe('harina de fuerza')
    expect(getProductNameKey('Peña')).not.toBe(getProductNameKey('Pena'))
  })

  it('busca duplicados solo en la lista recibida (la del proveedor) y excluye el propio', () => {
    const list = [product(), product({ id: 'p2', name: 'Levadura', is_active: false })]
    expect(findDuplicateProduct(list, 'harina  de FUERZA')?.id).toBe('p1')
    expect(findDuplicateProduct(list, 'Harina de fuerza', 'p1')).toBeNull()
    expect(findDuplicateProduct(list, 'Harina integral')).toBeNull()
    expect(findDuplicateProduct([], 'Harina de fuerza')).toBeNull()
  })
})

describe('formulario', () => {
  it('normaliza nombre y unidad como el resto del proyecto', () => {
    expect(normalizeProductInput({ name: '  Harina \n de  fuerza ', unit: ' sacos  de 25 kg ', usual_quantity: '2,5' }))
      .toEqual({ name: 'Harina de fuerza', unit: 'sacos de 25 kg', usual_quantity: 2.5 })
    expect(normalizeProductInput({ name: 'Café' }).name).toBe('Café')
  })

  it('prepara el formulario con la cantidad en formato de campo', () => {
    expect(toProductFormValues()).toEqual({ name: '', unit: '', usual_quantity: '' })
    expect(toProductFormValues(product({ usual_quantity: 2.5 }))).toEqual({ name: 'Harina de fuerza', unit: 'sacos', usual_quantity: '2,5' })
    expect(toProductFormValues(product({ usual_quantity: '12.00' })).usual_quantity).toBe('12')
  })

  it('acepta un producto válido', () => {
    expect(validateProductInput(valid())).toEqual([])
    expect(validateProductInput(valid({ usual_quantity: '0,01' }))).toEqual([])
    expect(validateProductInput(valid({ usual_quantity: '99999,99' }))).toEqual([])
  })

  it('exige nombre, cantidad y unidad', () => {
    expect(validateProductInput({ name: ' ', unit: '', usual_quantity: '' }).map(e => e.name)).toEqual(['name', 'usual_quantity', 'unit'])
  })

  it('no permite cantidades inválidas', () => {
    const quantityError = value => validateProductInput(valid({ usual_quantity: value })).find(e => e.name === 'usual_quantity')?.message
    expect(quantityError('0')).toBe('La cantidad debe ser mayor que 0.')
    expect(quantityError('0,00')).toBe('La cantidad debe ser mayor que 0.')
    expect(quantityError('-2')).toMatch(/Escribe un número/)
    expect(quantityError('2,555')).toMatch(/dos decimales/)
    expect(quantityError('abc')).toMatch(/Escribe un número/)
    expect(quantityError('100000')).toBe(`La cantidad máxima es 99.999,99.`)
    expect(MAX_USUAL_QUANTITY).toBe(99999.99)
  })

  it('limita la longitud del nombre y de la unidad', () => {
    expect(validateProductInput(valid({ name: 'n'.repeat(PRODUCT_FIELD_LIMITS.name + 1) })).map(e => e.name)).toEqual(['name'])
    expect(validateProductInput(valid({ unit: 'u'.repeat(PRODUCT_FIELD_LIMITS.unit + 1) })).map(e => e.name)).toEqual(['unit'])
  })

  it('avisa de duplicados en el mismo proveedor y propone reactivar los inactivos', () => {
    const list = [product(), product({ id: 'p2', name: 'Levadura', is_active: false })]
    expect(validateProductInput(valid({ name: 'HARINA DE FUERZA' }), { products: list })).toEqual([
      { name: 'name', message: 'Este proveedor ya tiene «Harina de fuerza».' },
    ])
    expect(validateProductInput(valid({ name: 'levadura' }), { products: list })[0].message)
      .toBe('Este proveedor ya tiene «Levadura», desactivado. Actívalo desde «Inactivos» en lugar de crear otro.')
    expect(validateProductInput(valid({ name: 'Harina de fuerza' }), { products: list, currentId: 'p1' })).toEqual([])
  })

  it('detecta cambios respecto al producto guardado', () => {
    const current = product({ usual_quantity: 2.5 })
    expect(hasProductChanges(current, toProductFormValues(current))).toBe(false)
    expect(hasProductChanges(current, { ...toProductFormValues(current), usual_quantity: '2.50' })).toBe(false)
    expect(hasProductChanges(current, { ...toProductFormValues(current), name: ' Harina de  fuerza ' })).toBe(false)
    expect(hasProductChanges(current, { ...toProductFormValues(current), usual_quantity: '3' })).toBe(true)
    expect(hasProductChanges(current, { ...toProductFormValues(current), unit: 'kg' })).toBe(true)
    expect(hasProductChanges(null, {})).toBe(true)
  })
})

describe('listado', () => {
  const list = [
    product({ id: 'a', name: 'Sal', is_active: false }),
    product({ id: 'b', name: 'Ácido ascórbico' }),
    product({ id: 'c', name: 'harina' }),
  ]

  it('ordena alfabéticamente en español', () => {
    expect(sortProducts(list).map(p => p.name)).toEqual(['Ácido ascórbico', 'harina', 'Sal'])
  })

  it('filtra y cuenta por estado', () => {
    expect(filterProducts(list).map(p => p.id).sort()).toEqual(['b', 'c'])
    expect(filterProducts(list, SUPPLIER_STATUS_FILTER.INACTIVE).map(p => p.id)).toEqual(['a'])
    expect(filterProducts(list, SUPPLIER_STATUS_FILTER.ALL)).toHaveLength(3)
    expect(countProducts(list)).toEqual({ active: 2, inactive: 1, all: 3 })
  })

  it('sustituye o añade manteniendo el orden', () => {
    expect(upsertProduct(list, product({ id: 'a', name: 'Azúcar', is_active: true })).map(p => p.name)).toEqual(['Ácido ascórbico', 'Azúcar', 'harina'])
    expect(upsertProduct(list, product({ id: 'd', name: 'Zumo' }))).toHaveLength(4)
  })
})

describe('errores de la base de datos', () => {
  it('traduce el nombre repetido (409) a un error del campo nombre', () => {
    const feedback = getProductErrorFeedback({
      status: 409,
      error: { code: '23505', message: 'duplicate key value violates unique constraint "supplier_products_name_unique_idx"' },
    })
    expect(feedback.kind).toBe(DB_ERROR_KIND.VALIDATION)
    expect(feedback.message).toMatch(/^Este proveedor ya tiene un producto con este nombre/)
    expect(feedback.fields).toEqual([{ name: 'name', message: feedback.message }])
  })

  it('relaciona cada restricción con su campo', () => {
    const check = c => getProductFieldErrors({ code: '23514', message: `violates check constraint "${c}"` })[0]?.name
    expect(check('supplier_products_name_not_blank')).toBe('name')
    expect(check('supplier_products_unit_not_blank')).toBe('unit')
    expect(check('supplier_products_usual_quantity_range')).toBe('usual_quantity')
    expect(getProductFieldErrors({ code: '23502', message: 'null value in column "unit"' })[0].name).toBe('unit')
  })

  it('da mensajes comprensibles', () => {
    expect(getProductErrorFeedback({ error: { code: '23503' }, status: 409 }).message).toMatch(/No se ha encontrado el proveedor/)
    expect(getProductErrorFeedback({ error: { code: '42501' }, status: 403 }).message).toMatch(/permiso para gestionar productos/)
    expect(getProductErrorFeedback({ error: { code: 'PGRST205' }, status: 404 }, 'load').message).toMatch(/sección 11/)
    expect(getProductErrorFeedback({ error: { code: 'PGRST303' }, status: 401 }).kind).toBe(DB_ERROR_KIND.EXPIRED)
    expect(getProductErrorFeedback({ error: new TypeError('Failed to fetch'), status: 0 }, 'status').message).toMatch(/No se ha podido cambiar el estado/)
  })
})
