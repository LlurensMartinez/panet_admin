import { describe, expect, it, vi } from 'vitest'
import { copyTextToClipboard } from '../../app/utils/clipboard.js'

// Documento mínimo para el método clásico (textarea + execCommand).
function fakeDocument({ execResult = true, execThrows = false } = {}) {
  const appended = []
  const focused = { focus: vi.fn() }
  const doc = {
    activeElement: focused,
    body: { appendChild: el => appended.push(el) },
    createElement: () => {
      const el = {
        value: '',
        style: {},
        setAttribute: vi.fn(),
        select: vi.fn(),
        remove: vi.fn(() => appended.splice(appended.indexOf(el), 1)),
      }
      return el
    },
    execCommand: vi.fn(() => {
      if (execThrows) throw new Error('no permitido')
      return execResult
    }),
  }
  return { doc, appended, focused }
}

describe('copyTextToClipboard', () => {
  it('usa la API del portapapeles cuando está disponible', async () => {
    const writeText = vi.fn().mockResolvedValue()
    const result = await copyTextToClipboard('Hola', { navigator: { clipboard: { writeText } }, isSecureContext: true })
    expect(result).toEqual({ ok: true, method: 'clipboard' })
    expect(writeText).toHaveBeenCalledWith('Hola')
  })

  it('si el navegador rechaza la API, prueba el método clásico', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('NotAllowedError'))
    const { doc, appended, focused } = fakeDocument()
    const result = await copyTextToClipboard('Texto completo\ncon saltos', { navigator: { clipboard: { writeText } }, document: doc, isSecureContext: true })
    expect(result).toEqual({ ok: true, method: 'execCommand' })
    expect(doc.execCommand).toHaveBeenCalledWith('copy')
    expect(appended).toHaveLength(0) // el textarea temporal se retira
    expect(focused.focus).toHaveBeenCalled() // el foco vuelve a su sitio
  })

  it('sin contexto seguro (http en la red local) usa el método clásico', async () => {
    const writeText = vi.fn()
    const { doc } = fakeDocument()
    const result = await copyTextToClipboard('x', { navigator: { clipboard: { writeText } }, document: doc, isSecureContext: false })
    expect(writeText).not.toHaveBeenCalled()
    expect(result.ok).toBe(true)
  })

  it('si nada funciona, lo indica para pedir copiarlo a mano', async () => {
    const { doc } = fakeDocument({ execResult: false })
    expect(await copyTextToClipboard('x', { navigator: {}, document: doc })).toEqual({ ok: false })
    const failing = fakeDocument({ execThrows: true })
    expect(await copyTextToClipboard('x', { navigator: {}, document: failing.doc })).toEqual({ ok: false })
    expect(failing.appended).toHaveLength(0)
    expect(await copyTextToClipboard('x', {})).toEqual({ ok: false })
  })
})
