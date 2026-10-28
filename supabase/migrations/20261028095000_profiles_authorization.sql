-- =============================================================================
-- Panet Admin · Migración 20261028095000 · Autorización y RLS de `profiles`
-- =============================================================================
--
-- Qué hace (solo crea objetos nuevos; no borra ni modifica datos existentes):
--   1. Esquema `private` (no expuesto por la API de Supabase) para funciones internas.
--   2. Tabla `public.profiles`: lista explícita de usuarios autorizados (opción A
--      de DATA_MODEL.md). Una fila = una cuenta de Supabase Auth autorizada.
--   3. Función `private.is_authorized()`: devuelve true si la usuaria de la
--      petición actual (auth.uid()) tiene fila en `profiles`.
--   4. RLS en `profiles`: cada cuenta solo puede leer su propia fila y ningún
--      cliente puede insertar, modificar ni borrar filas.
--
-- Cómo aplicarla: ver SUPABASE_SETUP.md, sección «Aplicar la migración».
-- Se ejecuta una sola vez y de forma atómica:
--   - con la CLI de Supabase (`supabase db push`), cada migración ya se
--     ejecuta dentro de una transacción;
--   - en el SQL Editor del panel, pega el contenido entre `begin;` y `commit;`.
-- Si algo falla (por ejemplo, al ejecutarla por segunda vez, porque los
-- objetos ya existen), la transacción se revierte entera y no cambia nada.
--
-- No contiene UUID, correos, contraseñas ni claves: la cuenta autorizada se
-- añade a mano después (ver SUPABASE_SETUP.md, «Autorizar la cuenta»).
-- =============================================================================


-- 1. Esquema privado ----------------------------------------------------------
-- No debe añadirse a «Exposed schemas» en la configuración de la Data API:
-- así sus funciones no se pueden llamar como RPC desde el navegador.

create schema private;

-- Nadie salvo el propietario (postgres) puede crear o modificar objetos aquí.
revoke all on schema private from public;
-- `authenticated` necesita USAGE para que las políticas RLS puedan llamar a
-- private.is_authorized(). USAGE no permite crear ni modificar objetos.
grant usage on schema private to authenticated;


-- 2. Tabla de cuentas autorizadas ---------------------------------------------

create table public.profiles (
  -- UUID de la cuenta en Supabase Auth. No se guardan contraseñas ni secretos:
  -- las credenciales las gestiona Supabase Auth.
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is
  'Cuentas autorizadas para usar Panet Admin. Una fila por usuaria autorizada. Se gestiona solo desde el panel de Supabase (rol postgres).';
comment on column public.profiles.id is
  'UUID de auth.users. Si la cuenta se elimina en Supabase Auth, la autorización desaparece con ella.';


-- 3. Mantenimiento de updated_at -----------------------------------------------
-- Reutilizable por las tablas de negocio de fases posteriores.

create function private.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function private.set_updated_at() from public;

create trigger profiles_set_updated_at
before update on public.profiles
for each row
execute function private.set_updated_at();


-- 4. Comprobación de autorización ------------------------------------------------
-- SECURITY DEFINER: se ejecuta con los permisos de su propietario (postgres)
-- para poder consultar `profiles` sin depender de sus políticas RLS y sin
-- recursión. Por eso:
--   - search_path vacío: todos los nombres van cualificados con su esquema y
--     nadie puede «colar» objetos con el mismo nombre en otro esquema;
--   - no recibe parámetros: solo informa sobre la usuaria de la petición
--     actual, no permite consultar si otra cuenta está autorizada;
--   - vive en `private`, donde los clientes no pueden crear ni reemplazar
--     funciones (solo el propietario puede modificarla).

create function private.is_authorized()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles as p
    where p.id = (select auth.uid())
  );
$$;

comment on function private.is_authorized() is
  'true si auth.uid() tiene fila en public.profiles. Usar en las políticas RLS de todas las tablas de negocio.';

-- Por defecto PostgreSQL concede EXECUTE a PUBLIC: se retira y solo se concede
-- a `authenticated`. `anon` (sin sesión) no puede ejecutarla.
revoke all on function private.is_authorized() from public, anon, authenticated;
grant execute on function private.is_authorized() to authenticated;


-- 5. Permisos y RLS de `profiles` ---------------------------------------------

alter table public.profiles enable row level security;

-- Supabase concede por defecto todos los privilegios de las tablas nuevas de
-- `public` a anon y authenticated. Se retiran y se deja solo lectura a
-- `authenticated`: aunque una política estuviera mal escrita, los clientes no
-- tendrían permiso para insertar, modificar ni borrar.
revoke all on table public.profiles from anon, authenticated;
grant select on table public.profiles to authenticated;

-- Única política: cada cuenta autenticada puede leer su propia fila (si la
-- tiene). Una cuenta no autorizada no tiene fila y no ve nada.
-- No hay políticas de INSERT, UPDATE ni DELETE: con RLS activo, quedan
-- denegadas para todos los clientes. Solo `postgres` (propietario, desde el
-- panel de Supabase) puede añadir o retirar autorizaciones.
create policy "profiles_select_own"
on public.profiles
for select
to authenticated
using (id = (select auth.uid()));
