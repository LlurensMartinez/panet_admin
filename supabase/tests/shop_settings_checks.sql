-- =============================================================================
-- Panet Admin · Comprobaciones de la configuración de la tienda y del origen de
-- los festivos (`shop_settings` y `holidays.source`)
-- =============================================================================
--
-- Uso: SQL Editor de Supabase o `psql`, DESPUÉS de aplicar la migración
-- 20261104160000_shop_settings_official_holidays.sql. Ver SUPABASE_SETUP.md,
-- sección 13.
--
-- Antes de ejecutar:
--   1. En el SQL Editor, el selector «Role» debe estar en `postgres`.
--   2. Sustituye los valores de la sección CONFIGURACIÓN (los mismos UUID que
--      en authorization_checks.sql). No guardes los UUID reales en Git.
--   3. Ejecuta el script entero de una vez: la tabla de resultados es lo que
--      devuelve la última sentencia.
--
-- Aviso de «operaciones destructivas»: el SQL Editor puede advertir de que el
-- script contiene DELETE, UPDATE o TRUNCATE. Son intentos que DEBEN fallar o no
-- afectar a ninguna fila, escrituras sobre datos de prueba que el propio script
-- deshace, y un TRUNCATE de su tabla temporal de resultados.
--
-- No deja cambios: todo ocurre dentro de un bloque que termina SIEMPRE con un
-- error forzado, así que PostgreSQL lo deshace (la última fila lo comprueba).
-- Si la tienda ya tiene municipio configurado, se conserva.
--
-- Resultado esperado: todas las filas con `resultado` que empieza por 'OK',
-- salvo las informativas ('INFO').
-- =============================================================================

create temp table if not exists shop_check_results (
  n int,
  grupo text,
  comprobacion text,
  resultado text
);
truncate pg_temp.shop_check_results;

do $$
declare
  -- ---------------------------------------------------------------- CONFIGURACIÓN
  -- UUID de la cuenta autorizada (Authentication → Users), ya añadida a profiles.
  v_authorized uuid := '00000000-0000-0000-0000-000000000000';
  -- UUID de una segunda cuenta autenticada SIN autorización. Si lo dejas en
  -- null, se usa un UUID aleatorio.
  v_unauthorized uuid := null;
  -- ---------------------------------------------------------------------------

  v_original_role text := current_user;
  r text[] := '{}';            -- resultados: grupo|comprobación|resultado
  v_count int;
  v_bool boolean;
  v_text text;
  v_before text;               -- fila de configuración antes de las pruebas
  v_holidays_before text;
  t text[];
  denied text[];
  rejected text[];
