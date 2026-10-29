# Modelo de datos — Gestión de tienda MVP

**Estado:**
- `profiles`: implementada y aplicada en el proyecto de Supabase (Fase 1).
- `employees` y `overtime_entries`: implementadas y aplicadas en el proyecto de Supabase (Fase 2); falta confirmar la ejecución de `staff_rls_checks.sql` allí.
- `suppliers`, `orders` y `holidays`: implementadas en la migración `20261028221500_suppliers_orders_holidays.sql`, aplicada en el proyecto de Supabase con sus comprobaciones correctas (Fase 3).
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
- `notes text null`
- `is_active boolean not null default true`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`. Se actualiza con el trigger `private.set_updated_at()`.

Decisiones:
- **Nombre único:** índice único `suppliers_name_unique_idx` sobre una clave normalizada del nombre: `normalize(name, NFC)`, espacios repetidos reducidos a uno y recortados, acentos de las vocales quitados con `translate` (agudos, graves, circunflejos y diéresis, en mayúsculas y minúsculas) y `lower`. No distingue mayúsculas, acentos ni espacios: «Panadería Sol» y «panaderia  sol» son el mismo proveedor. «ñ» y «ç» se consideran letras propias («Peña» y «Pena» son distintos). Incluye a los inactivos (se reactiva el existente en lugar de duplicarlo). Solo usa funciones incluidas en PostgreSQL, sin extensiones, y funciona igual con la configuración regional `C`. La app aplica la misma regla (`getSupplierNameKey` en `app/utils/suppliers.js`) para avisar antes de guardar; con letras fuera de esa lista (por ejemplo «Õ») puede ser algo más estricta que la base de datos, nunca menos.
- **Días de entrega:** la base de datos garantiza el rango; la app los guarda ordenados y sin repetir. Una lista vacía significa que el proveedor no genera previsiones, aunque admite pedidos manuales.
- **Una sola antelación por proveedor** (decisión aprobada para el MVP). Distintas antelaciones según el día de entrega podrán incorporarse en una fase futura. Mientras tanto, cada pedido puede tener su propia fecha de preparación.
- **No se borran:** los clientes no tienen el privilegio `DELETE`. Se desactivan con `is_active = false`.
- **Reglas que aplica solo la aplicación:** nombre de 80 caracteres como máximo y notas de 1000; un proveedor inactivo no genera previsiones ni admite pedidos nuevos.

### Catálogo de productos y líneas de pedido (descartados)

Las tablas `supplier_products` y `order_lines` de la propuesta inicial **no se crean**: el MVP no tiene catálogo de productos, unidades, cantidades habituales ni precios (ver `SPEC.md`, 3.3). El contenido de cada pedido se anota en `orders.notes`.

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
- **Agenda calculada, no guardada.** Las previsiones se calculan en la app a partir de `suppliers` (días de entrega y antelación) para los próximos 14 días y los 7 anteriores. Solo se guarda una fila cuando la encargada actúa sobre una previsión (marcarla como preparada o «no se pide», corregir fechas, escribir notas) o crea un pedido a mano. Abrir la app, recargarla o cambiar de día no escribe nada.
- **Sin duplicados.** Como mucho un pedido por proveedor y fecha de entrega, y cada previsión se convierte como mucho en un pedido (dos dispositivos que actúan a la vez sobre la misma previsión: el segundo recibe `23505`, la API responde 409, y la app recarga y avisa). La app usa `insert` y no `upsert`, para no sobrescribir cambios hechos desde otro dispositivo.
- **Pedido movido.** `scheduled_delivery_date` no cambia al corregir las fechas, así la previsión original no vuelve a aparecer. Una previsión se oculta si ya existe un pedido del mismo proveedor con esa fecha como `scheduled_delivery_date` o como `delivery_date`.
- **Estados:** `pending` (pendiente), `prepared` (preparado) y `skipped` (no se pide: descarta una previsión, por ejemplo por un festivo; no cuenta como pendiente ni atrasado). Desde cualquier estado se puede volver a `pending`.
- **`prepared_at`** lo mantiene el trigger `orders_set_prepared_at` (función `private.set_order_prepared_at()`) con la hora del servidor: se fija al pasar a `prepared`, se conserva mientras siga preparado y se vacía en cualquier otro estado. Lo que envíe el cliente se ignora.
- **Columnas protegidas.** `authenticated` solo puede modificar `delivery_date`, `prepare_date`, `status` y `notes` (privilegio `UPDATE` por columnas). El proveedor y la entrega prevista de origen no cambian una vez creado el pedido.
- **Eliminación.** Solo pedidos pendientes (política `orders_delete_pending_authorized`). Un `DELETE` sobre un pedido preparado o descartado no da error, pero no afecta a ninguna fila. Para eliminarlo habría que volver a ponerlo como pendiente.
- **`on delete restrict`:** no se puede borrar un proveedor con pedidos, ni siquiera desde el panel.
- **Reglas que aplica solo la aplicación:** notas de 1000 caracteres como máximo; no se crean pedidos para proveedores inactivos.

### `holidays`
- `id uuid primary key default gen_random_uuid()`
- `holiday_date date not null`, único (`holidays_holiday_date_unique`)
- `name text not null`, con `check (name ~ '[^[:space:]]')`
- `scope text not null`, con `check (scope in ('national', 'regional', 'local'))`: nacional, autonómico o local.
- `notes text null`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`. Se actualiza con el trigger `private.set_updated_at()`.

