import { describe, expect, it } from 'vitest'
import { getSafeRedirect } from '../../app/utils/safe-redirect.js'

describe('getSafeRedirect', () => {
  it('acepta rutas internas', () => {
    expect(getSafeRedirect('/')).toBe('/')
    expect(getSafeRedirect('/pedidos?dia=hoy')).toBe('/pedidos?dia=hoy')
    expect(getSafeRedirect(['/horas-extra'])).toBe('/horas-extra')
  })

  it('rechaza destinos externos o peligrosos', () => {
    expect(getSafeRedirect('//evil.example')).toBe('/')
    expect(getSafeRedirect('/\\evil.example')).toBe('/')
    expect(getSafeRedirect('https://evil.example')).toBe('/')
    expect(getSafeRedirect('javascript:alert(1)')).toBe('/')
  })

  it('evita volver a /login (no hay bucles tras iniciar sesión)', () => {
    expect(getSafeRedirect('/login')).toBe('/')
    expect(getSafeRedirect('/login?reason=expired')).toBe('/')
  })

  it('valores ausentes o no válidos', () => {
    expect(getSafeRedirect(undefined)).toBe('/')
    expect(getSafeRedirect(null)).toBe('/')
    expect(getSafeRedirect(42)).toBe('/')
  })
})
