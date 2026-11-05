# Modelo de datos — Gestión de tienda MVP

**Estado:**
- `profiles`: implementada y aplicada en el proyecto de Supabase (Fase 1).
- `employees` y `overtime_entries`: implementadas y aplicadas en el proyecto de Supabase (Fase 2); falta confirmar la ejecución de `staff_rls_checks.sql` allí.
- `suppliers`, `orders` y `holidays`: implementadas en la migración `20261028221500_suppliers_orders_holidays.sql`, aplicada en el proyecto de Supabase con sus comprobaciones correctas (Fase 3).
- `supplier_products`: implementada en la migración `20261029214500_supplier_products.sql`, preparada y **pendiente de aplicar** en el proyecto remoto (Fase 3, Bloque 4).
- Resto de tablas: propuesta inicial; revisar antes de crear sus migraciones.

## Convenciones

- PostgreSQL mediante Supabase.
- Fechas de negocio almacenadas como `date`; marcas temporales como `timestamptz`.
- Identificadores UUID.
- La duración de horas extra se almacena como minutos enteros (`duration_minutes`).
- No guardar datos innecesarios.
- Las entidades operativas se desactivan mediante `is_active` cuando haya historial que conservar, en lugar de borrarlas físicamente.

## Tablas propuestas

### `profiles`
Lista explícita de cuentas autorizadas: una fila por cada cuenta de Supabase Auth que puede usar la aplicación (decisión tomada: opción A, ver *Seguridad (RLS)*). En el MVP habrá una sola fila, la de la encargada.
- `id uuid primary key references auth.users(id) on delete cascade`
- `display_name text null`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`. Se actualiza con el trigger `private.set_updated_at()`.

No guarda contraseñas, correos ni secretos: las credenciales las gestiona Supabase Auth. Las filas se añaden y se retiran a mano desde el panel de Supabase; los clientes solo pueden leer su propia fila.

Implementada en `supabase/migrations/20261028095000_profiles_authorization.sql`.

No se crea una tabla de cuentas para trabajadoras.

### `employees`
- `id uuid primary key default gen_random_uuid()`
- `first_name text not null`, con `check (first_name ~ '[^[:space:]]')`
- `last_name text not null`, con `check (last_name ~ '[^[:space:]]')`
- `role text null`: puesto o función en la tienda (texto libre). No tiene relación con los roles de la base de datos.
- `notes text null`
- `is_active boolean not null default true`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`. Se actualiza con el trigger `private.set_updated_at()`.

Decisiones:
- **Nombre y apellidos no pueden estar vacíos** ni contener solo espacios, tabuladores o saltos de línea. Lo rechaza la base de datos además del formulario. Otros caracteres invisibles poco habituales, como el espacio de no separación, no se detectan: el formulario debe recortar los espacios antes de guardar.
- **No se borran:** los clientes no tienen el privilegio `DELETE`. Las trabajadoras se desactivan con `is_active = false` y conservan su historial.
- **`last_working_date date null`** (migración de horarios, 20261105100000): último día trabajado, incluido, de una trabajadora dada de baja. Restricción `last_working_date is null or is_active = false`. La fija `public.deactivate_employee()` y la quita `public.reactivate_employee()`. Las trabajadoras desactivadas antes de esta migración quedan sin fecha. Ver *Horarios del personal*.

