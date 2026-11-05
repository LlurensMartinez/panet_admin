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
- **Hoy:** los pedidos pendientes que se preparan hoy. **Mañana:** los pendientes que se preparan mañana. «Hoy» es el día de la tienda (Europe/Madrid).
- **Atrasados** (los de la agenda: pendientes de los 7 días anteriores): no se mezclan con Hoy. Si hay alguno, un aviso siempre visible indica cuántos («Hay 3 pedidos atrasados») con el control «Mostrar pedidos atrasados». Al activarlo aparece la sección «Atrasados», antes de Hoy, con cada pedido marcado como atrasado; al desactivarlo se oculta. Por defecto (y al recargar) está oculta. Mostrarla u ocultarla no cambia ningún pedido, y en la agenda siguen igual. Sin atrasados no se muestra ni el aviso ni el control.
- Una tarjeta por proveedor (sin repetirlo en la misma sección) con sus entregas, las notas del pedido, si es manual o tiene la fecha cambiada, el aviso de festivo de la entrega y sus productos habituales **activos** con la cantidad habitual y la unidad. Un proveedor sin productos activos aparece igualmente, con un mensaje y un enlace a su ficha.
- Se calcula con la misma lógica que la agenda (`buildAgenda`): calendario y antelación de cada proveedor, pedidos manuales y fechas cambiadas. Los pedidos preparados y los «no se pide» no se muestran.
- **Recordatorios de proveedores a demanda:** una tarjeta informativa por cada proveedor activo con pedido «a demanda» (por ejemplo, «¿Necesitas pedir As de Hielo hoy?»), con el tiempo de entrega, los días en que puede entregar, cuándo llegaría si se pide hoy, la hora límite y las notas. No son pedidos ni avisos urgentes, y no crean nada. «Ya lo he tenido en cuenta» la oculta hasta el día siguiente solo en ese navegador (almacenamiento local, sin escribir en Supabase); «Volver a mostrar» la recupera. Si el proveedor se desactiva o deja de ser a demanda, desaparece. Sin proveedores a demanda activos no se muestra la sección.
- Las cantidades son las habituales del producto: orientativas, no confirmadas. Inicio no las modifica ni las inventa.
- Abrir o recargar Inicio no crea, modifica ni borra nada. Los pedidos se gestionan en la agenda («Ver agenda completa» y un enlace en cada proveedor).
- Si fallan los productos o los festivos, los pedidos se muestran igualmente con un aviso y «Reintentar»; si fallan los pedidos o los proveedores, se muestra un error con «Reintentar».

Quedan pendientes para la Fase 6 el resumen de horas extra del periodo actual y las próximas entregas más allá de mañana (hoy se consultan en la agenda y en «Horas extra»).

### 3.2 Proveedores

Cada proveedor tendrá:
- Nombre (obligatorio). No puede haber dos proveedores con el mismo nombre, sin distinguir mayúsculas, acentos ni espacios repetidos.
- Cómo se pide:
  - **Días fijos** (por defecto): la agenda propone el pedido de cada entrega.
  - **A demanda**: se pide cuando hace falta (por ejemplo, el hielo, que se puede pedir cualquier día y llega en 48 h). No genera previsiones; los días de entrega son los días en que puede entregar y la antelación es el tiempo que tarda en llegar. Al crear un pedido a mano se propone pedirlo hoy y la entrega posible más próxima.
- Días habituales de entrega (de lunes a domingo; puede no tener ninguno).
- Antelación: cuántos días antes de la entrega se prepara el pedido, de 0 (el mismo día) a 7. Por defecto, 1. Puede ser **distinta según el día de entrega** (por ejemplo, el pedido del lunes se hace el viernes, 3 días antes, y el del jueves el miércoles, 1 día antes).
- Frecuencia: **cada semana** o **cada 2 semanas** (quincenal). Las quincenales tienen una fecha de entrega de referencia que marca qué semanas tocan (las semanas alternas, de lunes a domingo).
- Hora límite del pedido (opcional): hora máxima para hacerlo el día que se prepara (por ejemplo, antes de las 12:00). La agenda y la página de inicio la muestran en los pedidos pendientes y avisan cuando ya ha pasado.
- Notas opcionales.
- Estado activo/inactivo.

No se requieren NIF, datos fiscales ni dirección.

Los proveedores no se eliminan: se desactivan. Un proveedor inactivo no genera previsiones ni admite pedidos nuevos, pero conserva su historial.

