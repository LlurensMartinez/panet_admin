# Plan de implementación — Gestión de tienda MVP

## Principios de trabajo

- Implementar en tareas pequeñas y verificables.
- No desarrollar todos los módulos en una única petición a Claude Code.
- Leer y respetar `SPEC.md`, `DATA_MODEL.md` y `CLAUDE.md`.
- Ejecutar lint, typecheck si está configurado y pruebas pertinentes después de cada fase.
- No aplicar cambios destructivos a la base de datos sin revisar las migraciones.
- Mantener el proyecto en JavaScript salvo que se acuerde expresamente usar TypeScript.

## Fase 0 — Preparación
- Crear repositorio Git.
- Crear aplicación Nuxt 4 con JavaScript.
- Configurar Nuxt UI y Tailwind CSS según las versiones compatibles.
- Añadir variables de entorno de ejemplo sin secretos.
- Configurar formato/lint y estructura de carpetas.
- Añadir estos documentos al repositorio.

**Aceptación:** la aplicación arranca localmente y el repositorio contiene instrucciones y configuración básica.

## Fase 1 — Supabase y acceso privado
- Configurar proyecto Supabase. *(Hecho: proyecto creado y variables configuradas en local.)*
- Crear la tabla `profiles`. *(Hecho: `supabase/migrations/20261028095000_profiles_authorization.sql`, aplicada en el proyecto remoto y con la cuenta de la encargada autorizada. Es la lista de cuentas autorizadas: opción A de `DATA_MODEL.md`.)*
- Implementar inicio/cierre de sesión. *(Hecho.)*
- Configurar protección de rutas. *(Hecho en el frontend: exige sesión y que la cuenta esté en `profiles`; si no, `/acceso-denegado`. No sustituye a RLS.)*
- Añadir políticas RLS y probar acceso no autorizado. *(Hecho: RLS de `profiles` y función `private.is_authorized()` aplicadas. `supabase/tests/authorization_checks.sql` ejecutado en el proyecto remoto: 31 filas correctas (30 `OK` + 1 `INFO`). Probado en la app: la cuenta autorizada entra y una segunda cuenta no autorizada queda bloqueada.)*

**Aceptación:** la encargada puede acceder y las rutas/datos privados están protegidos. Para darla por cumplida:
- la migración está aplicada *(hecho)*;
- la cuenta de la encargada está en `profiles` *(hecho)*;
- `authorization_checks.sql` devuelve todo `OK` en el proyecto real *(hecho)*;
- las pruebas por API de `SUPABASE_SETUP.md`, sección 7.2 (sin sesión y con una segunda cuenta no autorizada), dan el resultado esperado *(pendiente de confirmar)*.

**Estado:** completada, salvo la confirmación de las pruebas por API de la sección 7.2.

**Regla para las fases 2 a 5:** cada migración que cree una tabla de negocio debe incluir, en el mismo archivo, RLS y políticas basadas en `private.is_authorized()` (plantilla en `DATA_MODEL.md`). Además, cada migración tiene su propio script de comprobaciones en `supabase/tests/` (por ejemplo, `staff_rls_checks.sql`); `authorization_checks.sql` no se amplía.