### `overtime_entries`
- `id uuid primary key default gen_random_uuid()`
- `employee_id uuid not null references employees(id) on delete restrict`
- `work_date date not null`
- `duration_minutes integer not null`, con `check (duration_minutes > 0 and duration_minutes <= 1440)`
- `reason text null`
- `notes text null`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`. Se actualiza con el trigger `private.set_updated_at()`.

Decisiones:
- **Duración:** de 1 a 1440 minutos (24 horas) por registro. Evita ceros, negativos y errores de tecleo evidentes. Un valor decimal se rechaza: la app debe convertir horas y minutos a un entero antes de enviarlo.
- **Varios registros por trabajadora y día:** permitidos. No hay restricción de unicidad: los totales simplemente suman.
- **Corrección de errores:** los registros se pueden editar y también **eliminar** (por ejemplo, un duplicado). Es la única tabla de esta fase con `DELETE`.
- **`on delete restrict`:** no se puede borrar una trabajadora que tenga registros, ni siquiera desde el panel de Supabase. Así se protege el historial.
- **Fecha:** `work_date` es una fecha sin hora. La app propone el día actual en la zona horaria de la tienda (`Europe/Madrid`).
- **Reglas que aplica solo la aplicación** (la base de datos no las impone):
  - al registrar, solo se puede elegir un empleado activo; al editar, se mantiene también el ya asociado aunque esté inactivo, para poder corregir registros antiguos;
  - la fecha no puede ser posterior a hoy;
  - motivo de 200 caracteres como máximo y observaciones de 1000.

Los totales semanales/mensuales se calculan a partir de los registros filtrados por fecha; no se guardan acumulados que puedan quedar desactualizados.

`employees` y `overtime_entries` están implementadas en `supabase/migrations/20261028125000_employees_overtime.sql`, con sus comprobaciones en `supabase/tests/staff_rls_checks.sql`.

### `suppliers`
- `id uuid primary key default gen_random_uuid()`
- `name text not null`, con `check (name ~ '[^[:space:]]')`
- `delivery_weekdays smallint[] not null default '{}'`: días habituales de entrega, 1 = lunes … 7 = domingo (ISO 8601). Restricción: una dimensión, sin nulos y con valores de 1 a 7.
- `order_lead_days smallint not null default 1`, con `check (order_lead_days between 0 and 7)`: antelación por defecto con la que se prepara el pedido (0 = el mismo día).
- `lead_days_overrides jsonb not null default '{}'`: antelación distinta según el día de entrega, `{"<día ISO 1-7>": <0-7>}` (por ejemplo `{"1": 3}`). Los días que no aparecen usan `order_lead_days`. Restricción `suppliers_lead_days_overrides_valid` (función inmutable `private.is_valid_lead_days_overrides`): un objeto, claves que son días de entrega y valores enteros de 0 a 7. *(Migración `20261104130000_supplier_schedule_rules.sql`.)*
- `delivery_every_weeks smallint not null default 1`: 1 = cada semana, 2 = cada dos semanas (`check in (1, 2)`).
- `delivery_anchor_date date null`: solo en quincenales, una fecha de entrega de referencia; tocan las semanas (de lunes a domingo) a un número par de semanas de ella. Obligatoria si `delivery_every_weeks = 2` y vacía si es 1.
- `order_mode text not null default 'scheduled'`: `scheduled` (días fijos: la agenda genera previsiones) u `on_demand` (a demanda: sin previsiones; los días de entrega son los días posibles). Un proveedor a demanda no puede ser quincenal.
- `order_deadline time null`: hora límite (hora de la tienda) para hacer el pedido el día que se prepara; sin segundos.
- `notes text null`
- `is_active boolean not null default true`
- `created_at timestamptz not null default now()`. La agenda no genera previsiones con preparación anterior a este día (hora de la tienda).
- `updated_at timestamptz not null default now()`. Se actualiza con el trigger `private.set_updated_at()`.

Decisiones:
- **Nombre único:** índice único `suppliers_name_unique_idx` sobre una clave normalizada del nombre: `normalize(name, NFC)`, espacios repetidos reducidos a uno y recortados, acentos de las vocales quitados con `translate` (agudos, graves, circunflejos y diéresis, en mayúsculas y minúsculas) y `lower`. No distingue mayúsculas, acentos ni espacios: «Panadería Sol» y «panaderia  sol» son el mismo proveedor. «ñ» y «ç» se consideran letras propias («Peña» y «Pena» son distintos). Incluye a los inactivos (se reactiva el existente en lugar de duplicarlo). Solo usa funciones incluidas en PostgreSQL, sin extensiones, y funciona igual con la configuración regional `C`. La app aplica la misma regla (`getSupplierNameKey` en `app/utils/suppliers.js`) para avisar antes de guardar; con letras fuera de esa lista (por ejemplo «Õ») puede ser algo más estricta que la base de datos, nunca menos.
- **Días de entrega:** la base de datos garantiza el rango; la app los guarda ordenados y sin repetir. Una lista vacía significa que el proveedor no genera previsiones, aunque admite pedidos manuales.
- **Calendario** (migración `20261104130000`): antelación general con excepciones por día, frecuencia semanal o quincenal, modo de pedido (días fijos o a demanda) y hora límite. Son columnas de `suppliers` (y no una tabla aparte) para que el proveedor y su calendario se guarden en una sola escritura, sin estados a medias. Los valores por defecto reproducen el comportamiento anterior. La app solo guarda las antelaciones por día que difieren de la general. Cada pedido puede seguir teniendo su propia fecha de preparación.
- **No se borran:** los clientes no tienen el privilegio `DELETE`. Se desactivan con `is_active = false`.
- **Reglas que aplica solo la aplicación:** nombre de 80 caracteres como máximo y notas de 1000; un proveedor inactivo no genera previsiones ni admite pedidos nuevos.

### `supplier_products`
Productos habituales de cada proveedor (Bloque 4; ver `SPEC.md`, 3.3).
- `id uuid primary key default gen_random_uuid()`
- `supplier_id uuid not null references suppliers(id) on delete restrict`
- `name text not null`, con `check (name ~ '[^[:space:]]')`
- `unit text not null`, con `check (unit ~ '[^[:space:]]')`: unidad en texto libre.
- `usual_quantity numeric(10,2) not null`, con `check (usual_quantity > 0 and usual_quantity <= 99999.99)`
- `is_active boolean not null default true`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`. Se actualiza con el trigger `private.set_updated_at()`.

