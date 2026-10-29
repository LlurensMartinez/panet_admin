// Lógica pura de los productos habituales de cada proveedor (sin
// dependencias de Nuxt ni de Supabase) para poder probarla con pruebas
// unitarias: cantidades, validación, nombres repetidos, filtros, orden y
// mensajes de error.
//
// La cantidad habitual es solo una referencia para preparar pedidos. La
// validación de la interfaz es una ayuda: la base de datos tiene sus propias
// restricciones (migración 20261029214500) y la RLS protege los datos.

import { DB_ERROR_KIND, classifyDatabaseError } from './database-errors.js'
import { getSupplierNameKey, SUPPLIER_STATUS_FILTER } from './suppliers.js'

// Columnas reales de public.supplier_products.
export const PRODUCT_COLUMNS = 'id, supplier_id, name, unit, usual_quantity, is_active, created_at, updated_at'

export const PRODUCT_FIELD_LIMITS = Object.freeze({
  name: 80,
  unit: 20,
})

// Mismo rango que la restricción supplier_products_usual_quantity_range.
export const MAX_USUAL_QUANTITY = 99999.99

// Sugerencias para la unidad (se puede escribir cualquier otra).
export const COMMON_UNITS = Object.freeze(['unidades', 'cajas', 'kg', 'sacos', 'paquetes', 'bandejas', 'litros'])

const REQUIRED_MESSAGES = {
  name: 'Escribe el nombre del producto.',
  unit: 'Escribe la unidad (por ejemplo: cajas, kg, sacos).',
  usual_quantity: 'Escribe la cantidad habitual.',
}

const DUPLICATE_MESSAGE = 'Este proveedor ya tiene un producto con este nombre (puede estar entre los inactivos).'

// Restricciones de la migración → campo del formulario y mensaje.
const CONSTRAINT_ERRORS = {
  supplier_products_name_unique_idx: { name: 'name', message: DUPLICATE_MESSAGE },
  supplier_products_name_not_blank: { name: 'name', message: 'El nombre no puede estar vacío ni contener solo espacios.' },
  supplier_products_unit_not_blank: { name: 'unit', message: 'La unidad no puede estar vacía ni contener solo espacios.' },
  supplier_products_usual_quantity_range: { name: 'usual_quantity', message: 'La cantidad debe ser mayor que 0 y como máximo 99.999,99.' },
}

const collator = new Intl.Collator('es', { sensitivity: 'base', numeric: true })
const quantityFormatter = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 })

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** true si es un UUID (identificador de proveedor de la URL). */
export function isUuid(value) {
  return UUID_PATTERN.test(String(value ?? ''))
}

// ------------------------------------------------------------- Cantidades

/**
 * Cantidad escrita en el formulario → número, o NaN si no es válida.
 * Admite coma o punto decimal y como máximo dos decimales: «2,5», «2.5»,
 * «12». No admite separadores de miles («1.000» sería ambiguo).
 */
export function parseQuantity(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : Number.NaN
  const text = String(value ?? '').trim()
  if (!/^\d+([.,]\d{1,2})?$/.test(text)) return Number.NaN
  return Number(text.replace(',', '.'))
}

/** «2,5», «12», «99.999,99». */
export function formatQuantity(value) {
  const number = Number(value)
  return Number.isFinite(number) ? quantityFormatter.format(number) : ''
}

/** «2,5 kg». */
export function formatProductQuantity(product) {
  return [formatQuantity(product?.usual_quantity), product?.unit].filter(Boolean).join(' ')
}

/** Texto de la cantidad para el campo del formulario (coma decimal, sin miles). */
function quantityToInput(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return ''
  return String(Math.round(number * 100) / 100).replace('.', ',')
}

// ---------------------------------------------------------------- Nombres

/** Misma regla que el índice supplier_products_name_unique_idx (y que los proveedores). */
export function getProductNameKey(name) {
  return getSupplierNameKey(name)
}

/** Otro producto del mismo proveedor (activo o no) con el mismo nombre, o null. */
export function findDuplicateProduct(products, name, excludeId = null) {
  const key = getProductNameKey(name)
  if (!key) return null
  return (products ?? []).find(product =>
    product.id !== excludeId && getProductNameKey(product.name) === key,
  ) ?? null
}

// ------------------------------------------------------------- Formulario

/** Una sola línea, sin espacios repetidos, en forma Unicode NFC. */
function cleanText(value) {
  return String(value ?? '').normalize('NFC').replace(/\s+/g, ' ').trim()
}

export function normalizeProductInput(values = {}) {
  return {
    name: cleanText(values.name),
    unit: cleanText(values.unit),
    usual_quantity: parseQuantity(values.usual_quantity),
  }
}

export function toProductFormValues(product = null) {
  return {
    name: product?.name ?? '',
    unit: product?.unit ?? '',
    usual_quantity: product ? quantityToInput(product.usual_quantity) : '',
  }
}

/**
 * Errores de validación con el formato de UForm: [{ name, message }].
 * `products` son los productos cargados de ESTE proveedor (para avisar de
 * nombres repetidos); `currentId` es el producto que se edita.
 */
