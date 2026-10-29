# Gestión de tienda — Especificación funcional

**Versión:** 0.3 (productos habituales por proveedor; pedidos con notas libres)  
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
- Pedidos que toca preparar hoy.
- Pedidos pendientes y preparados.
- Próximas entregas previstas.
- Resumen de horas extra del periodo actual.
- Avisos relevantes, incluidos posibles conflictos con festivos.

Evitar estadísticas que no ayuden a tomar una acción.

**Implementado (Bloque 5): resumen de pedidos de hoy y mañana.** Inicio (`/`) muestra, solo para consultar:
- **Hoy:** los pedidos pendientes que se preparan hoy y los atrasados de la agenda (pendientes de los 7 días anteriores), marcados como atrasados. **Mañana:** los pendientes que se preparan mañana. «Hoy» es el día de la tienda (Europe/Madrid).
- Una tarjeta por proveedor (sin repetirlo en la misma sección) con sus entregas, las notas del pedido, si es manual o tiene la fecha cambiada, el aviso de festivo de la entrega y sus productos habituales **activos** con la cantidad habitual y la unidad. Un proveedor sin productos activos aparece igualmente, con un mensaje y un enlace a su ficha.
- Se calcula con la misma lógica que la agenda (`buildAgenda`): calendario y antelación de cada proveedor, pedidos manuales y fechas cambiadas. Los pedidos preparados y los «no se pide» no se muestran.
- Las cantidades son las habituales del producto: orientativas, no confirmadas. Inicio no las modifica ni las inventa.
- Abrir o recargar Inicio no crea, modifica ni borra nada. Los pedidos se gestionan en la agenda («Ver agenda completa» y un enlace en cada proveedor).
- Si fallan los productos o los festivos, los pedidos se muestran igualmente con un aviso y «Reintentar»; si fallan los pedidos o los proveedores, se muestra un error con «Reintentar».

Quedan pendientes para la Fase 6 el resumen de horas extra del periodo actual y las próximas entregas más allá de mañana (hoy se consultan en la agenda y en «Horas extra»).

### 3.2 Proveedores

Cada proveedor tendrá:
- Nombre (obligatorio). No puede haber dos proveedores con el mismo nombre, sin distinguir mayúsculas, acentos ni espacios repetidos.
- Días habituales de entrega (de lunes a domingo; puede no tener ninguno).
- Antelación: cuántos días antes de la entrega se prepara el pedido, de 0 (el mismo día) a 7. Por defecto, 1.
- Notas opcionales.
- Estado activo/inactivo.

No se requieren NIF, datos fiscales ni dirección.

Los proveedores no se eliminan: se desactivan. Un proveedor inactivo no genera previsiones ni admite pedidos nuevos, pero conserva su historial.

La antelación es única por proveedor. Si en el futuro hiciera falta una antelación distinta según el día de entrega (por ejemplo, pedir el viernes para el lunes y el martes para el jueves), se podrá incorporar en una fase posterior. Mientras tanto, la fecha de preparación de cada pedido se puede corregir individualmente.

### 3.3 Productos habituales por proveedor

Decisión revisada en el Bloque 4 (antes, el catálogo quedaba fuera del MVP). Cada proveedor puede tener varios productos habituales:
- Nombre (obligatorio). No puede repetirse dentro del mismo proveedor, sin distinguir mayúsculas, acentos ni espacios repetidos (misma regla que los nombres de proveedor). Dos proveedores distintos sí pueden tener un producto con el mismo nombre.
- Unidad de medida en texto libre (unidades, cajas, kg, sacos…).
- Cantidad habitual: mayor que 0, hasta 99.999,99 y con dos decimales como máximo. Es solo una referencia inicial para preparar pedidos, no una obligación.
- Estado activo/inactivo.

Se consultan, añaden, editan y desactivan/reactivan desde la ficha de cada proveedor (`/pedidos/proveedores/<id>`), a la que se llega pulsando su nombre en la lista. Los productos no se eliminan: se desactivan, para que ningún pedido que los use en el futuro se quede sin su producto. Un producto no puede pasar a otro proveedor.

Todavía no hay líneas de pedido ni precios: el contenido de cada pedido se sigue anotando en sus notas. En una fase posterior, los productos habituales podrán proponerse al preparar un pedido, con su cantidad habitual modificable para ese pedido concreto.

### 3.4 Pedidos

