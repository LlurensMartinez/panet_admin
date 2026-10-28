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
- Calcular totales semanales (lunes-domingo) y mensuales. *(En parte: `/horas-extra` tiene periodos rápidos Hoy, Semanal (lunes a domingo de la semana actual), Mensual (mes natural), Anual (año natural) y Personalizado, con el total exacto de la tienda o de un empleado. Fechas calculadas en `Europe/Madrid`. Verificado con pruebas unitarias y de extremo a extremo en local. **Pendiente:** el resumen desglosado por trabajadora, la consulta de periodos anteriores (semana o mes pasados) sin escribir las fechas y la prueba manual contra Supabase real.)*
- Generar texto compartible para la responsable de zona. *(Pendiente.)*
- Permitir editar registros. *(Implementado: edición y eliminación con confirmación de registros de horas extra. Eliminar solo borra el registro, nunca la ficha del empleado. **Pendiente:** prueba manual contra Supabase real.)*
- Mantener historial de trabajadoras desactivadas. *(Hecho en local: desactivar solo cambia `is_active`; sus registros de horas extra siguen visibles, marcados como «inactivo», y se pueden corregir sin cambiar de persona. **Pendiente:** comprobarlo contra Supabase real.)*

**Aceptación:** los totales coinciden con pruebas manuales y la duración se guarda en minutos enteros.

## Fase 3 — Proveedores y catálogo
- Crear tablas `suppliers` y `supplier_products`, con RLS y políticas basadas en `private.is_authorized()`.
- Implementar altas, edición y desactivación.
- Configurar días de pedido y entrega.
- Configurar unidades y cantidades habituales.

**Aceptación:** la encargada puede gestionar el catálogo desde móvil y ordenador.

## Fase 4 — Pedidos e historial
- Crear tablas `orders` y `order_lines`, con RLS y políticas basadas en `private.is_authorized()`.
- Mostrar proveedores a los que corresponde pedir en la fecha actual.
- Crear pedido con líneas basadas en los productos activos y cantidades habituales.
- Permitir modificar cantidades del pedido sin modificar valores habituales.
- Marcar pedido como realizado.
- Consultar historial.
- Evitar duplicados accidentales para proveedor/fecha.

**Aceptación:** un pedido anterior conserva sus cantidades y un nuevo día de pedido genera un nuevo pedido.

## Fase 5 — Horarios, ausencias y festivos
- Confirmar el modelo de horarios habituales antes de implementarlo.
- Implementar consulta de horarios.
- Implementar vacaciones y ausencias.
- Implementar gestión manual de festivos.
- Las tablas `employee_regular_schedules`, `employee_absences` y `holidays` se crean con RLS y políticas basadas en `private.is_authorized()`.
- Mostrar advertencias preventivas sobre entregas previstas en festivos.

**Aceptación:** se pueden consultar horarios y ausencias; los avisos de festivos no afirman que el proveedor no vaya a entregar.

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