Decisiones:
- **Nombre único por proveedor:** índice único `supplier_products_name_unique_idx` sobre `(supplier_id, clave normalizada del nombre)`, con la misma clave que `suppliers_name_unique_idx` (sin mayúsculas, acentos de las vocales ni espacios repetidos; «ñ» y «ç» se conservan). Incluye los inactivos. Dos proveedores pueden tener productos con el mismo nombre. El índice empieza por `supplier_id`, así que también sirve para listar los productos de un proveedor y para la clave foránea.
- **No se borran:** los clientes no tienen el privilegio `DELETE`. Se desactivan con `is_active = false`. Así, cuando existan líneas de pedido, ningún pedido se quedará sin su producto (su clave foránea deberá usar `on delete restrict`).
- **No cambian de proveedor:** `authenticated` solo puede modificar `name`, `unit`, `usual_quantity` e `is_active` (privilegio `UPDATE` por columnas).
- **Cantidad habitual:** referencia inicial para preparar pedidos, no una obligación ni stock. Con decimales (2,5 kg); la app admite coma o punto y como máximo dos decimales.
- **Reglas que aplica solo la aplicación:** nombre de 80 caracteres como máximo y unidad de 20.

### Líneas de pedido (todavía no)

La tabla `order_lines` de la propuesta inicial **no se crea** por ahora: el contenido de cada pedido se sigue anotando en `orders.notes`. Si más adelante se añade, cada línea referenciará `supplier_products` con `on delete restrict` y guardará su propia cantidad (la habitual solo será el valor inicial).

### `orders`
- `id uuid primary key default gen_random_uuid()`
- `supplier_id uuid not null references suppliers(id) on delete restrict`
- `scheduled_delivery_date date null`: entrega prevista por el calendario de la que procede el pedido. `null` en los pedidos creados a mano.
- `delivery_date date not null`
- `prepare_date date not null`, con `check (prepare_date <= delivery_date)`
- `status text not null default 'pending'`, con `check (status in ('pending', 'prepared', 'skipped'))`
- `prepared_at timestamptz null`, con `check ((status = 'prepared') = (prepared_at is not null))`
- `notes text null`: contenido del pedido y observaciones, en texto libre.
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`. Se actualiza con el trigger `private.set_updated_at()`.
- Únicos: `orders_supplier_delivery_unique (supplier_id, delivery_date)` y `orders_supplier_scheduled_unique (supplier_id, scheduled_delivery_date)`.

Decisiones:
- **Agenda calculada, no guardada.** Las previsiones se calculan en la app a partir de `suppliers` (días de entrega, antelación de cada día, frecuencia y modo; los proveedores a demanda no generan previsiones, y no se prevé nada anterior al alta del proveedor) para los próximos 14 días y los 7 anteriores. Solo se guarda una fila cuando la encargada actúa sobre una previsión (marcarla como preparada o «no se pide», corregir fechas, escribir notas) o crea un pedido a mano. Abrir la app, recargarla o cambiar de día no escribe nada.
- **Sin duplicados.** Como mucho un pedido por proveedor y fecha de entrega, y cada previsión se convierte como mucho en un pedido (dos dispositivos que actúan a la vez sobre la misma previsión: el segundo recibe `23505`, la API responde 409, y la app recarga y avisa). La app usa `insert` y no `upsert`, para no sobrescribir cambios hechos desde otro dispositivo.
- **Pedido movido.** `scheduled_delivery_date` no cambia al corregir las fechas, así la previsión original no vuelve a aparecer. Una previsión se oculta si ya existe un pedido del mismo proveedor con esa fecha como `scheduled_delivery_date` o como `delivery_date`.
- **Estados:** `pending` (pendiente), `prepared` (preparado) y `skipped` (no se pide: descarta una previsión, por ejemplo por un festivo; no cuenta como pendiente ni atrasado). Desde cualquier estado se puede volver a `pending`.
- **`prepared_at`** lo mantiene el trigger `orders_set_prepared_at` (función `private.set_order_prepared_at()`) con la hora del servidor: se fija al pasar a `prepared`, se conserva mientras siga preparado y se vacía en cualquier otro estado. Lo que envíe el cliente se ignora.
- **Columnas protegidas.** `authenticated` solo puede modificar `delivery_date`, `prepare_date`, `status` y `notes` (privilegio `UPDATE` por columnas). El proveedor y la entrega prevista de origen no cambian una vez creado el pedido.
- **Eliminación.** Solo pedidos pendientes (política `orders_delete_pending_authorized`). Un `DELETE` sobre un pedido preparado o descartado no da error, pero no afecta a ninguna fila. Para eliminarlo habría que volver a ponerlo como pendiente.
- **`on delete restrict`:** no se puede borrar un proveedor con pedidos, ni siquiera desde el panel.
- **Reglas que aplica solo la aplicación:** notas de 1000 caracteres como máximo; no se crean pedidos para proveedores inactivos.

### `shop_settings`
- `id smallint primary key default 1`, con `check (id = 1)`: una sola fila.
- `municipality_code text null`, código INE de 5 cifras (`check ~ '^[0-9]{5}$'`), y `municipality_name text null`: van juntos (los dos vacíos o los dos con valor).
- `holidays_synced_at timestamptz null`: última actualización correcta de los festivos oficiales.
- `created_at`, `updated_at` (trigger `private.set_updated_at()`).
- RLS: la cuenta autorizada puede leer, crear y modificar; nadie puede borrar. `anon` sin privilegios.
- No convierte la app en multitienda: solo indica en qué municipio está la única tienda.

### `holidays`
- `id uuid primary key default gen_random_uuid()`
- `holiday_date date not null`, único (`holidays_holiday_date_unique`)
- `name text not null`, con `check (name ~ '[^[:space:]]')`
- `scope text not null`, con `check (scope in ('national', 'regional', 'local'))`: nacional, autonómico o local.
- `notes text null`
- `source text not null default 'manual'`, con `check (source in ('manual', 'official'))`: `official` = importado por la app del calendario oficial de la Generalitat (migración `20261104160000_shop_settings_official_holidays.sql`).
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`. Se actualiza con el trigger `private.set_updated_at()`.