## Fase 2 — Personal y horas extra
- Crear migraciones para `employees` y `overtime_entries`, con RLS y políticas basadas en `private.is_authorized()`. *(Hecho: `supabase/migrations/20261028125000_employees_overtime.sql`, aplicada en el proyecto remoto según confirmación del usuario. Comprobaciones en `supabase/tests/staff_rls_checks.sql` (`SUPABASE_SETUP.md`, sección 9.4); **pendiente de confirmar** que se han ejecutado en el proyecto remoto con 66 `OK`.)*
- Crear listado y formulario de trabajadoras. *(Implementado en `/empleados`: listado con búsqueda y filtro por estado, alta, edición y activación/desactivación, sin borrado. Verificado con pruebas unitarias, con pruebas de extremo a extremo en local y, según confirmación del usuario, contra el proyecto de Supabase real.)*
- Crear formulario móvil para registrar horas extra. *(Implementado en `/horas-extra`: empleado activo, fecha (hoy por defecto, en `Europe/Madrid`), duración en horas y minutos enteros convertida a `duration_minutes` (1 a 1440), motivo y observaciones opcionales. Verificado con pruebas unitarias y de extremo a extremo en local. **Pendiente:** prueba manual contra el proyecto de Supabase real.)*
- Crear historial individual y general. *(Implementado el historial general con filtros por empleado y por periodo, y el total de los registros visibles. El historial individual se consulta filtrando por empleado. **Pendiente:** prueba manual contra Supabase real.)*
- Calcular totales semanales (lunes-domingo) y mensuales. *(Hecho en local. Pestaña «Resumen por empleado» de `/horas-extra`: vista semanal (lunes a domingo) o mensual (mes natural), navegación al periodo anterior y siguiente, una fila por empleado con su total exacto en minutos (incluidos los inactivos con registros, marcados) y total general. El resumen tiene su propio periodo y no depende de los filtros del listado; «Ver registros» lleva al listado con ese empleado y las fechas de ese periodo en «Desde» y «Hasta». La pestaña «Registros» se filtra solo por empleado y por «Desde»/«Hasta» (una fecha sola deja el intervalo abierto por el otro extremo); los periodos rápidos se retiraron al existir el resumen. Verificado con pruebas unitarias y de extremo a extremo en local. **Pendiente:** prueba manual contra Supabase real.)*
- Generar texto compartible para la responsable de zona. *(Hecho en local. En «Resumen por empleado», «Preparar resumen para compartir» genera un mensaje con el periodo consultado (semana de lunes a domingo con sus fechas, o mes y año), una línea por empleado con horas extra en ese periodo (los inactivos marcados «(inactivo)», los que no tienen registros excluidos) y el total, calculado con los mismos minutos que el resumen. El texto se puede editar antes de copiarlo con «Copiar mensaje»; se regenera al cambiar de periodo o de totales, avisando si se descartan cambios. Si el navegador no permite copiar, se selecciona el texto y se explica cómo copiarlo a mano. Sin periodo con registros no se genera mensaje. No se envía nada automáticamente. Verificado con pruebas unitarias y de extremo a extremo en local. **Pendiente:** prueba manual contra Supabase real y del copiado en el móvil de la encargada.)*
- Permitir editar registros. *(Implementado: edición y eliminación con confirmación de registros de horas extra. Eliminar solo borra el registro, nunca la ficha del empleado. **Pendiente:** prueba manual contra Supabase real.)*
- Mantener historial de trabajadoras desactivadas. *(Hecho en local: desactivar solo cambia `is_active`; sus registros de horas extra siguen visibles, marcados como «inactivo», y se pueden corregir sin cambiar de persona. **Pendiente:** comprobarlo contra Supabase real.)*

**Aceptación:** los totales coinciden con pruebas manuales y la duración se guarda en minutos enteros.

## Fase 3 — Proveedores, pedidos y festivos
Sustituye a las antiguas fases 3 (proveedores y catálogo) y 4 (pedidos e historial) e incluye los festivos, que estaban en la Fase 5. Sin líneas de pedido: el contenido de cada pedido se anota en sus notas (ver `SPEC.md`, 3.4). Los productos habituales por proveedor se añadieron después, en el Bloque 4. Se implementa por bloques; no se pasa al siguiente si falla alguna prueba del anterior.

**Bloque 1 — Base de datos**
- Crear `suppliers`, `orders` y `holidays`, con RLS y políticas basadas en `private.is_authorized()`. *(Hecho en local: `supabase/migrations/20261028221500_suppliers_orders_holidays.sql`, con comprobaciones en `supabase/tests/orders_rls_checks.sql` (117 filas: 116 `OK` + 1 `INFO`) y guía en `SUPABASE_SETUP.md`, sección 10. Validado en un PostgreSQL 16 local que imita Supabase y a través de PostgREST 13 en local. **Aplicada en el proyecto de Supabase real**, con las comprobaciones correctas según confirmación de la usuaria.)*

