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
Sustituye a las antiguas fases 3 (proveedores y catálogo) y 4 (pedidos e historial) e incluye los festivos, que estaban en la Fase 5. Sin catálogo de productos ni líneas de pedido: el contenido de cada pedido se anota en sus notas (ver `SPEC.md`, 3.3 y 3.4). Se implementa en tres bloques; no se pasa al siguiente si falla alguna prueba del anterior.

**Bloque 1 — Base de datos**
- Crear `suppliers`, `orders` y `holidays`, con RLS y políticas basadas en `private.is_authorized()`. *(Hecho en local: `supabase/migrations/20261028221500_suppliers_orders_holidays.sql`, con comprobaciones en `supabase/tests/orders_rls_checks.sql` (117 filas: 116 `OK` + 1 `INFO`) y guía en `SUPABASE_SETUP.md`, sección 10. Validado en un PostgreSQL 16 local que imita Supabase y a través de PostgREST 13 en local. **Pendiente:** aplicar la migración y ejecutar las comprobaciones en el proyecto de Supabase real.)*

**Bloque 2 — Proveedores y festivos** *(hecho en local)*
- Subpáginas `/pedidos/proveedores` y `/pedidos/festivos`, y entrada «Pedidos» en la navegación. *(Hecho. `/pedidos` muestra por ahora un aviso de que la agenda llegará en el Bloque 3 y enlaza a la configuración.)*
- Altas, edición y desactivación de proveedores: nombre, días de entrega, antelación (0 a 7 días) y notas; aviso de nombre duplicado (sin distinguir mayúsculas, acentos ni espacios, igual que la base de datos). *(Hecho: búsqueda, filtro por estado, resumen del calendario de entrega y preparación en el formulario, reactivación desde «Inactivos». Sin borrado.)*
- Altas, edición y eliminación de festivos con ámbito nacional, autonómico o local. *(Hecho: vista por años agrupada por meses, aviso de fecha repetida, confirmación al eliminar.)*
- Verificado con pruebas unitarias y de extremo a extremo en local (PostgREST 13 + PostgreSQL 16 con la migración real). **Pendiente:** aplicar la migración y probar las pantallas contra el proyecto de Supabase real.

**Bloque 3 — Agenda, historial y avisos** *(pendiente)*
- Agenda calculada (atrasados de los últimos 7 días, hoy y próximos 14 días), sin crear filas al abrir la app.
- Guardar un pedido solo al actuar sobre él; gestionar los conflictos de duplicado (409) recargando y avisando.
- Estados pendiente, preparado y «no se pide»; corregir fechas y notas; eliminar solo pedidos pendientes; pedidos manuales.
- Avisos de festivo en la fecha de entrega que recomiendan confirmarla, sin mover ni cancelar pedidos.
- Historial por proveedor y fechas.

**Aceptación:** la agenda muestra los pedidos que toca preparar según el calendario de cada proveedor sin duplicarlos al recargar o cambiar de día; los estados y las fechas corregidas se conservan; los proveedores desactivados conservan su historial; los avisos de festivos no afirman que el proveedor no vaya a entregar.

**Para una fase futura:** antelaciones distintas según el día de entrega (hoy, una por proveedor; cada pedido puede corregir su fecha de preparación).

## Fase 4 — (integrada en la Fase 3)
Los pedidos y su historial forman parte de la Fase 3. Se mantiene la numeración del resto de fases.

## Fase 5 — Horarios y ausencias
- Confirmar el modelo de horarios habituales antes de implementarlo.
- Implementar consulta de horarios.
- Implementar vacaciones y ausencias.
- Las tablas `employee_regular_schedules` y `employee_absences` se crean con RLS y políticas basadas en `private.is_authorized()`.

Los festivos y sus avisos se han trasladado a la Fase 3.

**Aceptación:** se pueden consultar horarios y ausencias.

## Fase 6 — Dashboard y pulido responsive
- Mostrar pedidos de hoy, pedidos pendientes, próximas entregas y resumen de horas extra.
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