Decisiones:
- **Oficiales y manuales.** La app mantiene los festivos `official` del año actual y del siguiente a partir de los datos abiertos de la Generalitat (datasets `yf2b-mjr6` y `b4eh-r8up`) y del municipio de `shop_settings`. Nunca toca los `manual`. Editar uno oficial lo convierte en manual. La consulta se hace desde el navegador, sin clave, y solo envía el código del municipio.
- **Una fila por fecha:** basta para avisar. Si un festivo es a la vez de dos ámbitos, se elige uno y se anota en `notes`.
- **Se pueden corregir y eliminar:** no tienen historial que conservar.
- **Solo avisos.** Un festivo en la fecha de entrega genera un aviso que recomienda confirmar la entrega con el proveedor; nunca mueve ni cancela pedidos.

`suppliers`, `orders` y `holidays` están implementadas en `supabase/migrations/20261028221500_suppliers_orders_holidays.sql`, con sus comprobaciones en `supabase/tests/orders_rls_checks.sql`.

### Horarios del personal

Implementados en `supabase/migrations/20261105100000_employee_schedules.sql`, con sus comprobaciones en `supabase/tests/employee_schedules_checks.sql`. Sustituyen a la propuesta anterior de `employee_regular_schedules` (una fila por día, sin versiones), que no permitía conservar los horarios anteriores. Alcance funcional: `SPEC.md`, 3.6 y 3.9.

**Formato de los turnos** (`jsonb`, validado con funciones del esquema `private`):
- Un día: `[{"start":"07:00","end":"14:00"}, {"start":"17:00","end":"20:00"}]`. Como mucho 3 turnos; cada uno con exactamente `start` y `end` en formato `HH:MM` (de `00:00` a `23:59`); `[]` = descanso o día libre.
- Inicio distinto de fin. Si `end` es anterior o igual a `start`, el turno acaba al día siguiente y cuenta entero en el día en que empieza.
- Sin solapamientos dentro del día. Acabar a las 06:00 y empezar a las 06:00 no es solapamiento.
- Una semana: `{"1": [turnos], …, "7": [turnos]}` (día ISO, 1 = lunes). Un día que falta es descanso. Un turno nocturno no puede pisar el día siguiente, incluido el domingo con el lunes (la semana se repite).

#### `employee_schedules` (versiones del horario habitual)
- `id uuid primary key default gen_random_uuid()`
- `employee_id uuid not null references employees(id) on delete restrict`
- `valid_from date not null`: desde cuándo rige. Rige hasta el día antes de la versión siguiente.
- `kind text not null default 'schedule'`: `schedule` (horario semanal) o `end` (sin horario desde `valid_from`; se crea al dar de baja). En la interfaz, un `end` sin versión posterior de una trabajadora que sigue activa se muestra como «Horario cerrado»; en los demás casos, como «Baja».
- `week jsonb null`: obligatoria y válida si `kind = 'schedule'`; nula si `kind = 'end'`.
- `notes text null`, `created_at`, `updated_at` (trigger `private.set_updated_at()`).
- `unique (employee_id, valid_from)`.

