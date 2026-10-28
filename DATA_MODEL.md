# Modelo de datos — Gestión de tienda MVP

**Estado:**
- `profiles`: implementada y aplicada en el proyecto de Supabase (Fase 1).
- `employees` y `overtime_entries`: implementadas en una migración preparada, pendiente de aplicar en el proyecto remoto (Fase 2).
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
- `id uuid primary key`
- `name text not null`
- `order_weekdays smallint[] not null default '{}'`
- `delivery_weekdays smallint[] not null default '{}'`
- `notes text null`
- `is_active boolean not null default true`
- `created_at timestamptz not null`
- `updated_at timestamptz not null`

Convención de días: 1=lunes ... 7=domingo. Validar valores en la aplicación o mediante una restricción SQL.

### `supplier_products`
- `id uuid primary key`
- `supplier_id uuid not null references suppliers(id)`
- `name text not null`
- `unit text not null`
- `usual_quantity numeric(10,2) not null default 0 check (usual_quantity >= 0)`
- `is_active boolean not null default true`
- `created_at timestamptz not null`
- `updated_at timestamptz not null`

La unidad se almacena como texto sencillo para admitir unidades propias de la tienda. No hace falta construir un sistema complejo de unidades en el MVP.

### `orders`
- `id uuid primary key`
- `supplier_id uuid not null references suppliers(id)`
- `order_date date not null`
- `status text not null check (status in ('pending','ordered'))`
- `ordered_at timestamptz null`
- `notes text null`
- `created_at timestamptz not null`
- `updated_at timestamptz not null`

Evitar duplicar accidentalmente un pedido del mismo proveedor para la misma fecha; definir una restricción única o una operación idempotente según el flujo de creación.

### `order_lines`
- `id uuid primary key`
- `order_id uuid not null references orders(id) on delete cascade`
- `supplier_product_id uuid null references supplier_products(id) on delete set null`
- `product_name_snapshot text not null`
- `unit_snapshot text not null`
- `usual_quantity_snapshot numeric(10,2) not null`
- `ordered_quantity numeric(10,2) not null`
- `created_at timestamptz not null`
- `updated_at timestamptz not null`

Los campos `*_snapshot` preservan el nombre, unidad y cantidad habitual tal como estaban cuando se creó el pedido. `ordered_quantity` conserva la cantidad concreta pedida. La referencia al producto puede quedar nula si se desactiva o elimina el producto, sin perder el historial.

### `holidays`
- `id uuid primary key`
- `holiday_date date not null`
- `name text not null`
- `notes text null`
- `created_at timestamptz not null`

Para MVP, los festivos se introducen manualmente.

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
-- DELETE solo si la tabla permite borrado físico (ver decisión pendiente 4);
-- en las entidades con historial se usa is_active. Si se permite, se añade
-- `delete` al grant y una política:
-- create policy "<tabla>_delete_authorized" on public.<tabla>
--   for delete to authenticated using ((select private.is_authorized()));
```

Si la tabla usa `updated_at`, se añade también el trigger con `private.set_updated_at()`.

**Pruebas SQL:** cada migración tiene su propio script de comprobaciones en `supabase/tests/`, con el mismo patrón que `authorization_checks.sql`:
- `authorization_checks.sql`: `profiles` y `private.is_authorized()` (Fase 1). No se amplía con tablas nuevas, para que su resultado verificado no cambie.
- `staff_rls_checks.sql`: `employees` y `overtime_entries` (Fase 2).
- Las fases siguientes añaden su propio archivo, por ejemplo `suppliers_rls_checks.sql`.

Cada script comprueba la configuración (RLS, políticas, privilegios, restricciones) y simula peticiones sin sesión, con una sesión no autorizada y con la cuenta autorizada. Si necesita datos, los crea y los deshace al terminar. No deja cambios en la base de datos. Los UUID reales se escriben solo en la copia que se pega en el SQL Editor, nunca en el archivo versionado.

Nunca se crean políticas `using (true)` ni políticas basadas solo en `auth.role() = 'authenticated'`.

## Índices recomendados

- `overtime_entries(employee_id, work_date)`: creado en la migración de la Fase 2 (`overtime_entries_employee_id_work_date_idx`).
- `orders(order_date, status)`
- `orders(supplier_id, order_date)`
- `order_lines(order_id)`
- `supplier_products(supplier_id, is_active)`
- `employee_absences(employee_id, start_date, end_date)`

## Decisiones pendientes antes de migrar

1. Confirmar cómo se representará el horario habitual: uno o varios intervalos por día.
2. Confirmar si se pueden registrar dos pedidos del mismo proveedor en una fecha, o si debe haber solo uno.
3. ~~Elegir la forma de restringir RLS al usuario autorizado.~~ **Decidido:** opción A, tabla `profiles` y función `private.is_authorized()` (ver *Modelo de autorización*).
4. Decidir si los productos/proveedores se desactivan siempre o si se permite borrarlos cuando no tienen historial. (Para la Fase 2 ya está decidido: las trabajadoras solo se desactivan y los registros de horas extra sí se pueden eliminar.)
