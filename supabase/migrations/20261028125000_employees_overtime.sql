-- =============================================================================
-- Panet Admin · Migración 20261028125000 · Trabajadoras y horas extra
-- =============================================================================
--
-- Qué hace (solo crea objetos nuevos; no borra ni modifica datos existentes):
--   1. Tabla `public.employees`: fichas de trabajadoras. No se borran: se
--      desactivan con `is_active = false` para conservar su historial.
--   2. Tabla `public.overtime_entries`: registros de horas extra en minutos
--      enteros (1 a 1440 por registro). Se pueden editar y eliminar.
--   3. Triggers de `updated_at` (reutilizan private.set_updated_at()).
--   4. Índice (employee_id, work_date) para historiales y totales por periodo.
--   5. RLS: solo la cuenta autorizada (private.is_authorized()) puede leer,
--      crear y modificar; solo puede eliminar registros de horas extra.
--
-- Requisitos: migración 20261028095000_profiles_authorization.sql aplicada
-- (crea private.is_authorized() y private.set_updated_at()).
--
-- Cómo aplicarla: ver SUPABASE_SETUP.md, sección 9. Se ejecuta una sola vez y
-- de forma atómica:
--   - con la CLI de Supabase (`supabase db push`), cada migración ya se
--     ejecuta dentro de una transacción;
--   - en el SQL Editor del panel, pega el contenido entre `begin;` y `commit;`.
-- Si algo falla (por ejemplo, al ejecutarla por segunda vez, porque las tablas
-- ya existen), la transacción se revierte entera y no cambia nada.
--
-- Comprobaciones: supabase/tests/staff_rls_checks.sql.
-- =============================================================================


-- 1. Trabajadoras ---------------------------------------------------------------
-- Solo los datos que pide SPEC.md (3.6): nombre, apellidos, puesto opcional,
-- estado y observaciones. Nada de DNI, contacto ni datos administrativos.

create table public.employees (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text not null,
  -- Puesto o función en la tienda (texto libre). No tiene relación con los
  -- roles de la base de datos.
  role text,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Nombre y apellidos deben contener algún carácter visible: se rechazan los
  -- vacíos y los formados solo por espacios, tabuladores o saltos de línea.
  constraint employees_first_name_not_blank check (first_name ~ '[^[:space:]]'),
  constraint employees_last_name_not_blank check (last_name ~ '[^[:space:]]')
);

comment on table public.employees is
  'Fichas de trabajadoras de la tienda. No tienen cuenta en la aplicación. No se eliminan: se desactivan con is_active = false para conservar su historial.';
comment on column public.employees.role is
  'Puesto o función (opcional). No es un rol de la base de datos.';
comment on column public.employees.is_active is
  'false = trabajadora desactivada. Sus registros de horas extra se conservan.';


-- 2. Horas extra ----------------------------------------------------------------
-- La duración se introduce como horas/minutos en la app y se guarda en minutos
-- enteros. Puede haber varios registros de la misma trabajadora el mismo día:
-- los totales se calculan sumando, sin guardar acumulados.

create table public.overtime_entries (
  id uuid primary key default gen_random_uuid(),
  -- on delete restrict: no se puede borrar una trabajadora con registros. Los
  -- clientes no pueden borrar trabajadoras en ningún caso (ver sección 5); esta
  -- restricción protege también el historial frente a borrados manuales
  -- desde el panel.
  employee_id uuid not null references public.employees (id) on delete restrict,
  work_date date not null,
  duration_minutes integer not null,
  reason text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Entre 1 minuto y 24 horas por registro: evita ceros, negativos y errores
  -- de tecleo evidentes (por ejemplo, 6000 en lugar de 60).
  constraint overtime_entries_duration_minutes_range
    check (duration_minutes > 0 and duration_minutes <= 1440)
);

comment on table public.overtime_entries is
  'Registros manuales de horas extra. Varios por trabajadora y día permitidos. Los totales semanales (lunes-domingo) y mensuales se calculan a partir de estos registros.';
comment on column public.overtime_entries.work_date is
  'Fecha del trabajo (date, sin hora). La app propone el día actual en Europe/Madrid.';
comment on column public.overtime_entries.duration_minutes is
  'Duración en minutos enteros, de 1 a 1440.';

-- Historial por trabajadora y totales por periodo (filtros por employee_id y
-- rangos de work_date). También sirve de índice para la clave foránea.
create index overtime_entries_employee_id_work_date_idx
  on public.overtime_entries (employee_id, work_date);


-- 3. Mantenimiento de updated_at -----------------------------------------------
-- La función ya existe (migración de profiles). Fija updated_at = now() en cada
-- UPDATE, aunque el cliente intente enviar otro valor.

create trigger employees_set_updated_at
before update on public.employees
for each row
execute function private.set_updated_at();

create trigger overtime_entries_set_updated_at
before update on public.overtime_entries
for each row
execute function private.set_updated_at();


-- 4. RLS y permisos de `employees` ---------------------------------------------

alter table public.employees enable row level security;

-- Supabase concede por defecto todos los privilegios de las tablas nuevas de
-- `public` a anon y authenticated (incluido TRUNCATE, que no respeta RLS).
-- Se retiran todos y se concede solo lo necesario. Sin DELETE: las
-- trabajadoras se desactivan, no se borran.
revoke all on table public.employees from anon, authenticated;
grant select, insert, update on table public.employees to authenticated;

create policy "employees_select_authorized"
on public.employees
for select
to authenticated
using ((select private.is_authorized()));

create policy "employees_insert_authorized"
on public.employees
for insert
to authenticated
with check ((select private.is_authorized()));

create policy "employees_update_authorized"
on public.employees
for update
to authenticated
using ((select private.is_authorized()))
with check ((select private.is_authorized()));

-- Sin política de DELETE ni privilegio DELETE.


-- 5. RLS y permisos de `overtime_entries` --------------------------------------

alter table public.overtime_entries enable row level security;

revoke all on table public.overtime_entries from anon, authenticated;
-- DELETE permitido solo aquí, para eliminar registros duplicados o erróneos.
grant select, insert, update, delete on table public.overtime_entries to authenticated;

create policy "overtime_entries_select_authorized"
on public.overtime_entries
for select
to authenticated
using ((select private.is_authorized()));

create policy "overtime_entries_insert_authorized"
on public.overtime_entries
for insert
to authenticated
with check ((select private.is_authorized()));

create policy "overtime_entries_update_authorized"
on public.overtime_entries
for update
to authenticated
using ((select private.is_authorized()))
with check ((select private.is_authorized()));

create policy "overtime_entries_delete_authorized"
on public.overtime_entries
for delete
to authenticated
using ((select private.is_authorized()));