Decisiones:
- **Sin solapes por diseño:** una versión acaba siempre el día antes de la siguiente.
- **Huecos permitidos:** antes de la primera versión no hay horario (incorporación futura o sin horario registrado); después de una versión `end`, tampoco.
- **Solo se añaden al final:** la nueva versión debe ser posterior a la última (trigger, `PS001`). Como pronto, el lunes de la semana actual (`PS002`), salvo la primera versión de cada trabajadora, que puede tener cualquier fecha para la carga inicial.
- **Historial inmutable:** las versiones vigentes o pasadas no se pueden editar ni borrar (RLS: solo `valid_from > hoy`). De las futuras solo se pueden editar `week` y `notes`.
- **Límite entre versiones:** el primer día de una versión no puede chocar con un turno nocturno del día anterior; al editar una versión futura que tiene otra detrás, su último día tampoco puede chocar con la siguiente (`PS003`).

#### `employee_day_overrides` (cambios de un día)
- `id`, `employee_id` (`on delete restrict`), `work_date date not null`
- `shifts jsonb not null default '[]'`: turnos de ese día; `[]` = día libre.
- `notes`, `created_at`, `updated_at`.
- `unique (employee_id, work_date)`.

Decisiones:
- **Nunca modifican el horario habitual:** no hay claves, cascadas ni triggers que escriban en `employee_schedules`. Borrar el cambio devuelve el día al horario habitual.
- **Solapamientos con los días vecinos:** se comprueban con lo que rige el día anterior (un turno nocturno que llega a este día) y el siguiente (`PS003`).
- **Horas que no existen** el día del cambio al horario de verano: se rechazan (`PS004`), también cuando es el fin de un turno nocturno.
- `employee_id` y `work_date` no se pueden modificar.

#### `employee_absences` (vacaciones, permisos y otras ausencias)
- `id`, `employee_id` (`on delete restrict`)
- `absence_type text not null`: `vacation` (Vacaciones), `leave` (Permiso) u `other` (Otro). Sin tipos médicos.
- `start_date date not null`, `end_date date not null` (ambas incluidas), con `check (end_date >= start_date)`.
- `notes`, `created_at`, `updated_at`. Las observaciones no deben contener motivos médicos ni datos de salud (lo avisa el formulario).
- Índice `(employee_id, start_date)`.

Decisiones:
- **No se solapan** las ausencias de una misma trabajadora (trigger con bloqueo de la fila de la trabajadora, `PS005`). Se eligió un trigger en lugar de una restricción de exclusión para no activar la extensión `btree_gist`.
- `employee_id` no se puede modificar.

#### Prioridad de cada día
La base de datos (`private.planned_shifts`, para validar) y la app (para mostrar) aplican la misma regla:
1. Fecha posterior a `employees.last_working_date` → sin turnos (baja).
2. Versión vigente de tipo `end` → sin turnos (periodo de baja anterior). Los cambios y ausencias de esas fechas se ignoran.
3. Ausencia que cubre la fecha → sin turnos.
4. Cambio de ese día → sus turnos.
5. Versión vigente de tipo `schedule` → turnos de ese día de la semana.
6. Sin versión → sin horario.

**Qué impide la base de datos y qué avisa la app.** La base de datos rechaza los solapamientos directos: dentro de un día, entre días de una semana, en el límite entre versiones y entre un cambio de un día y sus días vecinos. Un conflicto que aparece por un cambio hecho en otro sitio (por ejemplo, borrar una ausencia que ocultaba un cambio) no se rechaza: la app lo marca como «Turnos solapados» para que se corrija.

#### Baja y reactivación
- **`public.deactivate_employee(p_employee_id uuid, p_last_working_date date) returns jsonb`**, en una sola transacción:
  1. Comprueba que el último día no es posterior a hoy y que no hay un horario que ya haya empezado después de esa fecha (`PS007`).
  2. Elimina solo la planificación **posterior a hoy**: versiones, cambios de un día y ausencias que empiezan después de hoy. Acorta hasta hoy las ausencias en curso.
  3. Crea una versión `end` desde el día siguiente al último día (si tenía horario).
  4. Pone `is_active = false` y `last_working_date`.

  Devuelve `{last_working_date, deleted_schedules, deleted_day_changes, deleted_absences, shortened_absences, closed_schedule}`.

  Nunca elimina ni modifica versiones vigentes o pasadas ni horas extra. Si el último día es anterior a hoy, los cambios y ausencias entre ese día y hoy se conservan (no son futuros), pero no se muestran porque caen después de la baja. La app enseña antes lo que se eliminará con las mismas condiciones.
