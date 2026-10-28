-- =============================================================================
-- Panet Admin · Migración 20261028221500 · Proveedores, pedidos y festivos
-- =============================================================================
--
-- Qué hace (solo crea objetos nuevos; no borra ni modifica datos existentes y
-- no toca `profiles`, `employees` ni `overtime_entries`):
--   1. Tabla `public.suppliers`: proveedores con sus días habituales de entrega
--      y la antelación con la que se prepara el pedido. No se borran: se
--      desactivan con `is_active = false` para conservar su historial.
--   2. Tabla `public.holidays`: festivos configurados a mano (nacionales,
--      autonómicos o locales). Solo sirven para mostrar avisos preventivos.
--   3. Tabla `public.orders`: pedidos concretos. La agenda se calcula en la
--      app a partir del calendario de cada proveedor; una fila solo se crea
--      cuando la encargada actúa sobre un pedido (marcarlo como preparado o
--      «no se pide», corregir fechas o escribir notas) o crea uno a mano.
--      Sin catálogo de productos ni líneas: el contenido va en `notes`.
--   4. Triggers de `updated_at` (reutilizan private.set_updated_at()) y de
--      `prepared_at` (nueva función private.set_order_prepared_at()).
--   5. Índices para la agenda y el historial.
--   6. RLS: solo la cuenta autorizada (private.is_authorized()) puede leer,
--      crear y modificar. Se puede eliminar un festivo y un pedido PENDIENTE;
--      los proveedores y los pedidos preparados o descartados no se eliminan.
--
-- Requisitos: migración 20261028095000_profiles_authorization.sql aplicada
-- (crea private.is_authorized() y private.set_updated_at()). No depende de la
-- migración de trabajadoras y horas extra.
--
-- Cómo aplicarla: ver SUPABASE_SETUP.md, sección 10. Se ejecuta una sola vez y
-- de forma atómica:
--   - con la CLI de Supabase (`supabase db push`), cada migración ya se
--     ejecuta dentro de una transacción;
--   - en el SQL Editor del panel, pega el contenido entre `begin;` y `commit;`.
-- Si algo falla (por ejemplo, al ejecutarla por segunda vez, porque las tablas
-- ya existen), la transacción se revierte entera y no cambia nada.
--
-- Comprobaciones: supabase/tests/orders_rls_checks.sql.
-- =============================================================================


-- 1. Proveedores ----------------------------------------------------------------
-- Solo lo necesario para organizar los pedidos (SPEC.md, 3.2): nombre, días de
-- entrega, antelación, notas y estado. Nada de NIF, dirección ni contacto.

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- Días habituales de entrega, 1 = lunes … 7 = domingo (ISO 8601, igual que
  -- `extract(isodow from …)`). Vacío = sin entregas habituales: el proveedor
  -- no genera previsiones, pero admite pedidos creados a mano. La app guarda
  -- los días ordenados y sin repetir.
  delivery_weekdays smallint[] not null default '{}',
  -- Días de antelación con los que se prepara el pedido respecto a la entrega
  -- (0 = el mismo día). Es el valor por defecto: cada pedido puede tener su
  -- propia fecha de preparación sin cambiar esta configuración.
  order_lead_days smallint not null default 1,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint suppliers_name_not_blank check (name ~ '[^[:space:]]'),
  -- Lista de una dimensión, sin nulos y con valores de 1 a 7.
  constraint suppliers_delivery_weekdays_valid check (
    coalesce(array_ndims(delivery_weekdays), 1) = 1
    and array_position(delivery_weekdays, null) is null
    and delivery_weekdays <@ '{1,2,3,4,5,6,7}'::smallint[]
  ),
  constraint suppliers_order_lead_days_range check (order_lead_days between 0 and 7)
);

-- Nombre único sin distinguir mayúsculas, acentos ni espacios repetidos o en
-- los extremos: «Panadería Sol», «panaderia  sol» y « PANADERÍA SÒL » son el
-- mismo proveedor. Incluye los inactivos: en lugar de duplicar, se reactiva el
-- que ya existe.
--   - normalize(…, NFC): una «é» escrita como «e» + acento combinado cuenta
--     igual que la «é» precompuesta.
--   - translate: quita los acentos agudos, graves, circunflejos y diéresis de
--     las vocales, en mayúsculas y minúsculas (en una base con configuración
--     regional «C», lower() no convierte las mayúsculas acentuadas). «ñ» y «ç»
--     se consideran letras propias: «Peña» y «Pena» son nombres distintos.
--   - Solo funciones incluidas en PostgreSQL e inmutables: sin extensiones.
-- La app aplica exactamente la misma regla (app/utils/suppliers.js) para
-- avisar antes de guardar.
create unique index suppliers_name_unique_idx
  on public.suppliers (
    lower(translate(
      btrim(regexp_replace(normalize(name, NFC), '[[:space:]]+', ' ', 'g')),
      'ÁÀÂÄáàâäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÖóòôöÚÙÛÜúùûüÑÇ',
      'aaaaaaaaeeeeeeeeiiiiiiiioooooooouuuuuuuuñç'
    ))
  );

