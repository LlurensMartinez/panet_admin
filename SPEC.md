# Gestión de tienda — Especificación funcional

**Versión:** 0.1  
**Estado:** Borrador para validar antes de implementar  
**Objetivo:** Aplicación web privada para que la encargada gestione los pedidos a proveedores y aspectos concretos del personal de una única tienda.

## 1. Objetivo y principios

La aplicación sustituye anotaciones en una libreta y centraliza la información necesaria para el trabajo diario.

Principios:
- Priorizar tareas frecuentes y formularios cortos.
- Diseñar primero para móvil, sin perjudicar el uso en ordenador.
- Recopilar únicamente los datos necesarios.
- Mantener el alcance acotado: pedidos y gestión básica del personal.
- No añadir IA al MVP.
- No implementar funciones de ERP, contabilidad o nóminas.

## 2. Usuarios y acceso

- En el MVP solo la encargada inicia sesión.
- Las trabajadoras no tienen cuentas ni acceden a la aplicación.
- La responsable de zona no tiene cuenta: la encargada comparte los resúmenes necesarios.
- La aplicación gestiona un único establecimiento.
- El acceso a los datos debe estar protegido en el servidor/base de datos, no solo en la interfaz.

## 3. Módulos

### 3.1 Inicio / dashboard

Mostrar un resumen práctico:
- Proveedores a los que toca pedir hoy.
- Pedidos pendientes y realizados.
- Próximas entregas previstas.
- Resumen de horas extra del periodo actual.
- Avisos relevantes, incluidos posibles conflictos con festivos.

Evitar estadísticas que no ayuden a tomar una acción.

### 3.2 Proveedores

Cada proveedor tendrá:
- Nombre (obligatorio).
- Días habituales de pedido.
- Días previstos de entrega.
- Notas opcionales.
- Estado activo/inactivo.

No se requieren NIF, datos fiscales ni dirección.

Los días de pedido y los días de entrega son calendarios diferentes.

### 3.3 Productos por proveedor

Cada producto estará asociado a un proveedor y tendrá:
- Nombre.
- Unidad de medida (por ejemplo: unidad, caja, paquete, kg).
- Cantidad habitual.
- Estado activo/inactivo.

La cantidad habitual sirve como valor inicial al crear un pedido, pero cambiar la cantidad de un pedido concreto nunca debe modificarla automáticamente.

### 3.4 Pedidos

- La aplicación calcula qué proveedores corresponde pedir según el día de la semana y la configuración activa.
- Cada día debe poder generarse un pedido nuevo para cada proveedor correspondiente, aunque se haya realizado el pedido de la semana anterior.
- El pedido guarda una copia de las líneas y cantidades solicitadas para conservar el historial aunque después se cambie el catálogo.
- Estados del MVP: `pending` (pendiente) y `ordered` (realizado).
- La encargada puede editar las cantidades del pedido y marcarlo como realizado.
- La fecha y hora de realización se registran cuando se marca como realizado.
- La encargada puede consultar pedidos anteriores por fecha y proveedor.

No se envían pedidos automáticamente al proveedor: la aplicación registra y organiza el trabajo.

### 3.5 Entregas y festivos

- Mostrar las entregas previstas a partir de los días configurados para cada proveedor.
- Permitir configurar los festivos relevantes para la tienda.
- Si una entrega prevista coincide con un festivo configurado, mostrar un aviso preventivo.
- No asumir que el proveedor no entregará. El aviso debe recomendar comprobarlo.
- La aplicación no necesita integrar automáticamente un calendario oficial de festivos en la primera versión; la configuración manual es suficiente para el MVP.

### 3.6 Trabajadoras

Cada ficha tendrá solo los datos necesarios:
- Nombre y apellidos.
- Puesto/función (opcional).
- Estado activa/inactiva.
- Observaciones opcionales.

No recopilar datos sensibles o administrativos que no sean necesarios para las funciones acordadas.

Al desactivar una trabajadora, sus registros históricos deben conservarse.

### 3.7 Horas extra

La encargada registra manualmente:
- Trabajadora.
- Fecha (por defecto, hoy).
- Duración en horas y minutos.
- Motivo opcional.
- Observaciones opcionales.

Reglas:
- Guardar la duración como número entero de minutos.
- Permitir corregir un registro introducido por error.
- Mostrar historial por trabajadora y por periodo.
- No calcular pagos, nóminas ni compensaciones.
- No inferir las horas extra comparando con turnos: se introducen manualmente.

### 3.8 Resúmenes de horas extra

Permitir seleccionar:
- Semana natural, de lunes a domingo.
- Mes natural.
- Un periodo anterior consultable.

Mostrar:
- Total por trabajadora.
- Total de la tienda.
- Fechas incluidas en el periodo.

Permitir copiar/generar un texto simple para compartir con la responsable de zona. El texto debe incluir periodo, trabajadoras y duración acumulada.

### 3.9 Horarios, vacaciones y ausencias

Alcance inicial de la opción A:
- Consultar los horarios habituales que se decida registrar.
- Registrar vacaciones y ausencias por trabajadora, con fecha de inicio y finalización.
- No construir un planificador avanzado de turnos ni asignación automática de personal.
- El detalle exacto de los datos de horarios habituales debe validarse antes de implementar este submódulo.

## 4. Experiencia de uso

### Móvil
- Acceso rápido a pedidos de hoy y horas extra.
- Formularios cortos y botones cómodos.
- Evitar tablas que requieran desplazamiento horizontal.
- Introducir duración en horas/minutos de forma sencilla.

### Ordenador
- Aprovechar el espacio para historiales, tablas y resúmenes.
- Mantener las mismas funciones y datos que en móvil.

### Persistencia
Los cambios guardados en un dispositivo deben estar disponibles en el otro tras sincronizarse con el servidor. El MVP requiere conexión a Internet; no incluye modo offline.

## 5. Fuera del alcance del MVP

- Gestión de varias tiendas.
- Cuentas para trabajadoras o responsable de zona.
- Nóminas, pagos o compensaciones.
- Facturación, contabilidad, ventas, clientes o inventario/stock.
- Integración automática con proveedores.
- Lectura de fotografías o IA.
- Aplicación nativa para iOS/Android.
- Modo sin conexión.
- Planificación avanzada o automática de turnos.

## 6. Criterios de aceptación

1. La encargada puede iniciar sesión y acceder de forma privada.
2. Puede crear, editar y desactivar proveedores y productos.
3. Los proveedores a los que toca pedir aparecen según su calendario.
4. Cada jornada de pedido permite crear un pedido nuevo.
5. Modificar una cantidad de pedido no cambia la cantidad habitual.
6. El historial conserva las cantidades pedidas en su momento.
7. La encargada puede crear y desactivar fichas de trabajadoras sin perder el historial.
8. Puede registrar horas extra como horas/minutos y corregirlas.
9. Los totales semanales y mensuales son correctos y se muestran por trabajadora y para toda la tienda.
10. Puede generar un resumen compartible.
11. Puede registrar vacaciones/ausencias y consultar horarios habituales dentro del alcance acordado.
12. La aplicación funciona en móvil y ordenador.
13. Los datos no son accesibles sin autorización.