- **`public.reactivate_employee(p_employee_id uuid, p_return_date date, p_copy_schedule boolean default true) returns jsonb`**, en una sola transacción:
  1. La fecha de vuelta debe ser posterior al último día (`PS007`).
  2. Pone `is_active = true` y quita `last_working_date`.
  3. Si la vuelta coincide con el día de cierre del horario y ese cierre todavía no ha empezado, quita el cierre y sigue el horario anterior (deshacer una baja del mismo día).
  4. Si no, y se pide, copia el último horario semanal desde la fecha de vuelta (con las reglas de fecha mínima y solapamientos).

  Devuelve `{return_date, restored_previous_schedule, copied_schedule}`.
- Las dos son `SECURITY INVOKER` (RLS y triggers se siguen aplicando), con `search_path` vacío, `EXECUTE` solo para `authenticated`, y comprueban `private.is_authorized()`. Son las primeras funciones del proyecto que la app llama con `supabase.rpc`.
- **Protección sin las funciones** (trigger en `employees`): con fecha de baja no puede quedar planificación posterior a hoy ni un horario vigente después de la baja (`PS009`); la fecha no puede ser posterior a hoy (`PS007`) ni cambiarse sin reactivar antes (`PS008`). Una trabajadora con planificación no se puede desactivar sin fecha (`PS009`). Las trabajadoras sin planificación se siguen desactivando y activando como antes.
- **Planificación de una trabajadora desactivada:** no se puede crear, modificar ni borrar (`PS006`). Su historial queda de solo lectura.
- **En la app** (`app/utils/employee-leave.js` y `useEmployeeLeave`):
  - con planificación, la baja y la reactivación usan estas funciones;
  - sin planificación, una sola actualización de `employees` (`is_active` y `last_working_date`), como antes;
  - la vista previa de la baja aplica las mismas condiciones que `deactivate_employee`.

  `EMPLOYEE_COLUMNS` no incluye `last_working_date`: la fecha se lee solo al reactivar. Así, el listado de empleados y la pantalla de horas extra funcionan igual aunque la migración no esté aplicada.

#### Errores de reglas de negocio
Las funciones y triggers usan SQLSTATE propios, con un mensaje en castellano y la fecha relevante en `detail` (`AAAA-MM-DD`). La app muestra su propio texto según el código, nunca el mensaje técnico.

| Código | Significado |
| --- | --- |
| `PS001` | La nueva versión no es posterior a la última registrada. |
| `PS002` | La nueva versión empieza antes del lunes de la semana actual. |
| `PS003` | Un turno se solapa con un turno nocturno del día anterior o con el día siguiente. |
| `PS004` | Una hora no existe ese día por el cambio al horario de verano. |
| `PS005` | La ausencia se solapa con otra de la misma trabajadora. |
| `PS006` | La trabajadora está desactivada o la fecha cae en un periodo de baja. |
| `PS007` | Fecha de baja o de vuelta no válida. |
| `PS008` | Ya está dada de baja / ya está activa / la fecha de baja no se cambia sin reactivar. |
| `PS009` | La baja dejaría planificación posterior o no tiene fecha. |
| `PS010` | Cierre de horario no válido o que no se puede quitar. |

Errores habituales además de estos: `23514` (formato de turnos o datos no válidos), `23505` (versión o cambio duplicado), `42501` (sin permiso), `P0002` (la trabajadora no existe) y `22004` (faltan datos en la llamada).

#### Cálculo de horas (app)
- Se convierte cada inicio y fin (fecha + hora local de Madrid) a un instante UTC y se restan: son **horas reales**. Un 22:00-06:00 dura 8 h; 7 h la noche del último domingo de marzo y 9 h la del último domingo de octubre.
- **Hora inexistente** (de 02:00 a 02:59 el último domingo de marzo): no se corrige. La app muestra un error y pide modificar el turno. En un cambio de un día la base de datos también la rechaza (`PS004`). En el horario habitual no se puede rechazar al guardar (la semana se repite), así que la app marca ese día concreto con el error y propone cambiar el turno de ese día.
- **Hora repetida** (de 02:00 a 02:59 el último domingo de octubre): se toma su **primera aparición, en horario de verano (UTC+2)**, tanto en el inicio como en el fin. Así 01:00-03:00 dura 3 h, 02:30-06:00 dura 4 h 30 min y 02:15-02:45, 30 min. Es un criterio fijo y documentado; la base de datos no calcula duraciones.
- Totales por día (turnos que empiezan ese día), por semana (lunes-domingo), por trabajadora y de toda la plantilla.
- **Comparación preparada:** `buildPlannedVsOvertime` (`app/utils/schedules.js`) devuelve, por trabajadora y periodo, los minutos previstos y los de `overtime_entries` (por `work_date`). Todavía no se muestra y no cambia nada de horas extra.
- Toda esta lógica está en `app/utils/schedules.js` (sin dependencias de Nuxt ni de Supabase), con pruebas en `tests/unit/schedules.test.js`.
- **Excepciones en la app** (`app/utils/schedule-exceptions.js`):
  - antes de guardar un cambio de un día o una ausencia se aplican las mismas comprobaciones que los triggers (turnos, días vecinos, cambios de hora, solapes de ausencias y periodos laborales);
  - con una ausencia ese día, la app no deja editar sus turnos: la ausencia prevalece;
  - los cambios se guardan con `insert` o con `update` por `id` (no con `upsert`, que intentaría modificar `employee_id` y `work_date`, columnas que no se pueden actualizar).

