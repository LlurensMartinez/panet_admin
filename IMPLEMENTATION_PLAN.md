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
- Configurar proyecto Supabase.
- Crear la tabla `profiles`.
- Implementar inicio/cierre de sesión.
- Configurar protección de rutas.
- Añadir políticas RLS y probar acceso no autorizado.

**Aceptación:** la encargada puede acceder y las rutas/datos privados están protegidos.

## Fase 2 — Personal y horas extra
- Crear migraciones para `employees` y `overtime_entries`.
- Crear listado y formulario de trabajadoras.
- Crear formulario móvil para registrar horas extra.
- Crear historial individual y general.
- Calcular totales semanales (lunes-domingo) y mensuales.
- Generar texto compartible para la responsable de zona.
- Permitir editar registros.
- Mantener historial de trabajadoras desactivadas.

**Aceptación:** los totales coinciden con pruebas manuales y la duración se guarda en minutos enteros.

## Fase 3 — Proveedores y catálogo
- Crear tablas `suppliers` y `supplier_products`.
- Implementar altas, edición y desactivación.
- Configurar días de pedido y entrega.
- Configurar unidades y cantidades habituales.

**Aceptación:** la encargada puede gestionar el catálogo desde móvil y ordenador.

## Fase 4 — Pedidos e historial
- Crear tablas `orders` y `order_lines`.
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