comment on table public.suppliers is
  'Proveedores de la tienda. No se eliminan: se desactivan con is_active = false para conservar sus pedidos.';
comment on column public.suppliers.delivery_weekdays is
  'Días habituales de entrega (1 = lunes … 7 = domingo). Vacío = sin previsiones automáticas.';
comment on column public.suppliers.order_lead_days is
  'Antelación por defecto (0 a 7 días) con la que se prepara el pedido respecto a la entrega.';
comment on column public.suppliers.is_active is
  'false = proveedor desactivado: no genera previsiones y conserva sus pedidos.';


-- 2. Festivos -------------------------------------------------------------------
-- Se introducen a mano (sin API externa). Un festivo NO significa que el
-- proveedor no entregue: la app solo recomienda confirmarlo.

create table public.holidays (
  id uuid primary key default gen_random_uuid(),
  holiday_date date not null,
  name text not null,
  -- national = nacional, regional = autonómico, local = local.
  scope text not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint holidays_name_not_blank check (name ~ '[^[:space:]]'),
  constraint holidays_scope_valid check (scope in ('national', 'regional', 'local')),
  -- Una sola fila por fecha: basta para avisar.
  constraint holidays_holiday_date_unique unique (holiday_date)
);

comment on table public.holidays is
  'Festivos configurados manualmente. Solo generan avisos preventivos sobre entregas; nunca mueven ni cancelan pedidos.';
comment on column public.holidays.scope is
  'Ámbito: national (nacional), regional (autonómico) o local.';


-- 3. Pedidos --------------------------------------------------------------------

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  -- on delete restrict: un proveedor con pedidos no se puede borrar, ni
  -- siquiera desde el panel. Los clientes no pueden borrar proveedores.
  supplier_id uuid not null references public.suppliers (id) on delete restrict,
  -- Entrega prevista por el calendario de la que procede el pedido. Null en
  -- los pedidos creados a mano. No cambia aunque se corrija la fecha de
  -- entrega: así la previsión original no vuelve a aparecer en la agenda.
  scheduled_delivery_date date,
  delivery_date date not null,
  prepare_date date not null,
  -- pending = pendiente, prepared = preparado, skipped = no se pide.
  status text not null default 'pending',
  -- Momento en que se marcó como preparado. Lo fija el trigger
  -- orders_set_prepared_at con la hora del servidor.
  prepared_at timestamptz,
  -- Contenido del pedido y observaciones, en texto libre (sin catálogo).
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_status_valid check (status in ('pending', 'prepared', 'skipped')),
  constraint orders_prepare_not_after_delivery check (prepare_date <= delivery_date),
  constraint orders_prepared_at_matches_status
    check ((status = 'prepared') = (prepared_at is not null)),
  -- Como mucho un pedido por proveedor y fecha de entrega.
  constraint orders_supplier_delivery_unique unique (supplier_id, delivery_date),
  -- Cada entrega prevista por el calendario se convierte como mucho en un
  -- pedido, aunque dos dispositivos actúen a la vez sobre la misma previsión.
  -- (Los pedidos manuales tienen null y no chocan entre sí por esta regla.)
  constraint orders_supplier_scheduled_unique unique (supplier_id, scheduled_delivery_date)
);

comment on table public.orders is
  'Pedidos a proveedores. Las previsiones del calendario no se guardan: solo los pedidos sobre los que la encargada ha actuado o que ha creado a mano.';
comment on column public.orders.scheduled_delivery_date is
  'Entrega prevista por el calendario de la que procede el pedido (null si se creó a mano). No se puede modificar.';
comment on column public.orders.prepare_date is
  'Día en que hay que preparar el pedido. Por defecto, delivery_date menos la antelación del proveedor.';
comment on column public.orders.status is
  'pending (pendiente), prepared (preparado) o skipped (no se pide).';
comment on column public.orders.prepared_at is
  'Hora del servidor en que se marcó como preparado. Lo mantiene un trigger.';
comment on column public.orders.notes is
  'Contenido del pedido y observaciones en texto libre.';

