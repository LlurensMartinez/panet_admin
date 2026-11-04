-- =============================================================================
-- Panet Admin · Migración 20261104160000 · Municipio de la tienda y festivos
-- oficiales
-- =============================================================================
--
-- Qué hace (no borra ni modifica datos existentes; no toca `profiles`,
-- `employees`, `overtime_entries`, `suppliers`, `orders` ni `supplier_products`):
--   1. Tabla `public.shop_settings`: configuración de la tienda, con UNA sola
--      fila (id = 1). Por ahora, el municipio donde está la tienda (código INE
--      de 5 cifras y nombre) y cuándo se actualizaron por última vez los
--      festivos oficiales. La app sigue siendo para una sola tienda: esto solo
--      indica en qué municipio está.
--   2. Columna `holidays.source`: `manual` (los que añade la encargada; valor
--      por defecto, también para los festivos ya existentes) u `official`
--      (importados por la app del calendario oficial de la Generalitat). La app
--      solo añade o retira festivos `official`; nunca toca los manuales.
--   3. Trigger de `updated_at` y RLS: solo la cuenta autorizada
--      (private.is_authorized()) puede leer, crear y modificar la
--      configuración. Nadie puede borrarla.
--
-- Requisitos: migraciones 20261028095000_profiles_authorization.sql
-- (private.is_authorized() y private.set_updated_at()) y
-- 20261028221500_suppliers_orders_holidays.sql (public.holidays).
--
-- Cómo aplicarla: ver SUPABASE_SETUP.md, sección 13. Se ejecuta una sola vez y
-- de forma atómica (en el SQL Editor, entre `begin;` y `commit;`). Si algo
-- falla, la transacción se revierte entera y no cambia nada.
--
-- Comprobaciones: supabase/tests/shop_settings_checks.sql.
-- =============================================================================


-- 1. Configuración de la tienda ---------------------------------------------------

create table public.shop_settings (
  -- Una sola fila: la app siempre usa id = 1.
  id smallint primary key default 1,
  -- Municipio de la tienda: código INE de 5 cifras (por ejemplo, 08005 =
  -- L'Ametlla del Vallès) y su nombre. Vacíos = sin configurar.
  municipality_code text,
  municipality_name text,
  -- Última actualización correcta de los festivos oficiales.
  holidays_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shop_settings_single_row check (id = 1),
  constraint shop_settings_municipality_code_valid
    check (municipality_code is null or municipality_code ~ '^[0-9]{5}$'),
  -- Código y nombre van juntos.
  constraint shop_settings_municipality_complete
    check ((municipality_code is null) = (municipality_name is null)),
  constraint shop_settings_municipality_name_not_blank
    check (municipality_name is null or municipality_name ~ '[^[:space:]]')
);

comment on table public.shop_settings is
  'Configuración de la tienda (una sola fila, id = 1): municipio para los festivos oficiales.';
comment on column public.shop_settings.municipality_code is
  'Código INE (5 cifras) del municipio de la tienda; se usa para importar sus festivos locales oficiales.';
comment on column public.shop_settings.holidays_synced_at is
  'Última vez que la app actualizó correctamente los festivos oficiales.';

create trigger shop_settings_set_updated_at
before update on public.shop_settings
for each row
execute function private.set_updated_at();

alter table public.shop_settings enable row level security;

-- Supabase concede por defecto todos los privilegios de las tablas nuevas a
-- anon y authenticated (incluido TRUNCATE, que no respeta RLS). Se retiran
-- todos y se concede solo lo necesario. Sin DELETE.
revoke all on table public.shop_settings from anon, authenticated;
grant select, insert, update on table public.shop_settings to authenticated;

create policy "shop_settings_select_authorized"
on public.shop_settings
for select
to authenticated
using ((select private.is_authorized()));

create policy "shop_settings_insert_authorized"
on public.shop_settings
for insert
to authenticated
with check ((select private.is_authorized()));

create policy "shop_settings_update_authorized"
on public.shop_settings
for update
to authenticated
using ((select private.is_authorized()))
with check ((select private.is_authorized()));


-- 2. Origen de los festivos ---------------------------------------------------------

alter table public.holidays
  add column source text not null default 'manual',
  add constraint holidays_source_valid check (source in ('manual', 'official'));

comment on column public.holidays.source is
  'manual = añadido por la encargada; official = importado del calendario oficial de la Generalitat (la app lo mantiene).';
