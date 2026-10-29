-- =============================================================================
-- Panet Admin · Migración 20261029214500 · Productos habituales por proveedor
-- =============================================================================
--
-- Qué hace (solo crea objetos nuevos; no borra ni modifica datos existentes y
-- no toca `profiles`, `employees`, `overtime_entries`, `suppliers`, `orders`
-- ni `holidays`):
--   1. Tabla `public.supplier_products`: productos que se suelen pedir a cada
--      proveedor, con su unidad y su cantidad habitual (una referencia para
--      preparar pedidos, no una obligación). No se borran: se desactivan con
--      `is_active = false`, igual que los proveedores.
--   2. Trigger de `updated_at` (reutiliza private.set_updated_at()).
--   3. RLS: solo la cuenta autorizada (private.is_authorized()) puede leer,
--      crear y modificar. Nadie puede borrar productos ni cambiarlos de
--      proveedor.
--
-- Requisitos: migraciones 20261028095000_profiles_authorization.sql (crea
-- private.is_authorized() y private.set_updated_at()) y
-- 20261028221500_suppliers_orders_holidays.sql (crea public.suppliers).
--
-- Cómo aplicarla: ver SUPABASE_SETUP.md, sección 11. Se ejecuta una sola vez y
-- de forma atómica (en el SQL Editor, entre `begin;` y `commit;`). Si algo
-- falla (por ejemplo, al ejecutarla por segunda vez, porque la tabla ya
-- existe), la transacción se revierte entera y no cambia nada.
--
-- Comprobaciones: supabase/tests/supplier_products_rls_checks.sql.
-- =============================================================================


-- 1. Productos habituales -----------------------------------------------------

create table public.supplier_products (
  id uuid primary key default gen_random_uuid(),
  -- on delete restrict: un proveedor con productos no se puede borrar, ni
  -- siquiera desde el panel (los proveedores ya no se borran desde la app).
  supplier_id uuid not null references public.suppliers (id) on delete restrict,
  name text not null,
  -- Unidad en texto libre: unidades, cajas, kg, sacos…
  unit text not null,
  -- Cantidad que se suele pedir. Admite decimales (por ejemplo, 2,5 kg).
  usual_quantity numeric(10, 2) not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint supplier_products_name_not_blank check (name ~ '[^[:space:]]'),
  constraint supplier_products_unit_not_blank check (unit ~ '[^[:space:]]'),
  -- Mayor que 0 y con un máximo que evita errores de tecleo evidentes.
  constraint supplier_products_usual_quantity_range
    check (usual_quantity > 0 and usual_quantity <= 99999.99)
);

-- Nombre único dentro de cada proveedor, con la misma regla que los nombres
-- de proveedor (suppliers_name_unique_idx): sin distinguir mayúsculas, acentos
-- de las vocales ni espacios repetidos; «ñ» y «ç» cuentan como letras propias.
-- Incluye los inactivos: en lugar de duplicar, se reactiva el que ya existe.
-- Dos proveedores distintos sí pueden tener un producto con el mismo nombre.
-- El índice empieza por supplier_id, así que también sirve para listar los
-- productos de un proveedor y para la clave foránea.
create unique index supplier_products_name_unique_idx
  on public.supplier_products (
    supplier_id,
    lower(translate(
      btrim(regexp_replace(normalize(name, NFC), '[[:space:]]+', ' ', 'g')),
      'ÁÀÂÄáàâäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÖóòôöÚÙÛÜúùûüÑÇ',
      'aaaaaaaaeeeeeeeeiiiiiiiioooooooouuuuuuuuñç'
    ))
  );

comment on table public.supplier_products is
  'Productos habituales de cada proveedor. La cantidad habitual es solo una referencia. No se eliminan: se desactivan con is_active = false.';
comment on column public.supplier_products.unit is
  'Unidad de medida en texto libre (unidades, cajas, kg, sacos…).';
comment on column public.supplier_products.usual_quantity is
  'Cantidad que se suele pedir (mayor que 0, hasta 99999.99). Referencia inicial; un pedido concreto podrá llevar otra.';
comment on column public.supplier_products.is_active is
  'false = producto desactivado: deja de proponerse, pero se conserva.';


-- 2. Mantenimiento de updated_at ----------------------------------------------

create trigger supplier_products_set_updated_at
before update on public.supplier_products
for each row
execute function private.set_updated_at();


-- 3. RLS y permisos -------------------------------------------------------------

alter table public.supplier_products enable row level security;

-- Supabase concede por defecto todos los privilegios de las tablas nuevas de
-- `public` a anon y authenticated (incluido TRUNCATE, que no respeta RLS).
-- Se retiran todos y se concede solo lo necesario. Sin DELETE: los productos
-- se desactivan, no se borran (así ningún pedido futuro se queda sin su
-- producto).
revoke all on table public.supplier_products from anon, authenticated;
grant select, insert on table public.supplier_products to authenticated;
-- UPDATE solo de las columnas editables. El proveedor de un producto no
-- cambia: un producto no puede pasar a ser de otro proveedor. updated_at lo
-- mantiene el trigger.
grant update (name, unit, usual_quantity, is_active)
  on table public.supplier_products to authenticated;

create policy "supplier_products_select_authorized"
on public.supplier_products
for select
to authenticated
using ((select private.is_authorized()));

create policy "supplier_products_insert_authorized"
on public.supplier_products
for insert
to authenticated
with check ((select private.is_authorized()));

create policy "supplier_products_update_authorized"
on public.supplier_products
for update
to authenticated
using ((select private.is_authorized()))
with check ((select private.is_authorized()));

-- Sin política de DELETE ni privilegio DELETE.