- **Agenda calculada.** La aplicación calcula las entregas previstas de cada proveedor activo a partir de sus días de entrega, y la fecha de preparación restando la antelación. Esas previsiones no se guardan en la base de datos.
- **Pedido guardado solo al actuar.** Un pedido se guarda cuando la encargada actúa sobre una previsión (marcarla como preparada o como «no se pide», corregir fechas o escribir notas) o crea un pedido a mano. Abrir la aplicación, recargarla o cambiar de día no crea pedidos.
- **Sin duplicados.** Como mucho un pedido por proveedor y fecha de entrega, y cada previsión se convierte como mucho en un pedido, aunque se actúe desde dos dispositivos a la vez. Lo garantiza la base de datos; la aplicación avisa y recarga si choca.
- **Datos del pedido:** proveedor, fecha de entrega, fecha de preparación, estado y notas en texto libre (contenido y observaciones). Sin líneas de productos ni cantidades.
- **Estados:**
  - `pending` (pendiente).
  - `prepared` (preparado): se registra la fecha y hora del servidor en que se marcó.
  - `skipped` (no se pide): descarta una previsión para la que no se hará pedido, por ejemplo por un festivo. No aparece como pendiente ni como atrasado.
  - Desde cualquier estado se puede volver a pendiente.
- **Correcciones.** La encargada puede corregir las fechas de entrega y de preparación de un pedido concreto (la preparación no puede ser posterior a la entrega) sin cambiar la configuración del proveedor. El proveedor de un pedido existente no se cambia.
- **Eliminación.** Solo se pueden eliminar pedidos pendientes, por ejemplo uno creado por error. Los preparados y los descartados se conservan en el historial.
- **Agenda:** pedidos atrasados (pendientes con fecha de preparación en los 7 días anteriores), los de hoy y los de los próximos 14 días.
- **Historial:** consulta de pedidos anteriores por proveedor y fechas.

No se envían pedidos automáticamente al proveedor: la aplicación registra y organiza el trabajo.

### 3.5 Entregas y festivos

- Mostrar las entregas previstas a partir de los días configurados para cada proveedor.
- Permitir configurar los festivos relevantes para la tienda: fecha, nombre, ámbito (nacional, autonómico o local) y notas opcionales. Uno por fecha. Se pueden corregir y eliminar.
- Si la fecha de entrega de un pedido o de una previsión coincide con un festivo configurado, mostrar un aviso preventivo (en la agenda, el historial y el formulario del pedido). No se avisa de los pedidos marcados como «no se pide» ni de entregas ya pasadas.
- No asumir que el proveedor no entregará. El aviso debe recomendar confirmar la entrega con el proveedor.
- Nunca mover ni cancelar pedidos automáticamente. Si el proveedor confirma un cambio, la encargada corrige la fecha o marca el pedido como «no se pide».
- La aplicación no integra un calendario oficial de festivos ni una API externa en la primera versión; la configuración manual es suficiente para el MVP.

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
- Líneas de pedido con cantidades por producto (por ahora, el contenido va en las notas del pedido) y precios.
- Integración automática con proveedores.
- Lectura de fotografías o IA.
- Aplicación nativa para iOS/Android.
- Modo sin conexión.
- Planificación avanzada o automática de turnos.

## 6. Criterios de aceptación

1. La encargada puede iniciar sesión y acceder de forma privada.
2. Puede crear, editar y desactivar proveedores, con sus días de entrega y antelación.
3. Los pedidos que toca preparar aparecen en la agenda según el calendario de cada proveedor, sin crear pedidos duplicados al recargar o cambiar de día.
4. Puede marcar cada pedido como pendiente, preparado o «no se pide», y corregir sus fechas sin cambiar la configuración del proveedor.
5. Las entregas que coinciden con un festivo configurado muestran un aviso que recomienda confirmarlas, sin moverlas ni cancelarlas.
6. El historial conserva los pedidos preparados y descartados, también los de proveedores desactivados.
7. La encargada puede crear y desactivar fichas de trabajadoras sin perder el historial.
8. Puede registrar horas extra como horas/minutos y corregirlas.
9. Los totales semanales y mensuales son correctos y se muestran por trabajadora y para toda la tienda.
10. Puede generar un resumen compartible.
11. Puede registrar vacaciones/ausencias y consultar horarios habituales dentro del alcance acordado.
12. La aplicación funciona en móvil y ordenador.
13. Los datos no son accesibles sin autorización.
