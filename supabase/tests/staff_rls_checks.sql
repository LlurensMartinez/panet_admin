-- =============================================================================
-- Panet Admin · Comprobaciones de RLS de trabajadoras y horas extra
-- (tablas `employees` y `overtime_entries`)
-- =============================================================================
--
-- Uso: SQL Editor de Supabase o `psql`, DESPUÉS de aplicar la migración
-- 20261028125000_employees_overtime.sql. Requiere también la de `profiles` y
-- la cuenta autorizada (secciones 5 y 6 de SUPABASE_SETUP.md).
-- Ver SUPABASE_SETUP.md, sección 9.
--
-- Antes de ejecutar:
--   1. En el SQL Editor, el selector «Role» debe estar en `postgres` (sin
--      suplantar a ninguna usuaria). El propio script cambia de rol para
--      simular cada caso; si se lanza ya con otro rol, falla o da resultados
--      engañosos.
--   2. Sustituye los valores de la sección CONFIGURACIÓN (los mismos UUID que
--      en authorization_checks.sql). No guardes los UUID reales en Git.
--   3. Ejecuta el script entero de una vez: la tabla de resultados es lo que
--      devuelve la última sentencia.
--
-- Aviso de «operaciones destructivas»: el SQL Editor puede advertir de que el
-- script contiene DELETE, DROP, TRUNCATE o ALTER. Son:
--   - intentos de escritura y de cambio de políticas que se ejecutan con los
--     roles `anon` y `authenticated` y que DEBEN fallar o no afectar a ninguna
--     fila; si alguno funcionara, se deshace y se marca como FALLO;
--   - escrituras permitidas de la cuenta autorizada sobre filas de prueba que
--     crea el propio script y que se deshacen al final;
--   - un TRUNCATE de la tabla temporal de resultados de este propio script.
-- No se modifican tablas, políticas, funciones ni datos reales.
--
-- No deja cambios en la base de datos ni en la sesión:
--   - crea una trabajadora y un registro de horas extra de prueba para que las
--     comprobaciones de visibilidad tengan datos; todas las pruebas se
--     ejecutan dentro de un bloque que termina SIEMPRE con un error forzado,
--     así que PostgreSQL deshace todas las filas de prueba y cualquier
--     escritura (la última fila del resultado lo comprueba);
--   - simula peticiones como `anon` y `authenticated` cambiando de rol dentro
--     de la transacción, igual que hace Supabase con cada petición; el rol
--     original y las variables de los claims se restauran con cambios locales
--     a la transacción;
--   - el resultado se muestra desde una tabla temporal que desaparece al cerrar
--     la sesión.
--
-- Resultado esperado: todas las filas con `resultado` que empieza por 'OK',
-- salvo una fila informativa ('INFO') que indica si el UUID de la segunda
-- cuenta existe en auth.users. Un error inesperado en cualquier prueba se
-- registra como 'FALLO (error <código>: <mensaje>)' sin detener el script.
-- =============================================================================

create temp table if not exists staff_check_results (
  n int,
  grupo text,
  comprobacion text,
  resultado text
);
truncate pg_temp.staff_check_results;

do $$
declare
  -- ---------------------------------------------------------------- CONFIGURACIÓN
  -- UUID de la cuenta autorizada (Authentication → Users), ya añadida a profiles.
  v_authorized uuid := '00000000-0000-0000-0000-000000000000';
  -- UUID de una segunda cuenta autenticada SIN autorización (recomendado:
  -- la misma cuenta de prueba que en authorization_checks.sql). Si lo dejas
  -- en null, se usa un UUID aleatorio.
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
  v_emp uuid;                  -- trabajadora de prueba (creada como postgres)
  v_entry uuid;                -- registro de prueba de v_emp
  v_new_emp uuid;              -- trabajadora creada por la cuenta autorizada
  t text[];                    -- una prueba: {etiqueta, sentencia[, sqlstate]}
  denied text[];
  no_rows text[];
  rejected text[];
