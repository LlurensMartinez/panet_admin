import { describe, expect, it } from 'vitest'
import {
  buildLabourCalendarUrl,
  buildLocalHolidaysUrl,
  buildOfficialYear,
  describeLabourHoliday,
  describePlan,
  findMunicipality,
  getEasterSunday,
  getOfficialSyncYears,
  hasPlanChanges,
  isOfficialSyncDue,
  MUNICIPALITY_OPTIONS,
  OFFICIAL_NOTES,
  PANET_MUNICIPALITIES,
  parseLabourRows,
  parseLocalRows,
  planOfficialSync,
  summarizeOfficialYears,
} from '../../app/utils/official-holidays.js'
import { LABOUR_2026, LOCAL_AMETLLA_2026, LOCAL_BARCELONA_2026, LOCAL_VILADECANS_2025 } from '../fixtures/generalitat-holidays.js'

const ametlla2026 = () => buildOfficialYear({ year: 2026, labourRows: LABOUR_2026, localRows: LOCAL_AMETLLA_2026, municipalityName: 'L\'Ametlla del Vallès' })

describe('municipios de las tiendas', () => {
  it('24 municipios catalanes con su código INE, sin Andorra', () => {
    expect(PANET_MUNICIPALITIES).toHaveLength(24)
    expect(PANET_MUNICIPALITIES.every(m => /^\d{5}$/.test(m.code))).toBe(true)
    expect(new Set(PANET_MUNICIPALITIES.map(m => m.code)).size).toBe(24)
    expect(PANET_MUNICIPALITIES.some(m => /andorra/i.test(m.name))).toBe(false)
    expect(findMunicipality('08005').name).toBe('L\'Ametlla del Vallès')
    expect(findMunicipality('99999')).toBeNull()
  })

  it('ordenados por nombre sin contar el artículo', () => {
    const labels = MUNICIPALITY_OPTIONS.map(o => o.label)
    expect(labels[0]).toBe('L\'Ametlla del Vallès')
    expect(labels.indexOf('El Masnou')).toBeGreaterThan(labels.indexOf('Martorell'))
    expect(labels.at(-1)).toBe('Vilanova i la Geltrú')
  })
})

describe('consultas a la API de la Generalitat', () => {
  it('construye las URL de cada dataset', () => {
    expect(buildLabourCalendarUrl(2027)).toBe('https://analisi.transparenciacatalunya.cat/resource/yf2b-mjr6.json?$where=any_calendari%3D\'2027\'&$order=data&$limit=200')
    expect(decodeURIComponent(buildLocalHolidaysUrl('08005', 2026))).toContain('codi_municipi_ine=\'08005\' and any_calendari=\'2026\' and pedania=\'000\'')
    expect(() => buildLocalHolidaysUrl('8005\' or 1=1', 2026)).toThrow()
  })

  it('mantiene el año actual y el siguiente', () => {
    expect(getOfficialSyncYears('2026-11-04')).toEqual([2026, 2027])
    expect(getOfficialSyncYears('2027-01-01')).toEqual([2027, 2028])
  })
})

