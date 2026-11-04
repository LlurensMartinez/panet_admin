-- =============================================================================
-- Panet Admin · Migración 20261104130000 · Calendario de los proveedores
-- =============================================================================
--
-- Qué hace (solo AÑADE columnas a `public.suppliers`, con valores por defecto
-- que mantienen exactamente el comportamiento actual; no borra ni modifica
-- datos y no toca `profiles`, `employees`, `overtime_entries`, `orders`,
-- `holidays` ni `supplier_products`):
--   1. `lead_days_overrides`: antelación distinta según el día de entrega
--      (por ejemplo, el pedido del lunes con 3 días y el del jueves con 1).
--      Los días que no aparecen usan `order_lead_days`, como hasta ahora.
--   2. `delivery_every_weeks` y `delivery_anchor_date`: entregas semanales (1)
--      o quincenales (2). En las quincenales, la fecha de referencia marca qué
--      semanas tocan.
--   3. `order_mode`: `scheduled` (días fijos: la agenda propone los pedidos,
--      como hasta ahora) u `on_demand` (a demanda: se pide cuando hace falta;
--      los días de entrega son los días en que puede entregar).
--   4. `order_deadline`: hora límite para hacer el pedido el día que se
--      prepara (por ejemplo, antes de las 12:00). Opcional.
--   5. Restricciones que validan los nuevos datos en la base de datos.
--
-- Permisos y RLS: no cambian. `suppliers` ya tiene RLS y la cuenta autorizada
-- puede leer, crear y modificar (también las columnas nuevas); nadie puede
-- borrar proveedores. La función de validación solo comprueba datos (no lee
-- tablas) y la puede ejecutar `authenticated`, porque las restricciones CHECK
-- se evalúan con los permisos de quien guarda.
--
-- Requisitos: migraciones 20261028095000_profiles_authorization.sql (esquema
-- private) y 20261028221500_suppliers_orders_holidays.sql (public.suppliers).
--
-- Cómo aplicarla: ver SUPABASE_SETUP.md, sección 12. Se ejecuta una sola vez y
-- de forma atómica (en el SQL Editor, entre `begin;` y `commit;`). Si algo
-- falla (por ejemplo, al ejecutarla por segunda vez, porque las columnas ya
-- existen), la transacción se revierte entera y no cambia nada.
--
-- Comprobaciones: supabase/tests/supplier_schedule_checks.sql.
-- =============================================================================


-- 1. Validación de las antelaciones por día ---------------------------------------
-- Objeto JSON { "<día ISO>": <antelación> }, por ejemplo {"1": 3}:
--   - claves "1" a "7" (1 = lunes) que estén entre los días de entrega;
--   - valores enteros de 0 a 7 (mismo rango que order_lead_days).
-- Se usa CASE para no convertir una clave o un valor no válidos.

create function private.is_valid_lead_days_overrides(overrides jsonb, weekdays smallint[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select overrides is not null
    and jsonb_typeof(overrides) = 'object'
    and not exists (
      select 1
      from jsonb_each(overrides) as entry (key, value)
      where case
        when entry.key !~ '^[1-7]$' then true
        when not (entry.key::smallint = any (coalesce(weekdays, '{}'::smallint[]))) then true
        when jsonb_typeof(entry.value) <> 'number' then true
        when (entry.value #>> '{}')::numeric <> trunc((entry.value #>> '{}')::numeric) then true
        else (entry.value #>> '{}')::numeric not between 0 and 7
      end
    )
$$;

comment on function private.is_valid_lead_days_overrides(jsonb, smallint[]) is
  'true si lead_days_overrides es un objeto {"<día 1-7>": <0-7>} con días que están entre los días de entrega.';

revoke all on function private.is_valid_lead_days_overrides(jsonb, smallint[]) from public, anon;
grant execute on function private.is_valid_lead_days_overrides(jsonb, smallint[]) to authenticated;


-- 2. Columnas nuevas -----------------------------------------------------------------

alter table public.suppliers
  add column lead_days_overrides jsonb not null default '{}'::jsonb,
  add column delivery_every_weeks smallint not null default 1,
  add column delivery_anchor_date date,
  add column order_mode text not null default 'scheduled',
  add column order_deadline time without time zone;

alter table public.suppliers
  add constraint suppliers_lead_days_overrides_valid
    check (private.is_valid_lead_days_overrides(lead_days_overrides, delivery_weekdays)),
  add constraint suppliers_delivery_every_weeks_valid
    check (delivery_every_weeks in (1, 2)),
  -- Quincenal ⇒ fecha de referencia; semanal ⇒ sin fecha.
  add constraint suppliers_delivery_anchor_valid
    check (
      (delivery_every_weeks = 1 and delivery_anchor_date is null)
      or (delivery_every_weeks = 2 and delivery_anchor_date is not null)
    ),
  add constraint suppliers_order_mode_valid
    check (order_mode in ('scheduled', 'on_demand')),
  -- A demanda no hay calendario fijo: no tiene sentido una frecuencia quincenal.
  add constraint suppliers_on_demand_weekly
    check (order_mode = 'scheduled' or delivery_every_weeks = 1),
  -- Horas en punto o con minutos, sin segundos.
  add constraint suppliers_order_deadline_valid
    check (order_deadline is null or date_trunc('minute', order_deadline) = order_deadline);

comment on column public.suppliers.lead_days_overrides is
  'Antelación distinta según el día de entrega: {"<día ISO 1-7>": <0-7>}. Los días que no aparecen usan order_lead_days.';
comment on column public.suppliers.delivery_every_weeks is
  '1 = cada semana; 2 = cada dos semanas (quincenal), en las semanas que marca delivery_anchor_date.';
comment on column public.suppliers.delivery_anchor_date is
  'Solo en quincenales: una entrega de referencia. Tocan las semanas (de lunes a domingo) a un número par de semanas de esta fecha.';
comment on column public.suppliers.order_mode is
  'scheduled = días fijos (la agenda propone los pedidos); on_demand = a demanda (sin previsiones; los días de entrega son los días posibles).';
comment on column public.suppliers.order_deadline is
  'Hora límite (hora de la tienda) para hacer el pedido el día que se prepara. Opcional.';