**Bloque 2 — Proveedores y festivos** *(hecho en local)*
- Subpáginas `/pedidos/proveedores` y `/pedidos/festivos`, y entrada «Pedidos» en la navegación. *(Hecho. La primera sección se llama «Pedidos» y contiene la agenda y el historial del Bloque 3.)*
- Altas, edición y desactivación de proveedores: nombre, días de entrega, antelación (0 a 7 días) y notas; aviso de nombre duplicado (sin distinguir mayúsculas, acentos ni espacios, igual que la base de datos). *(Hecho: búsqueda, filtro por estado, resumen del calendario de entrega y preparación en el formulario, reactivación desde «Inactivos». Sin borrado.)*
- Altas, edición y eliminación de festivos con ámbito nacional, autonómico o local. *(Hecho: vista por años agrupada por meses, aviso de fecha repetida, confirmación al eliminar.)*
- Verificado con pruebas unitarias y de extremo a extremo en local (PostgREST 13 + PostgreSQL 16 con la migración real). **Pendiente:** probar las pantallas contra el proyecto de Supabase real.

**Bloque 3 — Agenda, historial y avisos** *(hecho en local)*
- Agenda calculada (atrasados de los últimos 7 días, hoy y próximos 14 días), sin crear filas al abrir la app. *(Hecho: `/pedidos`, vista «Agenda». Atrasados = pendientes con preparación en los 7 días anteriores; hoy siempre visible; después, un grupo por fecha de preparación hasta hoy + 14. Las previsiones se calculan en el navegador (`buildAgenda`, `app/utils/orders.js`); una previsión se oculta si ya hay un pedido del proveedor con esa fecha como entrega prevista de origen o como entrega. Si la página sigue abierta al cambiar de día, la agenda se recalcula sin escribir nada.)*
- Guardar un pedido solo al actuar sobre él; gestionar los conflictos de duplicado (409) recargando y avisando. *(Hecho: INSERT sin upsert; si la previsión ya se guardó en otro dispositivo, aviso y recarga de la agenda; si la entrega ya está ocupada, error en el campo de fecha.)*
- Estados pendiente, preparado y «no se pide»; corregir fechas y notas; eliminar solo pedidos pendientes; pedidos manuales. *(Hecho: «Marcar preparado» como acción principal, «No se pide», «Volver a pendiente», «Deshacer» en el aviso, edición de fechas y notas sin cambiar la configuración del proveedor, «Nuevo pedido» para proveedores activos con la preparación propuesta según su antelación, y «Eliminar» solo en pendientes guardados.)*
- Avisos de festivo en la fecha de entrega que recomiendan confirmarla, sin mover ni cancelar pedidos. *(Hecho: en la agenda, el historial y el formulario; solo en pedidos no descartados con entrega desde hoy. Botón «Cambiar fechas» en el aviso.)*
- Historial por proveedor y fechas. *(Hecho: vista «Historial» (`?vista=historial`), filtros por proveedor, incluidos los inactivos, y por fecha de entrega; páginas de 20 en el servidor con el total exacto.)*
- Verificado con pruebas unitarias y de extremo a extremo en local (PostgREST 13 + PostgreSQL 16 con la migración real). **Pendiente:** prueba manual contra el proyecto de Supabase real, en el móvil y en el ordenador.

**Aceptación:** la agenda muestra los pedidos que toca preparar según el calendario de cada proveedor sin duplicarlos al recargar o cambiar de día; los estados y las fechas corregidas se conservan; los proveedores desactivados conservan su historial; los avisos de festivos no afirman que el proveedor no vaya a entregar.

**Bloque 4 — Productos habituales por proveedor** *(hecho en local; migración pendiente de aplicar)*
Decisión revisada: el catálogo, que había quedado fuera del MVP, se incorpora como productos habituales de cada proveedor (`SPEC.md`, 3.3).
- Tabla `supplier_products` con RLS y políticas basadas en `private.is_authorized()`. *(Preparada: `supabase/migrations/20261029214500_supplier_products.sql`, con comprobaciones en `supabase/tests/supplier_products_rls_checks.sql` (57 filas: 56 `OK` + 1 `INFO`) y guía en `SUPABASE_SETUP.md`, sección 11. Validada en un PostgreSQL 16 local. **Pendiente:** aplicarla y ejecutar las comprobaciones en el proyecto de Supabase real.)*
- Ficha de cada proveedor (`/pedidos/proveedores/<id>`, se llega pulsando su nombre en la lista o desde «Productos» en el menú del móvil) con sus productos: alta, edición y desactivación/activación con el mismo diseño que Proveedores y Empleados. Sin borrado. *(Hecho en local, con pruebas unitarias y de extremo a extremo.)*
- La agenda, los pedidos y el historial no cambian. *(Comprobado con sus pruebas de regresión.)*