-- Agenda (pedidos a preparar entre hace 7 días y dentro de 14).
create index orders_prepare_date_idx on public.orders (prepare_date);
-- Historial por fechas de entrega. Las consultas por proveedor usan el índice
-- de la restricción única (supplier_id, delivery_date).
create index orders_delivery_date_idx on public.orders (delivery_date);


-- 4. Triggers ---------------------------------------------------------------------

create trigger suppliers_set_updated_at
before update on public.suppliers
for each row
execute function private.set_updated_at();

create trigger holidays_set_updated_at
before update on public.holidays
for each row
execute function private.set_updated_at();

create trigger orders_set_updated_at
before update on public.orders
for each row
execute function private.set_updated_at();

-- prepared_at con la hora del servidor, no la del dispositivo:
--   - al pasar a `prepared`, now();
--   - si ya estaba preparado, se conserva la hora original;
--   - en cualquier otro estado, null (volver a pendiente lo borra).
-- Cualquier valor enviado por el cliente se ignora.
create function private.set_order_prepared_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'prepared' then
    if tg_op = 'UPDATE' and old.status = 'prepared' then
      new.prepared_at := old.prepared_at;
    else
      new.prepared_at := now();
    end if;
  else
    new.prepared_at := null;
  end if;
  return new;
end;
$$;

comment on function private.set_order_prepared_at() is
  'Trigger: mantiene orders.prepared_at según el estado, con la hora del servidor.';

revoke all on function private.set_order_prepared_at() from public;

create trigger orders_set_prepared_at
before insert or update on public.orders
for each row
execute function private.set_order_prepared_at();


-- 5. RLS y permisos de `suppliers` -----------------------------------------------

alter table public.suppliers enable row level security;

-- Supabase concede por defecto todos los privilegios de las tablas nuevas de
-- `public` a anon y authenticated (incluido TRUNCATE, que no respeta RLS).
-- Se retiran todos y se concede solo lo necesario. Sin DELETE: los
-- proveedores se desactivan, no se borran.
revoke all on table public.suppliers from anon, authenticated;
grant select, insert, update on table public.suppliers to authenticated;

create policy "suppliers_select_authorized"
on public.suppliers
for select
to authenticated
using ((select private.is_authorized()));

create policy "suppliers_insert_authorized"
on public.suppliers
for insert
to authenticated
with check ((select private.is_authorized()));

create policy "suppliers_update_authorized"
on public.suppliers
for update
to authenticated
using ((select private.is_authorized()))
with check ((select private.is_authorized()));

-- Sin política de DELETE ni privilegio DELETE.


-- 6. RLS y permisos de `holidays` -------------------------------------------------

alter table public.holidays enable row level security;

revoke all on table public.holidays from anon, authenticated;
-- DELETE permitido: un festivo mal introducido no tiene historial que conservar.
grant select, insert, update, delete on table public.holidays to authenticated;

create policy "holidays_select_authorized"
on public.holidays
for select
to authenticated
using ((select private.is_authorized()));

create policy "holidays_insert_authorized"
on public.holidays
for insert
to authenticated
with check ((select private.is_authorized()));

create policy "holidays_update_authorized"
on public.holidays
for update
to authenticated
using ((select private.is_authorized()))
with check ((select private.is_authorized()));

create policy "holidays_delete_authorized"
on public.holidays
for delete
to authenticated
using ((select private.is_authorized()));


-- 7. RLS y permisos de `orders` ---------------------------------------------------

alter table public.orders enable row level security;

revoke all on table public.orders from anon, authenticated;
grant select, insert, delete on table public.orders to authenticated;
-- UPDATE solo de las columnas que la encargada puede corregir. El proveedor y
-- la entrega prevista de origen no cambian una vez creado el pedido;
-- prepared_at y updated_at los mantienen los triggers.
grant update (delivery_date, prepare_date, status, notes)
  on table public.orders to authenticated;

create policy "orders_select_authorized"
on public.orders
for select
to authenticated
using ((select private.is_authorized()));

create policy "orders_insert_authorized"
on public.orders
for insert
to authenticated
with check ((select private.is_authorized()));

create policy "orders_update_authorized"
on public.orders
for update
to authenticated
using ((select private.is_authorized()))
with check ((select private.is_authorized()));

-- Solo se eliminan pedidos pendientes (por ejemplo, uno creado por error).
-- Los preparados y los descartados («no se pide») se conservan en el
-- historial: para eliminarlos habría que volver a ponerlos como pendientes.
-- Un DELETE sobre ellos no da error: no afecta a ninguna fila.
create policy "orders_delete_pending_authorized"
on public.orders
for delete
to authenticated
using ((select private.is_authorized()) and status = 'pending');
