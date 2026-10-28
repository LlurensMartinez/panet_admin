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
- No añadir IA, nóminas, pagos, contabilidad, ventas, clientes, inventario ni funciones multi-tienda.
- La prioridad funcional es controlar pedidos y personal, especialmente el registro y resumen de horas extra.
- Diseñar primero para móvil y adaptar a ordenador.
- Las horas extra se introducen manualmente como horas/minutos y se almacenan como minutos enteros.
- Los totales semanales usan lunes-domingo y los mensuales el mes natural.
- Cambiar una cantidad de pedido no modifica la cantidad habitual del producto.
- Los pedidos históricos conservan una copia de sus líneas y cantidades.
- Los festivos generan advertencias preventivas, no afirmaciones sobre la política real de entrega del proveedor.

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