**Bloque 5 — Resumen de pedidos en Inicio** *(hecho en local)*
- Inicio (`/`) muestra los pedidos pendientes que toca preparar hoy y mañana (los atrasados, aparte: aviso con su número y sección que se muestra con «Mostrar pedidos atrasados»), agrupados por proveedor, con sus productos habituales activos, la cantidad habitual y la unidad (`SPEC.md`, 3.1). *(Hecho: `app/utils/home.js` (`buildHomeSummary`, que parte de `buildAgenda`), `app/composables/useActiveProducts.js` (solo lectura), `app/components/home/` y `app/pages/index.vue`.)*
- Solo lectura: abrir o recargar Inicio no escribe en Supabase. Sin tablas ni migraciones nuevas. *(Comprobado en las pruebas de extremo a extremo: 0 escrituras y la base de datos sin cambios.)*
- Estados de carga, error con «Reintentar» (pedidos o proveedores), avisos parciales (productos o festivos) y vacíos. Diseño para móvil (320 px en adelante), tableta y ordenador.
- Verificado con pruebas unitarias y de extremo a extremo en local (PostgREST 13 + PostgreSQL 16 con las migraciones reales). **Pendiente:** probarlo contra el proyecto de Supabase real; requiere la migración de productos del Bloque 4 (sin ella, Inicio muestra los pedidos con un aviso de que faltan los productos).

- Recordatorios en Inicio para los proveedores a demanda (`app/utils/reminders.js`, `HomeOnDemandReminders`), ocultables hasta el día siguiente con almacenamiento local. Sin cambios en la agenda ni en Supabase. *(Hecho en local, con pruebas unitarias y de extremo a extremo.)*

**Bloque 6 — Calendario de proveedores y carga de la hoja** *(hecho en local; migración pendiente de aplicar)*
A partir de la hoja «Proveïdors Panet L'Ametlla» (12/06/2026), que tenía casos que la app no cubría.
- Migración `supabase/migrations/20261104130000_supplier_schedule_rules.sql` (solo añade columnas a `suppliers`; no borra ni cambia datos; RLS y permisos sin cambios): antelación distinta según el día, entregas cada 2 semanas, proveedores a demanda y hora límite del pedido. Comprobaciones en `supabase/tests/supplier_schedule_checks.sql` (30 filas `OK`) y guía en `SUPABASE_SETUP.md`, sección 12. *(Validada en un PostgreSQL 16 local, con PostgREST 13. **Pendiente:** aplicarla en el proyecto de Supabase real.)*
- Formulario de proveedor (cómo se pide, antelación por día, frecuencia con fecha de referencia, hora límite), lista de proveedores, agenda, pedido manual (a demanda: pedir hoy y la entrega posible más próxima) e Inicio (hora límite y aviso cuando ha pasado). *(Hecho en local, con pruebas unitarias y de extremo a extremo.)*
- La agenda ya no prevé pedidos anteriores al alta de un proveedor (si no, al cargar la hoja aparecerían como atrasados los pedidos de la semana anterior).
- Script de carga `supabase/seeds/proveedores_hoja_2026-06-12.sql`: borra pedidos (también el historial), productos habituales y proveedores, y crea los 16 de la hoja. **Pendiente:** revisar la fecha de referencia de los quincenales y ejecutarlo en el proyecto real.