export function validateProductInput(values = {}, { products = [], currentId = null } = {}) {
  const data = normalizeProductInput(values)
  const errors = []

  if (!data.name) {
    errors.push({ name: 'name', message: REQUIRED_MESSAGES.name })
  }
  else if (Array.from(data.name).length > PRODUCT_FIELD_LIMITS.name) {
    errors.push({ name: 'name', message: `Máximo ${PRODUCT_FIELD_LIMITS.name} caracteres.` })
  }
  else {
    const duplicate = findDuplicateProduct(products, data.name, currentId)
    if (duplicate) {
      errors.push({
        name: 'name',
        message: duplicate.is_active
          ? `Este proveedor ya tiene «${duplicate.name}».`
          : `Este proveedor ya tiene «${duplicate.name}», desactivado. Actívalo desde «Inactivos» en lugar de crear otro.`,
      })
    }
  }

  const rawQuantity = String(values.usual_quantity ?? '').trim()
  const quantity = data.usual_quantity
  if (rawQuantity === '') {
    errors.push({ name: 'usual_quantity', message: REQUIRED_MESSAGES.usual_quantity })
  }
  else if (Number.isNaN(quantity)) {
    errors.push({ name: 'usual_quantity', message: 'Escribe un número, con dos decimales como máximo (por ejemplo: 2,5).' })
  }
  else if (quantity <= 0) {
    errors.push({ name: 'usual_quantity', message: 'La cantidad debe ser mayor que 0.' })
  }
  else if (quantity > MAX_USUAL_QUANTITY) {
    errors.push({ name: 'usual_quantity', message: 'La cantidad máxima es 99.999,99.' })
  }

  if (!data.unit) {
    errors.push({ name: 'unit', message: REQUIRED_MESSAGES.unit })
  }
  else if (Array.from(data.unit).length > PRODUCT_FIELD_LIMITS.unit) {
    errors.push({ name: 'unit', message: `Máximo ${PRODUCT_FIELD_LIMITS.unit} caracteres.` })
  }

  return errors
}

/** true si los datos normalizados difieren del producto guardado. */
export function hasProductChanges(product, values) {
  if (!product) return true
  const data = normalizeProductInput(values)
  return product.name !== data.name
    || product.unit !== data.unit
    || Number(product.usual_quantity) !== data.usual_quantity
}

// ---------------------------------------------------------------- Listado

export function matchesProductStatus(product, status) {
  if (status === SUPPLIER_STATUS_FILTER.ACTIVE) return product.is_active === true
  if (status === SUPPLIER_STATUS_FILTER.INACTIVE) return product.is_active === false
  return true
}

export function filterProducts(products, status = SUPPLIER_STATUS_FILTER.ACTIVE) {
  return (products ?? []).filter(product => matchesProductStatus(product, status))
}

export function countProducts(products) {
  const list = products ?? []
  const active = list.filter(p => p.is_active === true).length
  return { active, inactive: list.length - active, all: list.length }
}

/** Orden alfabético en español (ignora tildes y mayúsculas). */
export function sortProducts(products) {
  return [...(products ?? [])].sort((a, b) =>
    collator.compare(a.name ?? '', b.name ?? '')
    || String(a.id).localeCompare(String(b.id)),
  )
}

/** Sustituye (o añade) un producto y devuelve la lista ordenada. */
export function upsertProduct(products, product) {
  const others = (products ?? []).filter(p => p.id !== product.id)
  return sortProducts([...others, product])
}

// ---------------------------------------------------------------- Errores

/**
 * Errores de campo a partir de un error de restricción de la base de datos.
 * @returns {{ name: string, message: string }[]}
 */
export function getProductFieldErrors(error) {
  const message = String(error?.message ?? '')

  if (['23514', '23505'].includes(error?.code)) {
    const constraint = Object.keys(CONSTRAINT_ERRORS).find(name => message.includes(name))
    if (constraint) return [{ ...CONSTRAINT_ERRORS[constraint] }]
  }

  if (error?.code === '23502') {
    const field = Object.keys(REQUIRED_MESSAGES).find(name => message.includes(`"${name}"`))
    if (field) return [{ name: field, message: REQUIRED_MESSAGES[field] }]
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
  [DB_ERROR_KIND.PERMISSION]: 'Esta cuenta no tiene permiso para gestionar productos.',
  [DB_ERROR_KIND.MISSING]: 'La base de datos aún no está preparada para gestionar productos: falta aplicar su migración (SUPABASE_SETUP.md, sección 11).',
  [DB_ERROR_KIND.NOT_FOUND]: 'No se ha encontrado este producto. Recarga la lista para ver los datos actuales.',
  [DB_ERROR_KIND.VALIDATION]: 'Revisa los datos del producto.',
}

/**
 * Mensaje para la persona usuaria (nunca el mensaje técnico original) y, si
 * se puede, los errores de cada campo.
 *
 * @param {{ error?: any, status?: number }} response
 * @param {'load' | 'save' | 'status'} action
 */
export function getProductErrorFeedback(response, action = 'save') {
  const kind = classifyDatabaseError(response) ?? DB_ERROR_KIND.UNKNOWN
  const fields = kind === DB_ERROR_KIND.VALIDATION ? getProductFieldErrors(response?.error) : []
  const duplicate = fields.some(field => field.message === DUPLICATE_MESSAGE)
  let message
  if (duplicate) message = DUPLICATE_MESSAGE
  // El proveedor ya no existe (clave foránea).
  else if (response?.error?.code === '23503') message = 'No se ha encontrado el proveedor de este producto. Vuelve a la lista de proveedores.'
  else {
    message = COMMON_MESSAGES[kind]
      ?? MESSAGES[action]?.[kind]
      ?? MESSAGES[action]?.[DB_ERROR_KIND.UNKNOWN]
      ?? MESSAGES.save[DB_ERROR_KIND.UNKNOWN]
  }

  return { kind, message, fields }
}