begin
  if v_authorized = '00000000-0000-0000-0000-000000000000' then
    raise exception 'Sustituye v_authorized por el UUID de la cuenta autorizada antes de ejecutar el script.';
  end if;
  if to_regclass('public.shop_settings') is null then
    raise exception 'Falta la tabla shop_settings: aplica antes la migración 20261104160000_shop_settings_official_holidays.sql.';
  end if;
  v_unauthorized := coalesce(v_unauthorized, gen_random_uuid());
  if v_unauthorized = v_authorized then
    raise exception 'v_unauthorized debe ser una cuenta distinta de v_authorized.';
  end if;

  select coalesce(string_agg(format('%s|%s|%s', id, municipality_code, municipality_name), ';'), '') into v_before from public.shop_settings;
  select md5(coalesce(string_agg(format('%s|%s|%s|%s', id, holiday_date, name, source), ';' order by id), '')) into v_holidays_before from public.holidays;

  -- =========================================================== 1. Configuración
  select c.relrowsecurity into v_bool from pg_class c where c.oid = 'public.shop_settings'::regclass;
  r := r || format('configuración|RLS activado en shop_settings|%s', case when v_bool then 'OK' else 'FALLO' end);

  select string_agg(policyname || ':' || cmd, ', ' order by policyname) into v_text
  from pg_policies where schemaname = 'public' and tablename = 'shop_settings';
  r := r || format('configuración|Políticas SELECT, INSERT y UPDATE (sin DELETE)|%s',
    case when v_text = 'shop_settings_insert_authorized:INSERT, shop_settings_select_authorized:SELECT, shop_settings_update_authorized:UPDATE'
         then 'OK' else 'FALLO (' || coalesce(v_text, 'ninguna') || ')' end);

  select string_agg(policyname, ', ' order by policyname) into v_text
  from pg_policies
  where schemaname = 'public' and tablename = 'shop_settings'
    and not coalesce(
      permissive = 'PERMISSIVE'
      and roles = array['authenticated']::name[]
      and case cmd
            when 'SELECT' then qual like '%private.is_authorized()%' and with_check is null
            when 'INSERT' then qual is null and with_check like '%private.is_authorized()%'
            when 'UPDATE' then qual like '%private.is_authorized()%' and with_check like '%private.is_authorized()%'
            else false
          end,
      false);
  r := r || format('configuración|Todas las políticas: solo authenticated y basadas en is_authorized()|%s',
    case when v_text is null then 'OK' else 'FALLO (' || v_text || ')' end);

  r := r || format('configuración|anon sin privilegios sobre shop_settings|%s',
    case when not has_table_privilege('anon', 'public.shop_settings', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
          and not has_any_column_privilege('anon', 'public.shop_settings', 'SELECT,INSERT,UPDATE,REFERENCES')
         then 'OK' else 'FALLO' end);

  r := r || format('configuración|authenticated: SELECT, INSERT y UPDATE; sin DELETE ni TRUNCATE|%s',
    case when has_table_privilege('authenticated', 'public.shop_settings', 'SELECT')
          and has_table_privilege('authenticated', 'public.shop_settings', 'INSERT')
          and has_table_privilege('authenticated', 'public.shop_settings', 'UPDATE')
          and not has_table_privilege('authenticated', 'public.shop_settings', 'DELETE,TRUNCATE,REFERENCES,TRIGGER')
         then 'OK' else 'FALLO' end);

  r := r || format('configuración|Sin privilegios para PUBLIC|%s',
    case when not exists (
            select 1 from pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
            where c.oid = 'public.shop_settings'::regclass and a.grantee = 0)
         then 'OK' else 'FALLO' end);

  select count(*) into v_count
  from pg_trigger tg
  where not tg.tgisinternal and tg.tgenabled = 'O'
    and tg.tgfoid = 'private.set_updated_at()'::regprocedure
    and tg.tgrelid = 'public.shop_settings'::regclass;
  r := r || format('configuración|Trigger de updated_at activo|%s',
    case when v_count = 1 then 'OK' else format('FALLO (%s encontrados)', v_count) end);

  select format('%s:%s:%s', format_type(a.atttypid, a.atttypmod), case when a.attnotnull then 'not null' else 'null' end, pg_get_expr(d.adbin, d.adrelid))
  into v_text
  from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  where a.attrelid = 'public.holidays'::regclass and a.attname = 'source' and not a.attisdropped;
  r := r || format('configuración|holidays.source: texto obligatorio, «manual» por defecto|%s',
    case when v_text = 'text:not null:''manual''::text' then 'OK' else 'FALLO (' || coalesce(v_text, 'no existe') || ')' end);

  select count(*) into v_count from public.holidays where source <> 'manual';
  r := r || format('configuración|Festivos existentes|%s',
    case when v_count = 0 then 'INFO: todos manuales'
         else format('INFO: %s importados del calendario oficial', v_count) end);

  r := r || format('configuración|Configuración actual de la tienda|INFO: %s',
    case when v_before = '' then 'sin configurar' else v_before end);

  -- ============================================ Pruebas con datos (se deshacen)
  begin
    -- Punto de partida conocido: sin fila de configuración (se deshace al final).
    delete from public.shop_settings;

    -- ========================================================= 2. Sin sesión (anon)
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    perform set_config('request.jwt.claim.sub', '', true);
    set local role anon;
    denied := array[
      ['Leer la configuración', 'select count(*) from public.shop_settings'],
      ['Crear la configuración', 'insert into public.shop_settings (municipality_code, municipality_name) values (''08005'', ''X'')'],
      ['Modificar la configuración', 'update public.shop_settings set municipality_code = ''08019'''],
      ['Borrar la configuración', 'delete from public.shop_settings']
    ];
    foreach t slice 1 in array denied loop
      begin
        execute t[2];
        raise exception 'NO_DENEGADO';
      exception
        when insufficient_privilege then r := r || format('anon|%s|OK (denegado)', t[1]);
        when raise_exception then r := r || format('anon|%s|FALLO (permitido; revertido)', t[1]);
        when others then r := r || format('anon|%s|FALLO (error %s: %s)', t[1], sqlstate, replace(sqlerrm, '|', '/'));
      end;
    end loop;
    perform set_config('role', v_original_role, true);

    -- Fila de prueba creada como postgres para las pruebas de lectura y escritura.
    insert into public.shop_settings (municipality_code, municipality_name, updated_at)
    values ('08005', 'L''Ametlla del Vallès (prueba)', '2000-01-01');

    -- ===================================== 3. Autenticada pero NO autorizada
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_unauthorized, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', v_unauthorized::text, true);
    set local role authenticated;

    begin
      select count(*) into v_count from public.shop_settings;
      r := r || format('no autorizada|No ve la configuración|%s', case when v_count = 0 then 'OK' else format('FALLO (ve %s)', v_count) end);
    exception when others then
      r := r || format('no autorizada|No ve la configuración|FALLO (error %s: %s)', sqlstate, replace(sqlerrm, '|', '/'));
    end;

    begin
      update public.shop_settings set municipality_code = '08019', municipality_name = 'Barcelona';
      get diagnostics v_count = row_count;
      r := r || format('no autorizada|Cambiar el municipio|%s', case when v_count = 0 then 'OK (0 filas afectadas)' else format('FALLO (%s filas)', v_count) end);
    exception
      when insufficient_privilege then r := r || text 'no autorizada|Cambiar el municipio|OK (denegado)';
      when others then r := r || format('no autorizada|Cambiar el municipio|FALLO (error %s: %s)', sqlstate, replace(sqlerrm, '|', '/'));
    end;

    denied := array[
      ['Crear otra configuración', 'insert into public.shop_settings (id, municipality_code, municipality_name) values (1, ''08019'', ''Barcelona'')'],
      ['Borrar la configuración', 'delete from public.shop_settings'],
      ['Desactivar RLS de shop_settings', 'alter table public.shop_settings disable row level security'],
      ['Crear un festivo oficial', 'insert into public.holidays (holiday_date, name, scope, source) values (''2099-01-01'', ''X'', ''local'', ''official'')']
    ];
    foreach t slice 1 in array denied loop
      begin
        execute t[2];
        raise exception 'NO_DENEGADO';
      exception
        when insufficient_privilege then r := r || format('no autorizada|%s|OK (denegado)', t[1]);
        when raise_exception then r := r || format('no autorizada|%s|FALLO (permitido; revertido)', t[1]);
        when others then r := r || format('no autorizada|%s|FALLO (error %s: %s)', t[1], sqlstate, replace(sqlerrm, '|', '/'));
      end;
    end loop;
    perform set_config('role', v_original_role, true);

    -- =========================================================== 4. Autorizada
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_authorized, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', v_authorized::text, true);
    set local role authenticated;

    begin
      select count(*) into v_count from public.shop_settings where id = 1;
      r := r || format('autorizada|Ve la configuración|%s', case when v_count = 1 then 'OK' else 'FALLO' end);
    exception when others then
      r := r || format('autorizada|Ve la configuración|FALLO (error %s: %s)', sqlstate, replace(sqlerrm, '|', '/'));
    end;

    begin
      update public.shop_settings
      set municipality_code = '08019', municipality_name = 'Barcelona', holidays_synced_at = now()
      where id = 1;
      get diagnostics v_count = row_count;
      select v_count = 1 and s.updated_at = now() into v_bool from public.shop_settings s where s.id = 1;
      r := r || format('autorizada|Cambia el municipio; updated_at se actualiza|%s', case when v_bool then 'OK' else 'FALLO' end);
    exception when others then
      r := r || format('autorizada|Cambia el municipio; updated_at se actualiza|FALLO (error %s: %s)', sqlstate, replace(sqlerrm, '|', '/'));
    end;

    begin
      delete from public.shop_settings;
      raise exception 'NO_DENEGADO';
    exception
      when insufficient_privilege then r := r || text 'autorizada|No puede borrar la configuración|OK (denegado)';
      when raise_exception then r := r || text 'autorizada|No puede borrar la configuración|FALLO (permitido; revertido)';
      when others then r := r || format('autorizada|No puede borrar la configuración|FALLO (error %s: %s)', sqlstate, replace(sqlerrm, '|', '/'));
    end;

    begin
      insert into public.holidays (holiday_date, name, scope, source) values ('2099-08-25', 'Festivo oficial (shop_settings_checks.sql)', 'local', 'official');
      insert into public.holidays (holiday_date, name, scope) values ('2099-08-26', 'Festivo manual (shop_settings_checks.sql)', 'local');
      select count(*) filter (where source = 'official' and holiday_date = '2099-08-25')
           + count(*) filter (where source = 'manual' and holiday_date = '2099-08-26')
      into v_count from public.holidays where holiday_date in ('2099-08-25', '2099-08-26');
      r := r || format('autorizada|Crea festivos oficiales; los demás son manuales por defecto|%s', case when v_count = 2 then 'OK' else 'FALLO' end);
      delete from public.holidays where holiday_date = '2099-08-25' and source = 'official';
      get diagnostics v_count = row_count;
      r := r || format('autorizada|Retira un festivo oficial|%s', case when v_count = 1 then 'OK' else 'FALLO' end);
    exception when others then
      r := r || format('autorizada|Festivos oficiales|FALLO (error %s: %s)', sqlstate, replace(sqlerrm, '|', '/'));
    end;

    -- =================================================== 5. Restricciones (autorizada)
    rejected := array[
      ['Una segunda fila de configuración (id 2)', 'insert into public.shop_settings (id, municipality_code, municipality_name) values (2, ''08005'', ''X'')', '23514'],
      ['Otra fila con id 1', 'insert into public.shop_settings (id, municipality_code, municipality_name) values (1, ''08005'', ''X'')', '23505'],
      ['Código de municipio con 4 cifras', 'update public.shop_settings set municipality_code = ''8005'' where id = 1', '23514'],
      ['Código de municipio con letras', 'update public.shop_settings set municipality_code = ''08A05'' where id = 1', '23514'],
      ['Código sin nombre', 'update public.shop_settings set municipality_name = null where id = 1', '23514'],
      ['Nombre vacío', 'update public.shop_settings set municipality_name = ''   '' where id = 1', '23514'],
      ['Origen de festivo desconocido', 'insert into public.holidays (holiday_date, name, scope, source) values (''2099-09-01'', ''X'', ''local'', ''api'')', '23514'],
      ['Origen de festivo nulo', 'insert into public.holidays (holiday_date, name, scope, source) values (''2099-09-02'', ''X'', ''local'', null)', '23502']
    ];
    foreach t slice 1 in array rejected loop
      begin
        execute t[2];
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

    begin
      update public.shop_settings set municipality_code = null, municipality_name = null where id = 1;
      r := r || text 'restricciones|Se puede dejar sin municipio (código y nombre vacíos)|OK';
    exception when others then
      r := r || format('restricciones|Se puede dejar sin municipio (código y nombre vacíos)|FALLO (error %s: %s)', sqlstate, replace(sqlerrm, '|', '/'));
    end;

    perform set_config('role', v_original_role, true);
    raise exception 'Fin de las pruebas: se deshacen los datos de prueba' using errcode = 'PX999';
  exception
    when sqlstate 'PX999' then
      null;
  end;

  perform set_config('role', v_original_role, true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);

  select coalesce(string_agg(format('%s|%s|%s', id, municipality_code, municipality_name), ';'), '') into v_text from public.shop_settings;
  select md5(coalesce(string_agg(format('%s|%s|%s|%s', id, holiday_date, name, source), ';' order by id), '')) = v_holidays_before into v_bool from public.holidays;
  r := r || format('limpieza|La configuración y los festivos quedan como estaban|%s',
    case when v_text = v_before and v_bool then 'OK' else 'FALLO' end);

  insert into pg_temp.shop_check_results (n, grupo, comprobacion, resultado)
  select i, split_part(r[i], '|', 1), split_part(r[i], '|', 2), split_part(r[i], '|', 3)
  from generate_subscripts(r, 1) as i;
end;
$$;

select n, grupo, comprobacion, resultado
from pg_temp.shop_check_results
order by n;