**Bloque 7 — Festivos oficiales del municipio de la tienda** *(hecho en local; migración pendiente de aplicar)*
- Migración `supabase/migrations/20261104160000_shop_settings_official_holidays.sql`: tabla `shop_settings` (una fila, RLS) y columna `holidays.source`. No borra ni cambia datos (los festivos existentes quedan como manuales). Comprobaciones en `supabase/tests/shop_settings_checks.sql` (35 filas: 33 `OK` + 2 `INFO`) y guía en `SUPABASE_SETUP.md`, sección 13. **Pendiente:** aplicarla en el proyecto real.
- En Festivos, selector del municipio de la tienda (los 24 municipios con tiendas Panet). La app importa del calendario oficial de la Generalitat los festivos nacionales, de Cataluña y locales del año actual y del siguiente, y los mantiene sola (como mucho una vez al día al abrir Festivos o la agenda; nunca desde Inicio). Ver `SPEC.md`, 3.5.
- Probado en local con respuestas reales de la API guardadas (`tests/fixtures/generalitat-holidays.js`) y con la API real desde el navegador (L'Ametlla del Vallès, Barcelona, Salou y Viladecans). **Pendiente:** probarlo en la app contra el proyecto real.

**Para una fase futura:**
- Proponer los productos habituales al preparar un pedido, con cantidades modificables por pedido (líneas de pedido).

## Fase 4 — (integrada en la Fase 3)
Los pedidos y su historial forman parte de la Fase 3. Se mantiene la numeración del resto de fases.

## Fase 5 — Horarios y ausencias
Alcance ampliado el 5 de noviembre de 2026: horario habitual por versiones, calendario semanal, excepciones, ausencias y baja con fecha. Ver `SPEC.md` (3.6 y 3.9) y `DATA_MODEL.md` (*Horarios del personal*). Cada bloque termina con pruebas unitarias, lint, build, las suites de navegador existentes y una revisión antes de seguir.

**Bloque 1 — Documentación y base de datos** *(hecho)*
- `SPEC.md`, `DATA_MODEL.md` y este plan actualizados con las decisiones.
- Migración `supabase/migrations/20261105100000_employee_schedules.sql`:
  - columna `employees.last_working_date`;
  - tablas `employee_schedules`, `employee_day_overrides` y `employee_absences`, con RLS;
  - triggers de reglas;
  - funciones `public.deactivate_employee` y `public.reactivate_employee`.

  Solo añade objetos.
- Comprobaciones en `supabase/tests/employee_schedules_checks.sql` (147 filas: 145 `OK` + 2 `INFO`). Guía en `SUPABASE_SETUP.md`, sección 14.
- Probado solo en PostgreSQL local. **Pendiente:** aplicarla en el proyecto real.

**Bloque 2 — Lógica pura** (`app/utils/schedules.js`) *(hecho)*
- Horario de una empleada en una fecha, con la prioridad baja → ausencia → cambio del día → horario habitual. Incluye versiones, periodos sin horario y versiones de fin.
- Horas reales de Madrid:
  - un turno nocturno cuenta entero en el día en que empieza;
  - las horas inexistentes de primavera dan error y no suman;
  - las horas repetidas de otoño se toman en su primera aparición.
- Validación de turnos con las mismas reglas que la base de datos.
- Conflictos entre días consecutivos, incluido domingo con lunes y entre semanas.
- Totales por día, semana, empleada y plantilla. Visibilidad de cada empleada en una semana.
- `buildPlannedVsOvertime`, preparada pero sin usar en ninguna pantalla.
- Pruebas: `tests/unit/schedules.test.js` (121 casos), que pasan también con el sistema en UTC, Nueva York y Tokio. En local:
  - la validación de turnos se ha comparado con las funciones SQL en 4000 casos aleatorios, sin diferencias;
  - el horario de cada día, con `private.planned_shifts` en 61 fechas, sin diferencias.

**Bloque 3 — Baja y reactivación con fecha** *(hecho en local)*
- **Desactivar:** el diálogo pide el último día de trabajo (incluido; hoy por defecto, como muy tarde hoy). Antes de confirmar enseña qué planificación posterior a hoy se eliminará (horarios, cambios de un día y ausencias), qué ausencias se acortan y qué se conserva. Las fechas no válidas se explican y no dejan confirmar.
- **Reactivar** a una empleada con horario: pide la fecha de vuelta (por defecto, el lunes que viene) y ofrece copiar su último horario habitual. Si vuelve al día siguiente de una baja hecha hoy, se anula el cierre.
- **Cómo se guarda:**
  - con planificación, con `public.deactivate_employee` y `public.reactivate_employee` (`supabase.rpc`), cada una en una sola transacción;
  - sin planificación, con una sola actualización de `employees`, como antes (estado y fecha de baja); se activan sin diálogo;
  - sin la migración de horarios aplicada, todo funciona exactamente como antes.
- Mensajes propios para los códigos `PS0xx` y para los errores de red, sesión y permisos.
- Horas extra sin cambios: `EMPLOYEE_COLUMNS` no cambia y la pantalla de horas extra no se ha tocado.
- Archivos:
  - `app/utils/employee-leave.js` (lógica pura), con pruebas en `tests/unit/employee-leave.test.js`;
  - `app/composables/useEmployeeLeave.js`;
  - `EmployeeDeactivateModal.vue` (adaptado), `EmployeeLeavePreview.vue` y `EmployeeReactivateModal.vue`;
  - `app/pages/empleados.vue`.
- Probado solo en local (PostgreSQL 16 + PostgREST 13). **Pendiente:** probarlo contra el proyecto real después de aplicar la migración de la sección 14.

**Bloque 4 — Ficha de trabajadora** (`/empleados/[id]`) *(hecho en local; el editor del horario se añadió en el Bloque 8)*
- **Datos de la ficha**, editables con el mismo formulario y las mismas validaciones del listado.
- **Situación:** en activo o de baja, con su último día de trabajo. Si se desactivó antes del módulo, se indica que no consta.
- **Horario habitual:**
  - el vigente hoy, con sus fechas, de lunes a domingo, con el total semanal y el aviso del próximo horario si lo hay;
  - si no tiene, se indica claramente (sin horario o cerrado tras una baja);
  - si está de baja, el último horario aplicable con sus fechas de vigencia, marcado como «No es un horario actual».
- **Historial de versiones:** de la más reciente a la más antigua, cada una marcada como próxima, vigente o anterior.
- **Desactivar y activar** con el mismo flujo del listado. Esa lógica se ha sacado de la página a `useEmployeeStatusFlow`, que comparten las dos pantallas.
- Desde el listado, el nombre de cada empleada enlaza con su ficha, y la ficha tiene un enlace de vuelta a «Empleados». Las empleadas inexistentes o no accesibles se muestran como «Empleado no encontrado».
- Archivos:
  - `app/utils/employee-profile.js`, con pruebas en `tests/unit/employee-profile.test.js`;
  - `app/composables/useEmployeeStatusFlow.js`;
  - `app/pages/empleados/[id].vue`;
  - `EmployeeWeekSchedule.vue` y `EmployeeScheduleHistory.vue`.

  `app/pages/empleados.vue` pasa a `app/pages/empleados/index.vue`.
- **Cambio respecto al plan anterior:** el editor del horario habitual no se hizo en este bloque, a petición de la encargada. Se ha hecho en el Bloque 8 (sin «copiar a los demás días»).

**Bloque 5 — Calendario semanal** (`/horarios`, solo consulta) *(hecho en local)*
- Semana de lunes a domingo con las empleadas que tienen actividad esa semana:
  - las que tienen horario, cambios o ausencias;
  - las que están en activo, desde la semana actual;
  - nunca después de su último día de trabajo.
- Las filas van ordenadas por nombre y cada nombre enlaza con su ficha.
- **Cada día:** turnos y horas reales, o descanso, día libre, ausencia, «Baja» o «Sin horario».
  - Los cambios de un día y las ausencias se distinguen del horario habitual.
  - Los turnos nocturnos se marcan con «+1» y cuentan en el día en que empiezan.
  - Se marcan los conflictos y las horas que no existen por el cambio de hora.
- **Totales:** por empleada, por día y de la tienda en la semana.
- **Navegación:** semana anterior, siguiente y «Esta semana», con la semana en la URL (`?semana=AAAA-MM-DD`).
- **Diseño:** cuadrícula en escritorio (desde 1024 px) y vista diaria con selector de día en móvil y tabletas.
- Festivos marcados solo de forma informativa (`SPEC.md`, 3.9).
- Nueva entrada «Horarios» en la navegación principal (también en la barra inferior del móvil, que pasa a 5 secciones). En tabletas, la cabecera oculta los iconos de la navegación para que quepan las cinco secciones.
- Sin la migración de horarios, la página lo indica.
- Toda la resolución se hace con `buildWeekPlan` (`app/utils/schedules.js`).
  - **Cambio de reglas:** una empleada desactivada sin fecha de baja ya no aparece en semanas futuras.
- Archivos:
  - `app/utils/week-calendar.js` (presentación), con pruebas en `tests/unit/week-calendar.test.js`;
  - `app/composables/useWeekPlan.js`;
  - `app/pages/horarios.vue`;
  - `app/components/schedule/` (`ScheduleWeekNav`, `ScheduleWeekGrid`, `ScheduleDayList` y `ScheduleDayCell`).

**Bloque 6 — Excepciones** (desde `/horarios`) *(hecho en local)*
- Cada día de cada empleada del calendario (cuadrícula y vista diaria) abre un diálogo con dos pestañas.
- **Turnos de este día:**
  - otros turnos (como mucho 3) o «Libre», solo para esa fecha;
  - «Volver al horario habitual» quita el cambio;
  - con una ausencia ese día, se avisa de que la ausencia prevalece y no se editan los turnos.
- **Ausencias** de la empleada: lista, alta, edición y eliminación (con confirmación).
  - Tipos: Vacaciones, Permiso y Otro, con aviso de no escribir datos de salud.
  - Se avisa de los cambios de un día que quedarán sin efecto.
- **Validaciones antes de guardar** (`app/utils/schedule-exceptions.js`, con las funciones de `schedules.js`):
  - máximo de turnos, formato y solapes en el día y con los días vecinos (turnos nocturnos);
  - horas que no existen por el cambio de hora;
  - fechas y solapes de ausencias;
  - periodos laborales: nada con la empleada de baja, después de su último día ni en un periodo de baja anterior.

  La base de datos repite las comprobaciones, y sus errores (`PS003`-`PS006`) se muestran con mensajes propios.
- **Al guardar o eliminar**, el calendario se recarga y los totales se actualizan. Si falla, el diálogo sigue abierto con el aviso y se puede reintentar. Cada operación es una sola sentencia.
- Nunca se escribe en `employee_schedules`: el horario habitual y su historial no cambian. Horas extra sin cambios. Sin migraciones nuevas.
- Archivos:
  - `app/utils/schedule-exceptions.js`, con pruebas en `tests/unit/schedule-exceptions.test.js`;
  - `app/composables/useScheduleExceptions.js`;
  - `ScheduleDayDialog.vue`, `ScheduleDayShiftsForm.vue` y `ScheduleAbsenceManager.vue`;
  - celdas que se pueden pulsar en `ScheduleWeekGrid.vue` y `ScheduleDayList.vue`.

**Bloque 7 — Resumen de horas planificadas** *(hecho en local)*
- Pestaña «Resumen de horas» en `/horarios` (`?vista=resumen`; la navegación de semanas conserva la vista). No duplica la página: sustituye a la cuadrícula.
- Por empleada: horas planificadas, reparto de los días, avisos si hay conflictos o errores y enlace a la ficha. Total de la tienda y «Con planificación N de M».
- «Sin planificación» frente a 0 h planificadas.
- Escritorio: tabla con fila «Total tienda»; móvil: lista sin desplazamiento horizontal.
- Cálculo con `buildWeekPlan` (`schedules.js`), sin duplicar reglas.
- La comparación con horas extra (`buildPlannedVsOvertime`) sigue preparada y sin mostrarse: el resumen no consulta `overtime_entries`.
- «Horario cerrado» en lugar de «Baja» (calendario y resumen) cuando la empleada sigue activa y su último horario está cerrado sin versión posterior (`TERMINATED_REASON` en `schedules.js`). Las empleadas de baja y los periodos de baja anteriores siguen como «Baja».
- Solo lectura. Sin cambios en horas extra, horarios, excepciones ni ausencias. Sin migraciones.
- Archivos:
  - `app/utils/week-summary.js`, con pruebas en `tests/unit/week-summary.test.js`;
  - `app/components/schedule/ScheduleWeekSummary.vue`;
  - `app/pages/horarios.vue` (selector de vista);
  - `app/utils/schedules.js` y `app/utils/week-calendar.js` (horario cerrado).
- Limitación conocida: sin la fecha de vuelta guardada, una reactivación sin copiar el horario no permite separar los días de baja anteriores a la vuelta (se marcan como «Horario cerrado») ni, si después se crea un horario nuevo, los días sin horario posteriores a la vuelta (se marcan como «Baja»).
- Pendiente: repaso final de la documentación de la fase.

**Bloque 8 — Editor del horario habitual** (desde la ficha) *(hecho en local)*
- En `/empleados/[id]`: «Crear horario habitual» (sin horario vigente ni próximo) o «Cambiar horario habitual». Solo con la empleada activa; si está de baja, se indica que hay que activarla. Sin la migración de horarios, la ficha lo sigue indicando y no ofrece el editor.
- **Editor semanal** (diálogo): de lunes a domingo, cada día laborable o de descanso, hasta 3 turnos con inicio y fin, total del día y de la semana. En móvil, los días van apilados; en escritorio, en filas.
- **Guardado:** una versión nueva de `employee_schedules` con los siete días (`[]` en los de descanso), desde la fecha elegida (propuesta: el lunes siguiente). Nunca se modifica ni se borra una versión: la anterior rige hasta el día antes. Una sola sentencia.
- **Validaciones** (`app/utils/schedule-editor.js`, con las funciones de `schedules.js` y los mensajes de turnos de `schedule-exceptions.js`):
  - turnos: máximo, formato, inicio distinto de fin, solapes en el día y turnos nocturnos que pisan el día siguiente (también el domingo con el lunes);
  - fecha: válida, posterior a la última versión y, salvo la primera, desde el lunes de esta semana;
  - el primer día no puede chocar con un turno nocturno del día anterior (horario anterior o cambio de un día);
  - empleada de baja: no se guarda.

  La base de datos repite las comprobaciones, y sus errores (`PS001`-`PS003`, `PS006`, `23505`, `23514`) se muestran con mensajes propios.
- **Avisos que no impiden guardar:** horas que no existen en el próximo cambio al horario de verano y choques con cambios de un día ya guardados. Notas sobre los turnos con más o menos horas reales por los cambios de hora, y si el horario es igual al anterior.
- **Al guardar,** la ficha se recarga (horario, próximo horario e historial). El calendario y el resumen de `/horarios` leen las versiones al abrirse.
- No toca cambios de un día, ausencias, horas extra ni las reglas de baja y reactivación. Sin migraciones nuevas.
- Archivos:
  - `app/utils/schedule-editor.js`, con pruebas en `tests/unit/schedule-editor.test.js`;
  - `app/composables/useScheduleVersions.js`;
  - `EmployeeScheduleEditorModal.vue` y `EmployeeScheduleDayEditor.vue`;
  - `app/pages/empleados/[id].vue` (botón y editor);
  - `app/utils/schedule-exceptions.js` (exporta `getShiftValidationMessage`, sin cambiar su comportamiento).

Los festivos y sus avisos se trasladaron a la Fase 3.

**Aceptación:** se puede configurar el horario habitual de cada trabajadora sin repetirlo cada semana, cambiar días concretos y registrar ausencias sin alterar el horario habitual, y consultar la semana con las horas previstas en móvil y ordenador. La baja conserva el historial y no toca las horas extra.

## Fase 6 — Dashboard y pulido responsive
- Mostrar pedidos de hoy, pedidos pendientes, próximas entregas y resumen de horas extra. *(Pedidos de hoy y mañana con sus productos: hecho en el Bloque 5 de la Fase 3. Pendiente: resumen de horas extra en Inicio.)*
- Ajustar navegación y formularios para móvil.
- Ajustar tablas y calendarios para ordenador.
- Revisar estados de carga, errores, confirmaciones y estados vacíos.

**Aceptación:** las acciones habituales se completan cómodamente en móvil y ordenador.

## Fase 7 — Validación y despliegue
- Pruebas funcionales de todos los flujos.
- Verificación de permisos y RLS.
- Revisión de accesibilidad básica.
- Configurar despliegue y variables de entorno.
- Probar en dispositivos reales.

**Aceptación:** los flujos principales funcionan, los datos permanecen protegidos y la versión publicada está configurada correctamente.

## Reglas para cada tarea de Claude Code

1. Leer los documentos relevantes.
2. Inspeccionar el código existente antes de modificarlo.
3. Proponer un plan breve si la tarea toca varias áreas.
4. Implementar solo el alcance solicitado.
5. Añadir o actualizar pruebas.
6. Ejecutar los comandos de verificación disponibles.
7. Resumir archivos modificados, decisiones y posibles tareas pendientes.