La fecha de preparación de cada pedido se puede seguir corrigiendo individualmente sin cambiar la configuración del proveedor.

La agenda no prevé pedidos anteriores al día en que se dio de alta el proveedor: un proveedor recién creado no aparece con pedidos atrasados de días en que aún no existía.

Los proveedores de la hoja «Proveïdors Panet L'Ametlla» (12/06/2026) se cargan con el script `supabase/seeds/proveedores_hoja_2026-06-12.sql` (ver `SUPABASE_SETUP.md`, sección 12).

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
- **Festivos oficiales automáticos** (decisión revisada; antes solo había configuración manual): en Festivos se elige el municipio de la tienda entre los municipios con tiendas Panet (24, sin Andorra). La app consulta los datos abiertos de la Generalitat (calendario laboral de Cataluña y festivos locales del municipio) y guarda los festivos nacionales, autonómicos y locales del año actual y del siguiente.
  - Se actualizan solos, como mucho una vez al día, al abrir Festivos o la agenda de Pedidos, y al cambiar de municipio. Inicio no los actualiza (sigue siendo solo de lectura). Un año que aún no está publicado no se toca.
  - Los datos oficiales no traen el nombre de las fiestas: la app pone el nombre y el ámbito de los festivos de Cataluña según la fecha, y los locales se llaman «Fiesta local de <municipio>».
  - Solo se añaden, cambian o retiran los festivos oficiales. Los manuales nunca se tocan, y si ocupan una fecha oficial se respetan. Editar un festivo oficial lo convierte en manual. Si se borra uno oficial, vuelve en la siguiente actualización.
  - Si la Generalitat no responde, se avisa en Festivos y se reintenta más tarde. Si un municipio no tiene publicados sus festivos locales (por ejemplo, Viladecans en 2026), solo se importan los de Cataluña.
  - La app sigue siendo para una sola tienda: el municipio solo sirve para saber qué festivos locales le corresponden.

### 3.6 Trabajadoras

Cada ficha tendrá solo los datos necesarios:
- Nombre y apellidos.
- Puesto/función (opcional).
- Estado activa/inactiva.
- Observaciones opcionales.

No recopilar datos sensibles o administrativos que no sean necesarios para las funciones acordadas.

Al desactivar una trabajadora, sus registros históricos deben conservarse.

Cada trabajadora tiene una ficha (`/empleados/[id]`) con sus datos, su situación (en activo o de baja, con su último día de trabajo) y su horario habitual con el historial de versiones. Por ahora el horario solo se consulta desde la ficha.

Con el módulo de horarios (3.9), dar de baja a una trabajadora pide su **último día de trabajo** (incluido; como muy tarde, hoy):
- Desde el día siguiente deja de aparecer en la planificación; en las semanas pasadas se sigue viendo su horario.
- Se elimina solo su planificación futura (cambios de un día, ausencias y horarios que empiezan después de hoy), mostrando antes qué se eliminará y pidiendo confirmación. Las ausencias en curso se acortan hasta hoy.
- Nunca se eliminan ni modifican horarios vigentes o pasados ni registros de horas extra. Todo se guarda en una sola operación: si algo falla, no cambia nada.
- Al reactivarla se indica la fecha de vuelta y se puede copiar su último horario desde esa fecha. El periodo de baja queda sin horario.
- Las trabajadoras sin horarios se pueden desactivar y activar como hasta ahora.

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

Sustituye al alcance inicial de la opción A («no construir un planificador avanzado de turnos»): la encargada lo amplió el 5 de noviembre de 2026. Sigue sin haber asignación automática de personal, fichajes ni nóminas.

**Horario habitual por trabajadora** (en su ficha):
- De lunes a domingo, con uno o varios turnos por día (como mucho 3), cada uno con hora de inicio y fin. Un día sin turnos es de descanso.
- El total semanal se calcula automáticamente.
- Los turnos no cambian de una semana a otra: no hay que crear el horario cada semana.
- Cambiar el horario crea una **versión nueva** desde la fecha que se elija (por defecto, el lunes siguiente; como pronto, el lunes de la semana actual, salvo la primera versión de cada trabajadora). Las versiones anteriores se conservan: las semanas pasadas siguen mostrando el horario que tenían. Una versión rige hasta el día antes de la siguiente, así que nunca se solapan. Puede haber trabajadoras sin horario o con un horario que empieza en el futuro.