## Seguridad (RLS)

- Activar RLS en todas las tablas.
- En el MVP, solo el usuario autenticado autorizado debe poder leer y modificar los datos.
- No confiar únicamente en ocultar rutas o botones del frontend.
- No incluir `service_role` ni otros secretos privilegiados en el cliente.
- Antes de desplegar, probar expresamente que un usuario no autenticado no puede leer ni modificar registros.
- Si el proyecto usa una única cuenta autorizada, limitar el acceso mediante políticas explícitas a esa identidad, sin políticas abiertas a cualquier usuario autenticado.

### Modelo de autorización (decidido)

Opción A: **`public.profiles` es la lista de cuentas autorizadas**. Estar autenticado no basta: la cuenta debe tener fila en `profiles`.

- **`private.is_authorized()`** devuelve `true` si `auth.uid()` tiene fila en `profiles`.
  - Es `SECURITY DEFINER`, con `search_path` vacío, sin parámetros y con propietario `postgres`.
  - `EXECUTE` solo para `authenticated`.
  - Vive en el esquema `private`, que no se expone en la Data API. En él solo el propietario puede crear o modificar objetos.
- **`profiles`**:
  - Tiene RLS activo y una única política: `profiles_select_own` (`SELECT`, cada cuenta solo ve su propia fila).
  - `authenticated` solo tiene el privilegio `SELECT` y `anon` no tiene ninguno.
  - No hay políticas de `INSERT`, `UPDATE` ni `DELETE`, así que ningún cliente puede añadirse, modificarse ni retirarse.
- **Altas y bajas de autorización:** se hacen a mano desde el SQL Editor de Supabase (rol `postgres`). Ver `SUPABASE_SETUP.md`.

### Permisos de las tablas de la Fase 2

| Tabla | `anon` | `authenticated` (si `private.is_authorized()`) |
| --- | --- | --- |
| `employees` | ninguno | `SELECT`, `INSERT`, `UPDATE` |
| `overtime_entries` | ninguno | `SELECT`, `INSERT`, `UPDATE`, `DELETE` |

### Permisos de las tablas de la Fase 3

| Tabla | `anon` | `authenticated` (si `private.is_authorized()`) |
| --- | --- | --- |
| `suppliers` | ninguno | `SELECT`, `INSERT`, `UPDATE` |
| `orders` | ninguno | `SELECT`, `INSERT`; `UPDATE` solo de `delivery_date`, `prepare_date`, `status` y `notes`; `DELETE` solo de pedidos con `status = 'pending'` |
| `holidays` | ninguno | `SELECT`, `INSERT`, `UPDATE`, `DELETE` |
| `supplier_products` | ninguno | `SELECT`, `INSERT`; `UPDATE` solo de `name`, `unit`, `usual_quantity` e `is_active` (Bloque 4) |

### Permisos de las tablas de horarios (Fase 5)

| Tabla | `anon` | `authenticated` (si `private.is_authorized()`) |
| --- | --- | --- |
| `employee_schedules` | ninguno | `SELECT`, `INSERT`; `UPDATE` solo de `week` y `notes` y `DELETE`, ambos solo de versiones futuras (`valid_from` posterior a hoy en Madrid) |
| `employee_day_overrides` | ninguno | `SELECT`, `INSERT`, `DELETE`; `UPDATE` solo de `shifts` y `notes` |
| `employee_absences` | ninguno | `SELECT`, `INSERT`, `DELETE`; `UPDATE` solo de `absence_type`, `start_date`, `end_date` y `notes` |
| `employees` | sin cambios | sin cambios (la columna nueva `last_working_date` entra en el `UPDATE` de la tabla) |
| `public.deactivate_employee`, `public.reactivate_employee` | sin `EXECUTE` | `EXECUTE` |

