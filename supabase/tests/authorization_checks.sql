-- =============================================================================
-- Panet Admin · Comprobaciones de autorización y RLS (tabla `profiles`)
-- =============================================================================
--
-- Uso: SQL Editor de Supabase o `psql`, DESPUÉS de aplicar la migración
-- 20261028095000_profiles_authorization.sql y de autorizar la cuenta.
-- Ver SUPABASE_SETUP.md, sección 7.1.
--
-- Antes de ejecutar:
--   1. En el SQL Editor, el selector «Role» debe estar en `postgres` (sin
--      suplantar a ninguna usuaria). El propio script cambia de rol para
--      simular cada caso; si se lanza ya con otro rol, falla o da resultados
--      engañosos.
--   2. Sustituye los valores de la sección CONFIGURACIÓN.
--   3. Ejecuta el script entero de una vez: la tabla de resultados es lo que
--      devuelve la última sentencia.
--
-- Aviso de «operaciones destructivas»: el SQL Editor puede advertir de que el
-- script contiene DELETE, DROP, TRUNCATE o ALTER. Son:
--   - intentos de escritura que se ejecutan con los roles `anon` y
--     `authenticated` y que DEBEN fallar por falta de permisos; si alguno
--     funcionara, se deshace al momento y se marca como FALLO;
--   - un TRUNCATE de la tabla temporal de resultados de este propio script.
-- Ninguna de ellas modifica tablas, políticas ni funciones reales.
--
-- No deja cambios en la base de datos ni en la sesión:
--   - simula peticiones como `anon` y `authenticated` cambiando de rol dentro
--     de la transacción, igual que hace Supabase con cada petición; el rol
--     original y las variables de los claims se restauran con cambios locales
--     a la transacción, que desaparecen al terminar;
--   - cada intento de escritura se ejecuta en un bloque que se revierte
--     siempre; si una escritura que debería estar prohibida funciona, se
--     deshace al momento y se marca como FALLO;
--   - el resultado se muestra desde una tabla temporal que desaparece al cerrar
--     la sesión.
--
-- Resultado esperado: todas las filas con `resultado` que empieza por 'OK',
-- salvo una fila informativa ('INFO') que indica si el UUID de la segunda
-- cuenta existe en auth.users. Un error de permisos en cualquier prueba se
-- registra como 'FALLO (error <código>: <mensaje>)' sin detener el script.
-- =============================================================================

create temp table if not exists rls_check_results (
  n int,
  grupo text,
  comprobacion text,
  resultado text
);
truncate pg_temp.rls_check_results;

do $$
declare
  -- ---------------------------------------------------------------- CONFIGURACIÓN
  -- UUID de la cuenta autorizada (Authentication → Users), ya añadida a profiles.
  v_authorized uuid := '00000000-0000-0000-0000-000000000000';
  -- UUID de una segunda cuenta autenticada SIN autorización (recomendado:
  -- crea una cuenta de prueba en Authentication → Users y no la añadas a
  -- profiles). Si lo dejas en null, se usa un UUID aleatorio.
  v_unauthorized uuid := null;
  -- ---------------------------------------------------------------------------

  -- Rol con el que se ejecuta el script (debe ser postgres). Se restaura
  -- con set_config('role', …, true), que es local a la transacción; RESET ROLE
  -- cambiaría el rol de toda la sesión.
  v_original_role text := current_user;
  v_unauthorized_is_random boolean;
  r text[] := '{}';            -- resultados: grupo|comprobación|resultado
  v_count int;
  v_bool boolean;
  v_text text;
  stmt text;
  denied_writes text[];
