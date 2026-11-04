// Respuestas reales de la API de datos abiertos de la Generalitat
// (analisi.transparenciacatalunya.cat), consultadas el 4 de noviembre de 2026.
// Se usan en las pruebas unitarias y de navegador para no depender de la red.

const d = date => `${date}T00:00:00.000`

// yf2b-mjr6, any_calendari = 2026 (36 filas: cada fecha aparece 3 veces).
const LABOUR_2026_DATES = ['2026-01-01', '2026-01-06', '2026-04-03', '2026-04-06', '2026-05-01', '2026-06-24', '2026-08-15', '2026-09-11', '2026-10-12', '2026-12-08', '2026-12-25', '2026-12-26']
export const LABOUR_2026 = LABOUR_2026_DATES.flatMap(date => [
  { any_calendari: '2026', data: d(date), localitzaci: 'Catalunya' },
  { any_calendari: '2026', data: d(date) },
  { any_calendari: '2026', data: d(date), localitzaci: 'C. A. de Catalunya' },
])

// b4eh-r8up, L'Ametlla del Vallès (08005), 2026.
export const LOCAL_AMETLLA_2026 = [
  { any_calendari: '2026', data: d('2026-02-16'), ajuntament_o_nucli_municipal: 'Ametlla del Vallès, l\'', codi_municipal: '08005000', codi_municipi_ine: '08005', pedania: '000', festiu: 'Festiu local', codiidescat: '0800570000000' },
  { any_calendari: '2026', data: d('2026-08-25'), ajuntament_o_nucli_municipal: 'Ametlla del Vallès, l\'', codi_municipal: '08005000', codi_municipi_ine: '08005', pedania: '000', festiu: 'Festiu local', codiidescat: '0800570000000' },
]

// b4eh-r8up, Barcelona (08019), 2026.
export const LOCAL_BARCELONA_2026 = [
  { any_calendari: '2026', data: d('2026-05-25'), ajuntament_o_nucli_municipal: 'Barcelona', codi_municipal: '08019000', codi_municipi_ine: '08019', pedania: '000', festiu: 'Festiu local' },
  { any_calendari: '2026', data: d('2026-09-24'), ajuntament_o_nucli_municipal: 'Barcelona', codi_municipal: '08019000', codi_municipi_ine: '08019', pedania: '000', festiu: 'Festiu local' },
]

// b4eh-r8up, Viladecans (08301), 2025: filas erróneas mezcladas con las buenas
// (9 de junio y 8 de septiembre). En 2026 Viladecans no aparece.
export const LOCAL_VILADECANS_2025 = [
  { ajuntament_o_nucli_municipal: 'C. A. de Catalunya', any_calendari: '2025', codi_municipal: '08301000', codi_municipi_ine: '08301', data: d('2025-01-01'), festiu: 'Any nou', pedania: '000' },
  { ajuntament_o_nucli_municipal: 'C. A. de Catalunya', any_calendari: '2025', codi_municipal: '08301000', codi_municipi_ine: '08301', data: d('2025-01-02'), festiu: 'Festa local', pedania: '000' },
  { ajuntament_o_nucli_municipal: 'C. A. de Catalunya', any_calendari: '2025', codi_municipal: '08301000', codi_municipi_ine: '08301', data: d('2025-09-11'), festiu: 'La Diada', pedania: '000' },
  { ajuntament_o_nucli_municipal: 'C. A. de Catalunya', any_calendari: '2025', codi_municipal: '08301000', codi_municipi_ine: '08301', data: d('2025-04-15'), festiu: 'Festa local', pedania: '000' },
  { ajuntament_o_nucli_municipal: 'C. A. de Catalunya', any_calendari: '2025', codi_municipal: '08301000', codi_municipi_ine: '08301', data: d('2025-04-18'), festiu: 'Festa local', pedania: '000' },
  { ajuntament_o_nucli_municipal: 'null', any_calendari: '2025', codi_municipal: '08301000', codi_municipi_ine: '08301', data: d('2025-04-16'), festiu: 'Festa local', pedania: '000' },
  { ajuntament_o_nucli_municipal: 'null', any_calendari: '2025', codi_municipal: '08301000', codi_municipi_ine: '08301', data: d('2025-06-12'), festiu: 'Festa local', pedania: '000' },
  { ajuntament_o_nucli_municipal: 'null', any_calendari: '2025', codi_municipal: '08301000', codi_municipi_ine: '08301', data: d('2025-01-15'), festiu: 'Festa local', pedania: '000' },
  { ajuntament_o_nucli_municipal: 'Viladecans', any_calendari: '2025', codi_municipal: '08301000', codi_municipi_ine: '08301', codiidescat: '0830150000000', data: d('2025-09-08'), festiu: 'Festiu local', pedania: '000' },
  { ajuntament_o_nucli_municipal: 'Viladecans', any_calendari: '2025', codi_municipal: '08301000', codi_municipi_ine: '08301', codiidescat: '0830150000000', data: d('2025-06-09'), festiu: 'Festiu local', pedania: '000' },
]
