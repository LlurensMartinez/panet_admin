# Instrucciones para Claude Code

## Contexto del proyecto
Aplicación web privada para gestionar los pedidos a proveedores y aspectos concretos del personal de una única tienda. La usuaria inicial es la encargada.

## Documentos de referencia
- `SPEC.md`: alcance y comportamiento funcional.
- `DATA_MODEL.md`: propuesta de datos y seguridad.
- `IMPLEMENTATION_PLAN.md`: fases de implementación.

Lee los documentos relevantes antes de hacer cambios. Si el código contradice un documento, señala la discrepancia en lugar de decidir silenciosamente.

## Stack
- Nuxt 4.
- JavaScript por defecto; no introducir TypeScript salvo autorización.
- Nuxt UI y Tailwind CSS para la interfaz.
- Supabase para autenticación y PostgreSQL.
- Git para control de versiones.

Antes de instalar paquetes o asumir APIs, comprueba las versiones y patrones existentes en el proyecto.

## Reglas de producto
- Una sola tienda.
- Solo la encargada inicia sesión en el MVP.
- Las trabajadoras no tienen cuentas.
- No añadir IA, nóminas, pagos, contabilidad, ventas, clientes, inventario/stock, precios ni funciones multi-tienda.
- La prioridad funcional es controlar pedidos y personal, especialmente el registro y resumen de horas extra.
- Diseñar primero para móvil y adaptar a ordenador.
- Las horas extra se introducen manualmente como horas/minutos y se almacenan como minutos enteros.
- Los totales semanales usan lunes-domingo y los mensuales el mes natural.
- Cada proveedor puede tener productos habituales (nombre, unidad y cantidad habitual). La cantidad habitual es solo una referencia: no es stock ni obliga a pedirla. Los productos no se borran: se desactivan.
- Por ahora, los pedidos no tienen líneas de productos ni cantidades: el contenido se anota en las notas del pedido, en texto libre.
- La agenda de pedidos se calcula a partir de los días de entrega y la antelación de cada proveedor. Solo se guarda un pedido cuando la encargada actúa sobre él; no se crean filas automáticamente al abrir la app.
- Cambiar las fechas de un pedido concreto no modifica la configuración del proveedor.
- Los pedidos preparados y los marcados como «no se pide» se conservan en el historial.
- Los festivos generan advertencias preventivas, no afirmaciones sobre la política real de entrega del proveedor, y nunca mueven ni cancelan pedidos automáticamente.
- Los festivos oficiales (`source = 'official'`) los mantiene la app a partir de los datos abiertos de la Generalitat y del municipio de la tienda (`shop_settings`); nunca se tocan los manuales. Elegir el municipio no convierte la app en multitienda.
- Horarios: el horario habitual se guarda por versiones con fecha de inicio. Las vigentes o pasadas no se modifican. Una excepción (cambio de un día o ausencia) nunca modifica el horario habitual. Las horas previstas son horas reales en Europe/Madrid, y un turno nocturno cuenta en el día en que empieza.
- La baja de una trabajadora solo elimina planificación posterior a hoy, en una operación atómica. Nunca toca horarios vigentes o pasados ni horas extra. No se guardan motivos médicos ni datos de salud en las ausencias.

## Seguridad
- Nunca exponer secretos ni la clave `service_role` en el cliente.
- Usar RLS en tablas expuestas por Supabase.
- No considerar la protección de rutas del frontend como sustituto de permisos en base de datos.
- Evitar políticas que permitan el acceso a cualquier usuario autenticado si solo debe acceder la encargada autorizada.
- No recopilar datos personales que no sean necesarios.
- No ejecutar migraciones destructivas sin explicar el impacto.

## Calidad
- Mantener componentes pequeños y responsabilidades claras.
- Validar formularios y mostrar errores comprensibles.
- Diseñar estados de carga, error y vacío.
- Añadir pruebas a la lógica de negocio importante, especialmente sumas y límites de periodos.
- No afirmar que una tarea está verificada si no se han ejecutado las comprobaciones.
- Ejecutar las pruebas/lint/typecheck disponibles tras los cambios y comunicar resultados reales.
- No crear abstracciones o dependencias innecesarias.

## Flujo de trabajo
1. Inspeccionar el proyecto.
2. Leer la especificación relacionada con la tarea.
3. Presentar un plan breve si el cambio no es trivial.
4. Implementar únicamente la tarea solicitada.
5. Probar y revisar el diff.
6. Resumir lo realizado y cualquier decisión pendiente.