describe('lectura de los datos oficiales', () => {
  it('calendario laboral: 12 fechas sin repetir (los datos reales traen cada una 3 veces)', () => {
    expect(LABOUR_2026).toHaveLength(36)
    expect(parseLabourRows(LABOUR_2026, 2026)).toHaveLength(12)
    expect(parseLabourRows(LABOUR_2026, 2027)).toEqual([])
    expect(parseLabourRows(null, 2026)).toEqual([])
  })

  it('festivos locales: descarta las filas erróneas de los datos de 2025', () => {
    expect(parseLocalRows(LOCAL_VILADECANS_2025, 2025)).toEqual(['2025-06-09', '2025-09-08'])
    expect(parseLocalRows(LOCAL_AMETLLA_2026, 2026)).toEqual(['2026-02-16', '2026-08-25'])
    expect(parseLocalRows([], 2026)).toEqual([])
  })

  it('Pascua y nombres de los festivos', () => {
    expect(getEasterSunday(2026)).toBe('2026-04-05')
    expect(getEasterSunday(2027)).toBe('2027-03-28')
    expect(getEasterSunday(2025)).toBe('2025-04-20')
    expect(describeLabourHoliday('2026-04-03')).toEqual({ name: 'Viernes Santo', scope: 'national' })
    expect(describeLabourHoliday('2026-04-06')).toEqual({ name: 'Lunes de Pascua', scope: 'regional' })
    expect(describeLabourHoliday('2026-09-11')).toEqual({ name: 'Diada Nacional de Cataluña', scope: 'regional' })
    expect(describeLabourHoliday('2026-12-26')).toEqual({ name: 'San Esteban', scope: 'regional' })
    expect(describeLabourHoliday('2026-01-06')).toEqual({ name: 'Epifanía del Señor', scope: 'national' })
    expect(describeLabourHoliday('2026-07-27')).toEqual({ name: 'Festivo oficial de Cataluña', scope: 'regional' })
  })
})

describe('festivos oficiales de un año', () => {
  it('L\'Ametlla del Vallès 2026: 12 de Cataluña + 2 locales', () => {
    const result = ametlla2026()
    expect(result).toMatchObject({ year: 2026, published: true, localPublished: true, localInconsistent: false })
    expect(result.holidays).toHaveLength(14)
    expect(result.holidays.filter(h => h.scope === 'national')).toHaveLength(8)
    expect(result.holidays.filter(h => h.scope === 'regional')).toHaveLength(4)
    expect(result.holidays.filter(h => h.scope === 'local').map(h => [h.holiday_date, h.name])).toEqual([
      ['2026-02-16', 'Fiesta local de L\'Ametlla del Vallès'],
      ['2026-08-25', 'Fiesta local de L\'Ametlla del Vallès'],
    ])
    expect(result.holidays.every(h => h.notes === OFFICIAL_NOTES)).toBe(true)
    expect(result.holidays.map(h => h.holiday_date)).toEqual([...result.holidays.map(h => h.holiday_date)].sort())
  })

  it('municipio sin festivos locales publicados (Viladecans 2026)', () => {
    const result = buildOfficialYear({ year: 2026, labourRows: LABOUR_2026, localRows: [], municipalityName: 'Viladecans' })
    expect(result).toMatchObject({ published: true, localPublished: false })
    expect(result.holidays).toHaveLength(12)
  })

  it('año sin publicar (2027)', () => {
    const result = buildOfficialYear({ year: 2027, labourRows: [], localRows: [], municipalityName: 'Barcelona' })
    expect(result).toMatchObject({ published: false, localPublished: false, holidays: [] })
  })

  it('más de dos fiestas locales: datos incoherentes, no se importan las locales', () => {
    const rows = [...LOCAL_BARCELONA_2026, { ...LOCAL_BARCELONA_2026[0], data: '2026-10-01T00:00:00.000' }]
    const result = buildOfficialYear({ year: 2026, labourRows: LABOUR_2026, localRows: rows, municipalityName: 'Barcelona' })
    expect(result).toMatchObject({ localInconsistent: true, localPublished: false })
    expect(result.holidays.filter(h => h.scope === 'local')).toEqual([])
  })
})