**Calendario semanal conjunto** (`/horarios`; lunes-domingo, una fila por trabajadora, navegación entre semanas; en móvil, vista por día con selector de día):
- Muestra los turnos y las horas previstas de cada trabajadora y de toda la plantilla.
- Aparecen las trabajadoras con actividad en la semana: con horario, cambios o ausencias, o en activo (desde la semana actual). Nunca después de su último día de trabajo.
- Desde ahí se puede cambiar un día concreto sin alterar el horario habitual.

**Excepciones puntuales**, que solo afectan a las fechas indicadas:
- Cambiar los turnos de un día, añadir o quitar un turno, o marcar el día como libre. Al quitar el cambio, el día vuelve al horario habitual.
- Vacaciones, permisos y otras ausencias, por rango de fechas. Tipos: Vacaciones, Permiso y Otro. No se guardan motivos médicos ni datos de salud. Las ausencias de una misma trabajadora no se pueden solapar.
- Debe quedar claro qué turnos son habituales y cuáles son excepciones.
- Una excepción nunca modifica el horario habitual ni sus versiones.

**Prioridad para cada trabajadora y día:** baja (después de su último día de trabajo, o en un periodo de baja anterior) → ausencia → cambio de ese día → horario habitual vigente → sin horario.

**Turnos y cálculo de horas:**
- Si la hora de fin es igual o anterior a la de inicio, el turno acaba al día siguiente (22:00-02:00). No se admite inicio igual a fin.
- Un turno que pasa de medianoche cuenta **entero en el día en que empieza** (y en su semana).
- No se admiten turnos solapados, tampoco cuando un turno nocturno se alarga hasta el día siguiente, ni en el horario habitual (incluido el domingo con el lunes) ni en las excepciones.
- Las horas son **horas reales en Europe/Madrid**:
  - la noche del cambio al horario de verano (último domingo de marzo) dura una hora menos y la del cambio al de invierno (último domingo de octubre), una más;
  - una hora que no existe por el cambio al horario de verano (de 02:00 a 02:59 el último domingo de marzo) no se corrige: se muestra un error comprensible y se pide modificar el turno;
  - una hora que se repite por el cambio al horario de invierno (de 02:00 a 02:59 el último domingo de octubre) se toma como su **primera aparición, todavía en horario de verano (UTC+2)**. Ejemplo: 01:00-03:00 son 3 horas reales; 02:30-06:00 son 4 h 30 min.
- Totales por día, por semana (lunes-domingo), por trabajadora y de toda la plantilla.

**Integración:**
- Las trabajadoras inactivas no aparecen en la planificación posterior a su baja (ver 3.6).
- Los festivos solo se marcan en el calendario a modo informativo: no cambian las horas previstas.
- Las horas extra no cambian. Queda preparada (sin mostrarse todavía) la comparación entre horas previstas y horas extra registradas; las horas extra se siguen introduciendo a mano (3.7).

**Resumen de horas planificadas** (`/horarios?vista=resumen`, pestaña «Resumen de horas» junto al calendario; misma navegación entre semanas):
- Por trabajadora: horas planificadas de la semana y reparto de los días (con turnos, descanso, libre, ausencia, baja, horario cerrado, cambios de un día), con enlace a su ficha.
- Total planificado de la tienda y cuántas trabajadoras tienen planificación.
- «Sin planificación» (sin horario ni cambios esa semana) se distingue de una planificación de **0 h** (por ejemplo, ausente toda la semana).
- No muestra horas extra (la comparación sigue solo preparada).
- Solo consulta: no modifica horarios, excepciones, ausencias ni horas extra. Sin nóminas, compensaciones ni fichajes.

**Baja frente a horario cerrado** (calendario y resumen): un día sin horario por una versión de cierre se marca como «Baja» si la trabajadora está de baja, o si es un periodo de baja anterior seguido de un horario nuevo. Si sigue activa y su último horario está cerrado sin ninguna versión posterior (por ejemplo, reactivada sin copiar el horario), se marca como «Horario cerrado».

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
- Asignación automática de personal, fichajes y control horario real (el calendario de 3.9 es una planificación prevista).

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
11. Puede configurar el horario habitual de cada trabajadora, gestionar excepciones y ausencias, y consultar el calendario semanal con las horas previstas, sin que las excepciones alteren el horario habitual.
12. La aplicación funciona en móvil y ordenador.
13. Los datos no son accesibles sin autorización.