Ninguno de los dos roles tiene `TRUNCATE`, `REFERENCES` ni `TRIGGER`. Una cuenta autenticada pero no autorizada tiene los privilegios de tabla, pero las políticas no le dejan ver ni crear filas. Sus `UPDATE` y `DELETE` no afectan a ninguna fila (la API responde `200` con una lista vacía).

### Regla para cada tabla de negocio

Toda tabla nueva del esquema `public` debe incluir, **en la misma migración que la crea**:

```sql
alter table public.<tabla> enable row level security;
-- Supabase concede por defecto todos los privilegios (incluido TRUNCATE, que
-- no respeta RLS). Se retiran y se concede solo lo necesario.
revoke all on table public.<tabla> from anon, authenticated;
grant select, insert, update on table public.<tabla> to authenticated;

create policy "<tabla>_select_authorized" on public.<tabla>
  for select to authenticated using ((select private.is_authorized()));
create policy "<tabla>_insert_authorized" on public.<tabla>
  for insert to authenticated with check ((select private.is_authorized()));
create policy "<tabla>_update_authorized" on public.<tabla>
  for update to authenticated
  using ((select private.is_authorized()))
  with check ((select private.is_authorized()));
-- DELETE solo si la tabla permite borrado físico (ver decisión 4 de «Decisiones pendientes»);
-- en las entidades con historial se usa is_active. Si se permite, se añade
-- `delete` al grant y una política:
-- create policy "<tabla>_delete_authorized" on public.<tabla>
--   for delete to authenticated using ((select private.is_authorized()));
```

Si la tabla usa `updated_at`, se añade también el trigger con `private.set_updated_at()`.

**Pruebas SQL:** cada migración tiene su propio script de comprobaciones en `supabase/tests/`, con el mismo patrón que `authorization_checks.sql`:
- `authorization_checks.sql`: `profiles` y `private.is_authorized()` (Fase 1). No se amplía con tablas nuevas, para que su resultado verificado no cambie.
- `staff_rls_checks.sql`: `employees` y `overtime_entries` (Fase 2).
- `orders_rls_checks.sql`: `suppliers`, `orders` y `holidays` (Fase 3).
- `supplier_products_rls_checks.sql`: `supplier_products` (Fase 3, Bloque 4).
- `employee_schedules_checks.sql`: horarios, cambios de un día, ausencias, baja y reactivación (Fase 5).
- Las fases siguientes añaden su propio archivo.

Cada script comprueba la configuración (RLS, políticas, privilegios, restricciones) y simula peticiones sin sesión, con una sesión no autorizada y con la cuenta autorizada. Si necesita datos, los crea y los deshace al terminar. No deja cambios en la base de datos. Los UUID reales se escriben solo en la copia que se pega en el SQL Editor, nunca en el archivo versionado.

Nunca se crean políticas `using (true)` ni políticas basadas solo en `auth.role() = 'authenticated'`.

## Índices recomendados

- `overtime_entries(employee_id, work_date)`: creado en la migración de la Fase 2 (`overtime_entries_employee_id_work_date_idx`).
- `orders(prepare_date)`: agenda. Creado en la migración de la Fase 3 (`orders_prepare_date_idx`).
- `orders(delivery_date)`: historial. Creado en la migración de la Fase 3 (`orders_delivery_date_idx`).
- `orders(supplier_id, delivery_date)`: lo cubre la restricción única `orders_supplier_delivery_unique`.
- `supplier_products(supplier_id, …)`: lo cubre el índice único `supplier_products_name_unique_idx`.
- `employee_absences(employee_id, start_date)`: creado en la migración de horarios (`employee_absences_employee_id_start_date_idx`).
- `employee_schedules(employee_id, valid_from)` y `employee_day_overrides(employee_id, work_date)`: los cubren sus restricciones únicas.

## Decisiones pendientes antes de migrar

1. ~~Confirmar cómo se representará el horario habitual: uno o varios intervalos por día.~~ **Decidido:** hasta 3 turnos por día, en versiones con fecha de inicio (ver *Horarios del personal*).
2. ~~Confirmar si se pueden registrar dos pedidos del mismo proveedor en una fecha.~~ **Decidido:** como mucho uno por proveedor y fecha de entrega.
3. ~~Elegir la forma de restringir RLS al usuario autorizado.~~ **Decidido:** opción A, tabla `profiles` y función `private.is_authorized()` (ver *Modelo de autorización*).
4. ~~Decidir si los proveedores se desactivan siempre o si se permite borrarlos.~~ **Decidido:** los proveedores solo se desactivan; se pueden eliminar los pedidos pendientes y los festivos. (Fase 2: las trabajadoras solo se desactivan y los registros de horas extra sí se pueden eliminar.)