Decisiones:
- **Introducción manual**, sin API externa: son pocas fechas al año y los festivos locales dependen del municipio.
- **Una fila por fecha:** basta para avisar. Si un festivo es a la vez de dos ámbitos, se elige uno y se anota en `notes`.
- **Se pueden corregir y eliminar:** no tienen historial que conservar.
- **Solo avisos.** Un festivo en la fecha de entrega genera un aviso que recomienda confirmar la entrega con el proveedor; nunca mueve ni cancela pedidos.

`suppliers`, `orders` y `holidays` están implementadas en `supabase/migrations/20261028221500_suppliers_orders_holidays.sql`, con sus comprobaciones en `supabase/tests/orders_rls_checks.sql`.

### `employee_absences`
- `id uuid primary key`
- `employee_id uuid not null references employees(id)`
- `absence_type text not null`
- `start_date date not null`
- `end_date date not null`
- `notes text null`
- `created_at timestamptz not null`
- `updated_at timestamptz not null`
- Restricción: `end_date >= start_date`

### `employee_regular_schedules`
Propuesta mínima para horarios habituales, pendiente de confirmar los datos concretos que necesita la encargada.
- `id uuid primary key`
- `employee_id uuid not null references employees(id)`
- `weekday smallint not null`
- `start_time time null`
- `end_time time null`
- `notes text null`
- `created_at timestamptz not null`
- `updated_at timestamptz not null`

Esta tabla representa horarios habituales, no un sistema completo de turnos publicados.

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
- Las fases siguientes añaden su propio archivo.

Cada script comprueba la configuración (RLS, políticas, privilegios, restricciones) y simula peticiones sin sesión, con una sesión no autorizada y con la cuenta autorizada. Si necesita datos, los crea y los deshace al terminar. No deja cambios en la base de datos. Los UUID reales se escriben solo en la copia que se pega en el SQL Editor, nunca en el archivo versionado.

Nunca se crean políticas `using (true)` ni políticas basadas solo en `auth.role() = 'authenticated'`.

## Índices recomendados

- `overtime_entries(employee_id, work_date)`: creado en la migración de la Fase 2 (`overtime_entries_employee_id_work_date_idx`).
- `orders(prepare_date)`: agenda. Creado en la migración de la Fase 3 (`orders_prepare_date_idx`).
- `orders(delivery_date)`: historial. Creado en la migración de la Fase 3 (`orders_delivery_date_idx`).
- `orders(supplier_id, delivery_date)`: lo cubre la restricción única `orders_supplier_delivery_unique`.
- `employee_absences(employee_id, start_date, end_date)`

## Decisiones pendientes antes de migrar

1. Confirmar cómo se representará el horario habitual: uno o varios intervalos por día.
2. ~~Confirmar si se pueden registrar dos pedidos del mismo proveedor en una fecha.~~ **Decidido:** como mucho uno por proveedor y fecha de entrega.
3. ~~Elegir la forma de restringir RLS al usuario autorizado.~~ **Decidido:** opción A, tabla `profiles` y función `private.is_authorized()` (ver *Modelo de autorización*).
4. ~~Decidir si los proveedores se desactivan siempre o si se permite borrarlos.~~ **Decidido:** los proveedores solo se desactivan; se pueden eliminar los pedidos pendientes y los festivos. (Fase 2: las trabajadoras solo se desactivan y los registros de horas extra sí se pueden eliminar.)