begin
  if v_authorized = '00000000-0000-0000-0000-000000000000' then
    raise exception 'Sustituye v_authorized por el UUID de la cuenta autorizada antes de ejecutar el script.';
  end if;
  if to_regclass('public.employees') is null or to_regclass('public.overtime_entries') is null then
    raise exception 'Faltan las tablas employees u overtime_entries: aplica antes la migración 20261028125000_employees_overtime.sql.';
  end if;
  v_unauthorized_is_random := v_unauthorized is null;
  v_unauthorized := coalesce(v_unauthorized, gen_random_uuid());
  if v_unauthorized = v_authorized then
    raise exception 'v_unauthorized debe ser una cuenta distinta de v_authorized.';
  end if;

  -- =========================================================== 1. Configuración
  select bool_and(c.relrowsecurity) and count(*) = 2 into v_bool
  from pg_class c
  where c.oid in ('public.employees'::regclass, 'public.overtime_entries'::regclass);
  r := r || format('configuración|RLS activado en employees y overtime_entries|%s',
    case when v_bool then 'OK' else 'FALLO' end);

  select string_agg(policyname || ':' || cmd, ', ' order by policyname) into v_text
  from pg_policies where schemaname = 'public' and tablename = 'employees';
  r := r || format('configuración|employees: políticas SELECT, INSERT y UPDATE (sin DELETE)|%s',
    case when v_text = 'employees_insert_authorized:INSERT, employees_select_authorized:SELECT, employees_update_authorized:UPDATE'
         then 'OK' else 'FALLO (' || coalesce(v_text, 'ninguna') || ')' end);

  select string_agg(policyname || ':' || cmd, ', ' order by policyname) into v_text
  from pg_policies where schemaname = 'public' and tablename = 'overtime_entries';
  r := r || format('configuración|overtime_entries: políticas SELECT, INSERT, UPDATE y DELETE|%s',
    case when v_text = 'overtime_entries_delete_authorized:DELETE, overtime_entries_insert_authorized:INSERT, overtime_entries_select_authorized:SELECT, overtime_entries_update_authorized:UPDATE'
         then 'OK' else 'FALLO (' || coalesce(v_text, 'ninguna') || ')' end);

  -- Cada política: permisiva, solo para authenticated y condicionada a
  -- private.is_authorized() en USING y/o WITH CHECK según el comando.
  select string_agg(policyname, ', ' order by policyname) into v_text
  from pg_policies
  where schemaname = 'public' and tablename in ('employees', 'overtime_entries')
    and not coalesce(
      permissive = 'PERMISSIVE'
      and roles = array['authenticated']::name[]
      and case cmd
            when 'SELECT' then qual like '%private.is_authorized()%' and with_check is null
            when 'DELETE' then qual like '%private.is_authorized()%' and with_check is null
            when 'INSERT' then qual is null and with_check like '%private.is_authorized()%'
            when 'UPDATE' then qual like '%private.is_authorized()%' and with_check like '%private.is_authorized()%'
            else false
          end,
      false);
  r := r || format('configuración|Todas las políticas: solo authenticated y basadas en is_authorized()|%s',
    case when v_text is null then 'OK' else 'FALLO (' || v_text || ')' end);

  r := r || format('configuración|anon sin privilegios sobre employees ni overtime_entries|%s',
    case when not has_table_privilege('anon', 'public.employees', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
          and not has_table_privilege('anon', 'public.overtime_entries', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
          and not has_any_column_privilege('anon', 'public.employees', 'SELECT,INSERT,UPDATE,REFERENCES')
          and not has_any_column_privilege('anon', 'public.overtime_entries', 'SELECT,INSERT,UPDATE,REFERENCES')
         then 'OK' else 'FALLO' end);

  r := r || format('configuración|authenticated en employees: SELECT, INSERT y UPDATE; sin DELETE ni TRUNCATE|%s',
    case when has_table_privilege('authenticated', 'public.employees', 'SELECT')
          and has_table_privilege('authenticated', 'public.employees', 'INSERT')
          and has_table_privilege('authenticated', 'public.employees', 'UPDATE')
          and not has_table_privilege('authenticated', 'public.employees', 'DELETE,TRUNCATE,REFERENCES,TRIGGER')
         then 'OK' else 'FALLO' end);

  r := r || format('configuración|authenticated en overtime_entries: SELECT, INSERT, UPDATE y DELETE; sin TRUNCATE|%s',
    case when has_table_privilege('authenticated', 'public.overtime_entries', 'SELECT')
          and has_table_privilege('authenticated', 'public.overtime_entries', 'INSERT')
          and has_table_privilege('authenticated', 'public.overtime_entries', 'UPDATE')
          and has_table_privilege('authenticated', 'public.overtime_entries', 'DELETE')
          and not has_table_privilege('authenticated', 'public.overtime_entries', 'TRUNCATE,REFERENCES,TRIGGER')
         then 'OK' else 'FALLO' end);

  r := r || format('configuración|Sin privilegios para PUBLIC en las dos tablas|%s',
    case when not exists (
            select 1 from pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
            where c.oid in ('public.employees'::regclass, 'public.overtime_entries'::regclass)
              and a.grantee = 0
          )
         then 'OK' else 'FALLO' end);

  select count(*) into v_count
  from pg_constraint
  where conrelid = 'public.overtime_entries'::regclass
    and contype = 'f'
    and confrelid = 'public.employees'::regclass
    and confdeltype = 'r';
  r := r || format('configuración|Clave foránea overtime_entries → employees con ON DELETE RESTRICT|%s',
    case when v_count = 1 then 'OK' else format('FALLO (%s encontradas)', v_count) end);

  select count(*) into v_count
  from pg_trigger tg
  where not tg.tgisinternal
    and tg.tgenabled = 'O'
    and tg.tgfoid = 'private.set_updated_at()'::regprocedure
    and tg.tgrelid in ('public.employees'::regclass, 'public.overtime_entries'::regclass);
  r := r || format('configuración|Triggers de updated_at activos en las dos tablas|%s',
    case when v_count = 2 then 'OK' else format('FALLO (%s encontrados)', v_count) end);

  select count(*) into v_count
  from pg_index i
  where i.indrelid = 'public.overtime_entries'::regclass
    and i.indkey::text = (
      select string_agg(a.attnum::text, ' ' order by array_position(array['employee_id', 'work_date'], a.attname::text))
      from pg_attribute a
      where a.attrelid = 'public.overtime_entries'::regclass
        and a.attname in ('employee_id', 'work_date')
    );
  r := r || format('configuración|Índice (employee_id, work_date) en overtime_entries|%s',
    case when v_count >= 1 then 'OK' else 'FALLO' end);

  select count(*) into v_count from public.profiles where id = v_authorized;
  r := r || format('configuración|La cuenta autorizada tiene fila en profiles|%s',
    case when v_count = 1 then 'OK' else 'FALLO (añádela antes: ver SUPABASE_SETUP.md, sección 6)' end);

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

  -- ============================================ Pruebas con datos (se deshacen)
  -- Todo lo que sigue va dentro de este bloque, que termina con un error
  -- forzado (código PX999): PostgreSQL deshace entonces todas las filas de
  -- prueba y cualquier escritura hecha dentro, permitida o no.
  begin
    -- Datos de prueba, creados como postgres. updated_at antiguo para poder
    -- comprobar después que el trigger lo actualiza.
    insert into public.employees (first_name, last_name, notes, updated_at)
    values ('Prueba', 'Comprobaciones RLS', 'Fila temporal de staff_rls_checks.sql', '2000-01-01')
    returning id into v_emp;
    insert into public.overtime_entries (employee_id, work_date, duration_minutes, updated_at)
    values (v_emp, current_date, 30, '2000-01-01')
    returning id into v_entry;

    -- ========================================================= 2. Sin sesión (anon)
    -- auth.uid() lee primero request.jwt.claim.sub y, si está vacío,
    -- request.jwt.claims. Se fijan ambos para que no influya ningún valor
    -- previo de la sesión. %1$L = trabajadora de prueba, %2$L = su registro.
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    perform set_config('request.jwt.claim.sub', '', true);
    set local role anon;

    denied := array[
      ['Leer employees', 'select count(*) from public.employees'],
      ['Leer overtime_entries', 'select count(*) from public.overtime_entries'],
      ['Crear trabajadora', 'insert into public.employees (first_name, last_name) values (''X'', ''Y'')'],
      ['Crear registro de horas extra', 'insert into public.overtime_entries (employee_id, work_date, duration_minutes) values (%1$L, current_date, 60)'],
      ['Modificar trabajadoras', 'update public.employees set notes = ''x'''],
      ['Modificar registros de horas extra', 'update public.overtime_entries set duration_minutes = 60'],
      ['Eliminar registros de horas extra', 'delete from public.overtime_entries'],
      ['Eliminar trabajadoras', 'delete from public.employees'],
      ['TRUNCATE employees', 'truncate public.employees cascade'],
      ['TRUNCATE overtime_entries', 'truncate public.overtime_entries']
    ];
    foreach t slice 1 in array denied loop
      begin
        execute format(t[2], v_emp, v_entry);
        raise exception 'NO_DENEGADO';
      exception
        when insufficient_privilege then r := r || format('anon|%s|OK (denegado)', t[1]);
        when raise_exception then r := r || format('anon|%s|FALLO (permitido; revertido)', t[1]);
        when others then r := r || format('anon|%s|FALLO (error %s: %s)', t[1], sqlstate, replace(sqlerrm, '|', '/'));
      end;
    end loop;

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
      select count(*) into v_count from public.employees;
      r := r || format('no autorizada|No ve ninguna trabajadora|%s',
        case when v_count = 0 then 'OK' else format('FALLO (ve %s)', v_count) end);
    exception when others then
      r := r || format('no autorizada|No ve ninguna trabajadora|FALLO (error %s: %s)', sqlstate, replace(sqlerrm, '|', '/'));
    end;

    begin
      select count(*) into v_count from public.overtime_entries;
      r := r || format('no autorizada|No ve ningún registro de horas extra|%s',
        case when v_count = 0 then 'OK' else format('FALLO (ve %s)', v_count) end);
    exception when others then
      r := r || format('no autorizada|No ve ningún registro de horas extra|FALLO (error %s: %s)', sqlstate, replace(sqlerrm, '|', '/'));
    end;

    -- Deben fallar con error de permisos (RLS o falta de privilegio).
    denied := array[
      ['Crear trabajadora', 'insert into public.employees (first_name, last_name) values (''X'', ''Y'')'],
      ['Crear registro de horas extra', 'insert into public.overtime_entries (employee_id, work_date, duration_minutes) values (%1$L, current_date, 60)'],
      ['Eliminar la trabajadora de prueba', 'delete from public.employees where id = %1$L'],
      ['TRUNCATE employees', 'truncate public.employees cascade'],
      ['TRUNCATE overtime_entries', 'truncate public.overtime_entries'],
      ['Desactivar RLS de employees', 'alter table public.employees disable row level security'],
      ['Desactivar RLS de overtime_entries', 'alter table public.overtime_entries disable row level security'],
      ['Borrar la política de lectura de overtime_entries', 'drop policy overtime_entries_select_authorized on public.overtime_entries'],
      ['Crear una política abierta en employees', 'create policy permitir_todo on public.employees for all to authenticated using (true) with check (true)']
    ];
    foreach t slice 1 in array denied loop
      begin
        execute format(t[2], v_emp, v_entry);
        raise exception 'NO_DENEGADO';
      exception
        when insufficient_privilege then r := r || format('no autorizada|%s|OK (denegado)', t[1]);
        when raise_exception then r := r || format('no autorizada|%s|FALLO (permitido; revertido)', t[1]);
        when others then r := r || format('no autorizada|%s|FALLO (error %s: %s)', t[1], sqlstate, replace(sqlerrm, '|', '/'));
      end;
    end loop;

    -- Con RLS, UPDATE y DELETE sobre filas invisibles no dan error: no afectan
    -- a ninguna fila (igual que la API devuelve 200 con una lista vacía).
    no_rows := array[
      ['Modificar la trabajadora de prueba', 'update public.employees set notes = ''modificada'' where id = %1$L'],
      ['Desactivar la trabajadora de prueba', 'update public.employees set is_active = false where id = %1$L'],
      ['Modificar el registro de prueba', 'update public.overtime_entries set duration_minutes = 600 where id = %2$L'],
      ['Eliminar el registro de prueba', 'delete from public.overtime_entries where id = %2$L']
    ];
    foreach t slice 1 in array no_rows loop
      begin
        execute format(t[2], v_emp, v_entry);
        get diagnostics v_count = row_count;
        r := r || format('no autorizada|%s|%s', t[1],
          case when v_count = 0 then 'OK (0 filas afectadas)' else format('FALLO (%s filas afectadas)', v_count) end);
      exception
        when insufficient_privilege then r := r || format('no autorizada|%s|OK (denegado)', t[1]);
        when others then r := r || format('no autorizada|%s|FALLO (error %s: %s)', t[1], sqlstate, replace(sqlerrm, '|', '/'));
      end;
    end loop;

    perform set_config('role', v_original_role, true);

    -- Comprobación como postgres: los datos de prueba siguen igual.
    select count(*) into v_count
    from public.employees e
    join public.overtime_entries o on o.employee_id = e.id
    where e.id = v_emp and o.id = v_entry
      and e.notes = 'Fila temporal de staff_rls_checks.sql' and e.is_active
      and o.duration_minutes = 30;
    r := r || format('no autorizada|Los datos de prueba siguen intactos tras sus intentos|%s',
      case when v_count = 1 then 'OK' else 'FALLO' end);

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
      select count(*) into v_count
      from public.employees e join public.overtime_entries o on o.employee_id = e.id
      where e.id = v_emp and o.id = v_entry;
      r := r || format('autorizada|Ve la trabajadora y el registro de prueba|%s',
        case when v_count = 1 then 'OK' else format('FALLO (ve %s)', v_count) end);
    exception when others then
      r := r || format('autorizada|Ve la trabajadora y el registro de prueba|FALLO (error %s: %s)', sqlstate, replace(sqlerrm, '|', '/'));
    end;

    begin
      insert into public.employees (first_name, last_name, role)
      values ('Alta', 'Desde la app', 'Dependienta')
      returning id into v_new_emp;
      r := r || text 'autorizada|Crea una trabajadora|OK';
    exception when others then
      r := r || format('autorizada|Crea una trabajadora|FALLO (error %s: %s)', sqlstate, replace(sqlerrm, '|', '/'));
    end;

    -- Dos registros de la misma trabajadora el mismo día, con los límites de
    -- duración permitidos (1 y 1440 minutos).
    begin
      insert into public.overtime_entries (employee_id, work_date, duration_minutes, reason)
      values (v_new_emp, current_date, 1, 'Límite inferior'),
             (v_new_emp, current_date, 1440, 'Límite superior');
      select count(*) into v_count from public.overtime_entries
      where employee_id = v_new_emp and work_date = current_date;
      r := r || format('autorizada|Registra horas extra: varios el mismo día, de 1 y de 1440 minutos|%s',
        case when v_count = 2 then 'OK' else format('FALLO (%s registros)', v_count) end);
    exception when others then
      r := r || format('autorizada|Registra horas extra: varios el mismo día, de 1 y de 1440 minutos|FALLO (error %s: %s)', sqlstate, replace(sqlerrm, '|', '/'));
    end;

    begin
      update public.overtime_entries
      set duration_minutes = 45, reason = 'Corrección'
      where id = v_entry;
      get diagnostics v_count = row_count;
      select v_count = 1 and o.duration_minutes = 45 and o.updated_at = now() into v_bool
      from public.overtime_entries o where o.id = v_entry;
      r := r || format('autorizada|Corrige un registro y updated_at se actualiza|%s',
        case when v_bool then 'OK' else 'FALLO' end);
    exception when others then
      r := r || format('autorizada|Corrige un registro y updated_at se actualiza|FALLO (error %s: %s)', sqlstate, replace(sqlerrm, '|', '/'));
    end;

    begin
      update public.employees set is_active = false where id = v_emp;
      get diagnostics v_count = row_count;
      select v_count = 1 and not e.is_active and e.updated_at = now() into v_bool
      from public.employees e where e.id = v_emp;
      r := r || format('autorizada|Desactiva una trabajadora y updated_at se actualiza|%s',
        case when v_bool then 'OK' else 'FALLO' end);
    exception when others then
      r := r || format('autorizada|Desactiva una trabajadora y updated_at se actualiza|FALLO (error %s: %s)', sqlstate, replace(sqlerrm, '|', '/'));
    end;

    begin
      update public.employees set updated_at = '1999-01-01' where id = v_emp;
      select e.updated_at = now() into v_bool from public.employees e where e.id = v_emp;
      r := r || format('autorizada|No puede fijar updated_at desde el cliente (lo fija el trigger)|%s',
        case when v_bool then 'OK' else 'FALLO' end);
    exception when others then
      r := r || format('autorizada|No puede fijar updated_at desde el cliente (lo fija el trigger)|FALLO (error %s: %s)', sqlstate, replace(sqlerrm, '|', '/'));
    end;

    begin
      select count(*) into v_count
      from public.employees e join public.overtime_entries o on o.employee_id = e.id
      where e.id = v_emp and not e.is_active;
      r := r || format('autorizada|La trabajadora desactivada conserva su historial|%s',
        case when v_count = 1 then 'OK' else format('FALLO (%s registros)', v_count) end);
    exception when others then
      r := r || format('autorizada|La trabajadora desactivada conserva su historial|FALLO (error %s: %s)', sqlstate, replace(sqlerrm, '|', '/'));
    end;

    begin
      delete from public.overtime_entries where id = v_entry;
      get diagnostics v_count = row_count;
      r := r || format('autorizada|Elimina un registro de horas extra|%s',
        case when v_count = 1 then 'OK' else format('FALLO (%s filas eliminadas)', v_count) end);
    exception when others then
      r := r || format('autorizada|Elimina un registro de horas extra|FALLO (error %s: %s)', sqlstate, replace(sqlerrm, '|', '/'));
    end;

    -- Ni siquiera la cuenta autorizada puede borrar trabajadoras ni vaciar tablas.
    denied := array[
      ['Eliminar una trabajadora (se desactivan, no se borran)', 'delete from public.employees where id = %1$L'],
      ['TRUNCATE employees', 'truncate public.employees cascade'],
      ['TRUNCATE overtime_entries', 'truncate public.overtime_entries']
    ];
    foreach t slice 1 in array denied loop
      begin
        execute format(t[2], v_new_emp);
        raise exception 'NO_DENEGADO';
      exception
        when insufficient_privilege then r := r || format('autorizada|%s|OK (denegado)', t[1]);
        when raise_exception then r := r || format('autorizada|%s|FALLO (permitido; revertido)', t[1]);
        when others then r := r || format('autorizada|%s|FALLO (error %s: %s)', t[1], sqlstate, replace(sqlerrm, '|', '/'));
      end;
    end loop;

    -- Restricciones: deben rechazarse con el código indicado. %1$L = una
    -- trabajadora existente.
    rejected := array[
      ['Duración 0 minutos', 'insert into public.overtime_entries (employee_id, work_date, duration_minutes) values (%1$L, current_date, 0)', '23514'],
      ['Duración negativa', 'insert into public.overtime_entries (employee_id, work_date, duration_minutes) values (%1$L, current_date, -30)', '23514'],
      ['Duración de 1441 minutos', 'insert into public.overtime_entries (employee_id, work_date, duration_minutes) values (%1$L, current_date, 1441)', '23514'],
      ['Cambiar una duración a 0 minutos', 'update public.overtime_entries set duration_minutes = 0 where employee_id = %1$L', '23514'],
      ['Duración vacía (null)', 'insert into public.overtime_entries (employee_id, work_date, duration_minutes) values (%1$L, current_date, null)', '23502'],
      ['Fecha vacía (null)', 'insert into public.overtime_entries (employee_id, work_date, duration_minutes) values (%1$L, null, 60)', '23502'],
      ['Registro para una trabajadora inexistente', 'insert into public.overtime_entries (employee_id, work_date, duration_minutes) values (gen_random_uuid(), current_date, 60)', '23503'],
      ['Nombre vacío', 'insert into public.employees (first_name, last_name) values ('''', ''Apellido'')', '23514'],
      ['Nombre solo con espacios', 'insert into public.employees (first_name, last_name) values (''   '', ''Apellido'')', '23514'],
      ['Apellidos solo con tabuladores y saltos de línea', 'insert into public.employees (first_name, last_name) values (''Nombre'', E''\t\n '')', '23514'],
      ['Cambiar el nombre a espacios', 'update public.employees set first_name = ''  '' where id = %1$L', '23514'],
      ['Nombre vacío (null)', 'insert into public.employees (first_name, last_name) values (null, ''Apellido'')', '23502']
    ];
    foreach t slice 1 in array rejected loop
      begin
        execute format(t[2], v_new_emp);
        raise exception 'NO_RECHAZADO';
      exception
        when raise_exception then
          r := r || format('restricciones|%s|FALLO (aceptado; revertido)', t[1]);
        when others then
          r := r || format('restricciones|%s|%s', t[1],
            case when sqlstate = t[3] then format('OK (rechazado, %s)', sqlstate)
                 else format('FALLO (error %s: %s)', sqlstate, replace(sqlerrm, '|', '/')) end);
      end;
    end loop;

    perform set_config('role', v_original_role, true);

    -- Como postgres: ni desde el panel se puede borrar una trabajadora con
    -- registros (ON DELETE RESTRICT).
    begin
      delete from public.employees where id = v_new_emp;
      raise exception 'NO_RECHAZADO';
    exception
      when foreign_key_violation then
        r := r || text 'restricciones|Borrar una trabajadora con registros (como postgres)|OK (rechazado, 23503)';
      when raise_exception then
        r := r || text 'restricciones|Borrar una trabajadora con registros (como postgres)|FALLO (borrada; revertido)';
      when others then
        r := r || format('restricciones|Borrar una trabajadora con registros (como postgres)|FALLO (error %s: %s)', sqlstate, replace(sqlerrm, '|', '/'));
    end;

    -- Fin de las pruebas con datos: error forzado para deshacerlo todo.
    raise exception 'Fin de las pruebas: se deshacen los datos de prueba' using errcode = 'PX999';
  exception
    when sqlstate 'PX999' then
      null;
  end;

  -- Por si alguna prueba ha cambiado el rol o los claims antes de un error.
  perform set_config('role', v_original_role, true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);

  select count(*) into v_count
  from public.employees
  where id in (v_emp, v_new_emp);
  r := r || format('limpieza|No queda ningún dato de prueba|%s',
    case when v_count = 0 and v_emp is not null then 'OK' else format('FALLO (%s filas)', v_count) end);

  insert into pg_temp.staff_check_results (n, grupo, comprobacion, resultado)
  select i, split_part(r[i], '|', 1), split_part(r[i], '|', 2), split_part(r[i], '|', 3)
  from generate_subscripts(r, 1) as i;
end;
$$;

select n, grupo, comprobacion, resultado
from pg_temp.staff_check_results
order by n;