begin
  if v_authorized = '00000000-0000-0000-0000-000000000000' then
    raise exception 'Sustituye v_authorized por el UUID de la cuenta autorizada antes de ejecutar el script.';
  end if;
  v_unauthorized_is_random := v_unauthorized is null;
  v_unauthorized := coalesce(v_unauthorized, gen_random_uuid());
  if v_unauthorized = v_authorized then
    raise exception 'v_unauthorized debe ser una cuenta distinta de v_authorized.';
  end if;

  -- =========================================================== 1. Configuración
  select c.relrowsecurity into v_bool
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'profiles';
  r := r || format('configuración|RLS activado en public.profiles|%s',
    case when v_bool then 'OK' else 'FALLO' end);

  select string_agg(policyname || ':' || cmd, ', ' order by policyname), count(*)
    into v_text, v_count
  from pg_policies where schemaname = 'public' and tablename = 'profiles';
  r := r || format('configuración|Única política: profiles_select_own (SELECT)|%s',
    case when v_count = 1 and v_text = 'profiles_select_own:SELECT' then 'OK'
         else 'FALLO (' || coalesce(v_text, 'ninguna') || ')' end);

  r := r || format('configuración|anon sin privilegios sobre profiles|%s',
    case when not has_table_privilege('anon', 'public.profiles', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
         then 'OK' else 'FALLO' end);

  r := r || format('configuración|authenticated: solo SELECT sobre profiles|%s',
    case when has_table_privilege('authenticated', 'public.profiles', 'SELECT')
          and not has_table_privilege('authenticated', 'public.profiles', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
         then 'OK' else 'FALLO' end);

  select p.prosecdef
     and coalesce(p.proconfig @> array['search_path=""'], false)
     and pg_get_userbyid(p.proowner) = (select tableowner from pg_tables where schemaname = 'public' and tablename = 'profiles')
    into v_bool
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private' and p.proname = 'is_authorized' and p.pronargs = 0;
  r := r || format('configuración|private.is_authorized(): SECURITY DEFINER, search_path vacío, mismo propietario que profiles|%s',
    case when v_bool then 'OK' else 'FALLO' end);

  r := r || format('configuración|is_authorized(): EXECUTE solo para authenticated|%s',
    case when has_function_privilege('authenticated', 'private.is_authorized()', 'EXECUTE')
          and not has_function_privilege('anon', 'private.is_authorized()', 'EXECUTE')
          and not exists (
            select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
            where p.oid = 'private.is_authorized()'::regprocedure and a.grantee = 0
          )
         then 'OK' else 'FALLO' end);

  r := r || format('configuración|Esquema private: anon sin acceso; nadie salvo el propietario puede crear|%s',
    case when not has_schema_privilege('anon', 'private', 'USAGE')
          and not has_schema_privilege('anon', 'private', 'CREATE')
          and not has_schema_privilege('authenticated', 'private', 'CREATE')
          and not exists (
            select 1 from pg_namespace n, aclexplode(n.nspacl) a
            where n.nspname = 'private' and a.grantee = 0
          )
         then 'OK' else 'FALLO' end);

  select count(*) into v_count from public.profiles where id = v_authorized;
  r := r || format('configuración|La cuenta autorizada tiene fila en profiles|%s',
    case when v_count = 1 then 'OK' else 'FALLO (añádela antes: ver SUPABASE_SETUP.md)' end);

  select count(*) into v_count from public.profiles where id = v_unauthorized;
  r := r || format('configuración|La segunda cuenta NO tiene fila en profiles|%s',
    case when v_count = 0 then 'OK' else 'FALLO' end);

  -- Solo lectura de auth.users: no se crea ni modifica ninguna cuenta.
  select count(*) into v_count from auth.users where id = v_unauthorized;
  r := r || format('configuración|Segunda cuenta: existe en auth.users|%s',
    case
      when v_unauthorized_is_random then 'INFO: UUID aleatorio (no es una cuenta real; la prueba de RLS sigue siendo válida)'
      when v_count = 1 then 'INFO: sí, es una cuenta real'
      else 'INFO: no existe; revisa el UUID de v_unauthorized'
    end);

  -- Escrituras que ningún cliente debe poder hacer. %1$s = UUID de la sesión.
  denied_writes := array[
    'insert into public.profiles (id) values (%1$L)',
    'update public.profiles set display_name = ''x''',
    'update public.profiles set id = %1$L',
    'delete from public.profiles',
    'alter table public.profiles disable row level security',
    'drop policy profiles_select_own on public.profiles',
    'create policy permitir_todo on public.profiles for all to authenticated using (true) with check (true)',
    'create or replace function private.is_authorized() returns boolean language sql as $f$ select true $f$',
    'create function private.puerta_trasera() returns boolean language sql as $f$ select true $f$'
  ];

  -- =========================================================== 2. Sin sesión (anon)
  -- auth.uid() lee primero request.jwt.claim.sub y, si está vacío,
  -- request.jwt.claims. Se fijan ambos para que no influya ningún valor
  -- previo de la sesión.
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
  set local role anon;

  begin
    select count(*) into v_count from public.profiles;
    r := r || format('anon|Leer profiles|FALLO (lee %s filas)', v_count);
  exception when insufficient_privilege then
    r := r || text 'anon|Leer profiles|OK (denegado)';
  end;

  begin
    v_bool := private.is_authorized();
    r := r || format('anon|Ejecutar is_authorized()|FALLO (devuelve %s)', v_bool);
  exception when insufficient_privilege then
    r := r || text 'anon|Ejecutar is_authorized()|OK (denegado)';
  end;

  begin
    execute format(denied_writes[1], gen_random_uuid());
    raise exception 'NO_DENEGADO';
  exception
    when insufficient_privilege then r := r || text 'anon|Insertarse en profiles|OK (denegado)';
    when raise_exception then r := r || text 'anon|Insertarse en profiles|FALLO (permitido; revertido)';
    when others then r := r || format('anon|Insertarse en profiles|FALLO (%s)', sqlerrm);
  end;

  perform set_config('role', v_original_role, true);

  -- ===================================== 3. Autenticada pero NO autorizada
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_unauthorized, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_unauthorized::text, true);
  set local role authenticated;

  begin
    v_bool := private.is_authorized();
    r := r || format('no autorizada|is_authorized() devuelve false|%s',
      case when v_bool = false then 'OK' else format('FALLO (devuelve %s)', coalesce(v_bool::text, 'null')) end);
  exception when others then
    r := r || format('no autorizada|is_authorized() devuelve false|FALLO (error %s: %s)', sqlstate, replace(sqlerrm, '|', '/'));
  end;

  begin
    select count(*) into v_count from public.profiles;
    r := r || format('no autorizada|No ve ninguna fila de profiles|%s',
      case when v_count = 0 then 'OK' else format('FALLO (ve %s)', v_count) end);
  exception when others then
    r := r || format('no autorizada|No ve ninguna fila de profiles|FALLO (error %s: %s)', sqlstate, replace(sqlerrm, '|', '/'));
  end;

  foreach stmt in array denied_writes loop
    begin
      execute format(stmt, v_unauthorized);
      raise exception 'NO_DENEGADO';
    exception
      when insufficient_privilege then
        r := r || format('no autorizada|%s|OK (denegado)', left(format(stmt, v_unauthorized), 70));
      when raise_exception then
        r := r || format('no autorizada|%s|FALLO (permitido; revertido)', left(format(stmt, v_unauthorized), 70));
      when others then
        r := r || format('no autorizada|%s|FALLO (%s)', left(format(stmt, v_unauthorized), 70), sqlerrm);
    end;
  end loop;

  perform set_config('role', v_original_role, true);

  -- =========================================================== 4. Autorizada
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_authorized, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_authorized::text, true);
  set local role authenticated;

  begin
    v_bool := private.is_authorized();
    r := r || format('autorizada|is_authorized() devuelve true|%s',
      case when v_bool then 'OK' else format('FALLO (devuelve %s)', coalesce(v_bool::text, 'null')) end);
  exception when others then
    r := r || format('autorizada|is_authorized() devuelve true|FALLO (error %s: %s)', sqlstate, replace(sqlerrm, '|', '/'));
  end;

  begin
    select count(*) into v_count from public.profiles where id = v_authorized;
    r := r || format('autorizada|Lee su propia fila|%s',
      case when v_count = 1 then 'OK' else format('FALLO (ve %s)', v_count) end);
  exception when others then
    r := r || format('autorizada|Lee su propia fila|FALLO (error %s: %s)', sqlstate, replace(sqlerrm, '|', '/'));
  end;

  begin
    select count(*) into v_count from public.profiles where id <> v_authorized;
    r := r || format('autorizada|No ve filas de otras cuentas|%s',
      case when v_count = 0 then 'OK' else format('FALLO (ve %s)', v_count) end);
  exception when others then
    r := r || format('autorizada|No ve filas de otras cuentas|FALLO (error %s: %s)', sqlstate, replace(sqlerrm, '|', '/'));
  end;

  -- Tampoco puede modificar ni retirar su propia autorización desde el cliente.
  foreach stmt in array denied_writes[1:4] loop
    begin
      execute format(stmt, v_authorized);
      raise exception 'NO_DENEGADO';
    exception
      when insufficient_privilege then
        r := r || format('autorizada|%s|OK (denegado)', left(format(stmt, v_authorized), 70));
      when raise_exception then
        r := r || format('autorizada|%s|FALLO (permitido; revertido)', left(format(stmt, v_authorized), 70));
      when others then
        r := r || format('autorizada|%s|FALLO (%s)', left(format(stmt, v_authorized), 70), sqlerrm);
    end;
  end loop;

  perform set_config('role', v_original_role, true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);

  insert into pg_temp.rls_check_results (n, grupo, comprobacion, resultado)
  select i, split_part(r[i], '|', 1), split_part(r[i], '|', 2), split_part(r[i], '|', 3)
  from generate_subscripts(r, 1) as i;
end;
$$;

select n, grupo, comprobacion, resultado
from pg_temp.rls_check_results
order by n;