describe('plan de sincronización', () => {
  const official = (over = {}) => ({ id: 'o', holiday_date: '2026-02-16', name: 'Fiesta local de L\'Ametlla del Vallès', scope: 'local', notes: OFFICIAL_NOTES, source: 'official', ...over })

  it('primera vez: añade los 14 festivos de 2026; 2027 sin publicar no se toca', () => {
    const plan = planOfficialSync({ existing: [], years: [ametlla2026(), buildOfficialYear({ year: 2027, labourRows: [], localRows: [], municipalityName: 'x' })] })
    expect(plan.inserts).toHaveLength(14)
    expect(plan.inserts.every(h => h.source === 'official')).toBe(true)
    expect(plan).toMatchObject({ updates: [], deletes: [], keptManual: 0 })
    expect(describePlan(plan)).toBe('14 festivos añadidos')
  })

  it('volver a sincronizar no cambia nada', () => {
    const existing = ametlla2026().holidays.map((h, i) => ({ ...h, id: `h${i}`, source: 'official' }))
    const plan = planOfficialSync({ existing, years: [ametlla2026()] })
    expect(hasPlanChanges(plan)).toBe(false)
    expect(describePlan(plan)).toBe('Sin cambios')
  })

  it('respeta los festivos manuales, también en una fecha oficial', () => {
    const existing = [
      { id: 'm1', holiday_date: '2026-08-25', name: 'Festa Major', scope: 'local', notes: null, source: 'manual' },
      { id: 'm2', holiday_date: '2026-03-19', name: 'Cierre por obras', scope: 'local', notes: null, source: 'manual' },
    ]
    const plan = planOfficialSync({ existing, years: [ametlla2026()] })
    expect(plan.inserts.map(h => h.holiday_date)).not.toContain('2026-08-25')
    expect(plan.inserts).toHaveLength(13)
    expect(plan.deletes).toEqual([])
    expect(plan.keptManual).toBe(1)
  })

  it('cambiar de municipio: retira los locales del anterior y añade los nuevos', () => {
    const existing = ametlla2026().holidays.map((h, i) => ({ ...h, id: `h${i}`, source: 'official' }))
    const barcelona = buildOfficialYear({ year: 2026, labourRows: LABOUR_2026, localRows: LOCAL_BARCELONA_2026, municipalityName: 'Barcelona' })
    const plan = planOfficialSync({ existing, years: [barcelona] })
    expect(plan.deletes).toHaveLength(2)
    expect(plan.inserts.map(h => [h.holiday_date, h.name])).toEqual([['2026-05-25', 'Fiesta local de Barcelona'], ['2026-09-24', 'Fiesta local de Barcelona']])
    expect(plan.updates).toEqual([])
    expect(describePlan(plan)).toBe('2 festivos añadidos y 2 retirados')
  })

  it('actualiza un oficial cuyo nombre o ámbito ya no coincide', () => {
    const plan = planOfficialSync({ existing: [official({ name: 'Fiesta local de Barcelona' })], years: [ametlla2026()] })
    expect(plan.updates).toEqual([{ id: 'o', name: 'Fiesta local de L\'Ametlla del Vallès', scope: 'local', notes: OFFICIAL_NOTES }])
  })

  it('no toca otros años', () => {
    const plan = planOfficialSync({ existing: [official({ id: 'old', holiday_date: '2025-02-16' })], years: [ametlla2026()] })
    expect(plan.deletes).toEqual([])
  })
})

describe('frecuencia y resumen', () => {
  it('como mucho una vez al día', () => {
    const now = new Date('2026-11-04T13:00:00Z')
    expect(isOfficialSyncDue(null, now)).toBe(true)
    expect(isOfficialSyncDue('2026-11-04T08:00:00Z', now)).toBe(false)
    expect(isOfficialSyncDue('2026-11-03T13:00:00Z', now)).toBe(true)
    expect(isOfficialSyncDue('no es fecha', now)).toBe(true)
  })

  it('resumen por año a partir de los festivos guardados', () => {
    const holidays = [
      ...ametlla2026().holidays.map((h, i) => ({ ...h, id: `h${i}`, source: 'official' })),
      { id: 'm', holiday_date: '2026-03-19', name: 'X', scope: 'local', source: 'manual' },
    ]
    expect(summarizeOfficialYears(holidays, [2026, 2027])).toEqual([
      { year: 2026, official: 14, local: 2, total: 15 },
      { year: 2027, official: 0, local: 0, total: 0 },
    ])
  })
})
