-- =============================================================================
-- Panet Admin · Comprobaciones del calendario de proveedores
-- (columnas nuevas de `suppliers`: antelación por día, quincenales, a demanda y
-- hora límite)
-- =============================================================================
--
-- Uso: SQL Editor de Supabase o `psql`, DESPUÉS de aplicar la migración
-- 20261104130000_supplier_schedule_rules.sql. Requiere también las de
-- `profiles` y de proveedores, y la cuenta autorizada (secciones 5, 6 y 10 de
-- SUPABASE_SETUP.md). Ver SUPABASE_SETUP.md, sección 12.
--
-- Antes de ejecutar:
--   1. En el SQL Editor, el selector «Role» debe estar en `postgres` (sin
--      suplantar a ninguna usuaria). El propio script cambia de rol para
--      simular cada caso.
--   2. Sustituye los valores de la sección CONFIGURACIÓN (los mismos UUID que
--      en authorization_checks.sql). No guardes los UUID reales en Git.
--   3. Ejecuta el script entero de una vez: la tabla de resultados es lo que
--      devuelve la última sentencia.
--
-- Aviso de «operaciones destructivas»: el SQL Editor puede advertir de que el
-- script contiene UPDATE o TRUNCATE. Son escrituras sobre proveedores de prueba
-- que el propio script crea y deshace, intentos con `anon` y con una cuenta no
-- autorizada que DEBEN fallar o no afectar a ninguna fila, y un TRUNCATE de su
-- tabla temporal de resultados. No se modifican tablas, políticas ni datos
-- reales.
--
-- No deja cambios: todo ocurre dentro de un bloque que termina SIEMPRE con un
-- error forzado, así que PostgreSQL lo deshace (la última fila lo comprueba).
--
-- Resultado esperado: todas las filas con `resultado` que empieza por 'OK'.
-- =============================================================================

create temp table if not exists schedule_check_results (
  n int,
  grupo text,
  comprobacion text,
  resultado text
);
truncate pg_temp.schedule_check_results;

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
  v_sup uuid;                  -- proveedor de prueba
  v_new uuid;                  -- proveedor creado por la cuenta autorizada
  t text[];
  rejected text[];
begin
  if v_authorized = '00000000-0000-0000-0000-000000000000' then
    raise exception 'Sustituye v_authorized por el UUID de la cuenta autorizada antes de ejecutar el script.';
  end if;
  if not exists (
    select 1 from pg_attribute
    where attrelid = 'public.suppliers'::regclass and attname = 'order_mode' and not attisdropped
  ) then
    raise exception 'Faltan las columnas nuevas: aplica antes la migración 20261104130000_supplier_schedule_rules.sql.';
  end if;
  v_unauthorized := coalesce(v_unauthorized, gen_random_uuid());
  if v_unauthorized = v_authorized then
    raise exception 'v_unauthorized debe ser una cuenta distinta de v_authorized.';
  end if;

  -- =========================================================== 1. Configuración
  select string_agg(format('%s:%s:%s', a.attname, format_type(a.atttypid, a.atttypmod), case when a.attnotnull then 'not null' else 'null' end), ', ' order by a.attname)
  into v_text
  from pg_attribute a
  where a.attrelid = 'public.suppliers'::regclass and not a.attisdropped
    and a.attname in ('lead_days_overrides', 'delivery_every_weeks', 'delivery_anchor_date', 'order_mode', 'order_deadline');
  r := r || format('configuración|Columnas nuevas con su tipo y obligatoriedad|%s',
    case when v_text = 'delivery_anchor_date:date:null, delivery_every_weeks:smallint:not null, lead_days_overrides:jsonb:not null, order_deadline:time without time zone:null, order_mode:text:not null'
         then 'OK' else 'FALLO (' || coalesce(v_text, 'ninguna') || ')' end);

  select count(*) into v_count
  from pg_constraint
  where conrelid = 'public.suppliers'::regclass and contype = 'c'
    and conname in ('suppliers_lead_days_overrides_valid', 'suppliers_delivery_every_weeks_valid',
                    'suppliers_delivery_anchor_valid', 'suppliers_order_mode_valid',
                    'suppliers_on_demand_weekly', 'suppliers_order_deadline_valid');
  r := r || format('configuración|Las 6 restricciones nuevas existen|%s',
    case when v_count = 6 then 'OK' else format('FALLO (%s encontradas)', v_count) end);

  select p.provolatile = 'i' and not p.prosecdef into v_bool
  from pg_proc p where p.oid = 'private.is_valid_lead_days_overrides(jsonb, smallint[])'::regprocedure;
  r := r || format('configuración|Función de validación inmutable y sin SECURITY DEFINER|%s',
    case when v_bool then 'OK' else 'FALLO' end);

  r := r || format('configuración|La función no la ejecutan anon ni PUBLIC; sí authenticated|%s',
    case when not has_function_privilege('anon', 'private.is_valid_lead_days_overrides(jsonb, smallint[])', 'EXECUTE')
          and not exists (
            select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
            where p.oid = 'private.is_valid_lead_days_overrides(jsonb, smallint[])'::regprocedure and a.grantee = 0)
          and has_function_privilege('authenticated', 'private.is_valid_lead_days_overrides(jsonb, smallint[])', 'EXECUTE')
         then 'OK' else 'FALLO' end);

  select c.relrowsecurity into v_bool from pg_class c where c.oid = 'public.suppliers'::regclass;
  r := r || format('configuración|RLS sigue activado en suppliers|%s', case when v_bool then 'OK' else 'FALLO' end);

  select string_agg(policyname || ':' || cmd, ', ' order by policyname) into v_text
  from pg_policies where schemaname = 'public' and tablename = 'suppliers';
  r := r || format('configuración|Políticas de suppliers sin cambios (SELECT, INSERT y UPDATE)|%s',
    case when v_text = 'suppliers_insert_authorized:INSERT, suppliers_select_authorized:SELECT, suppliers_update_authorized:UPDATE'
         then 'OK' else 'FALLO (' || coalesce(v_text, 'ninguna') || ')' end);

  r := r || format('configuración|anon sin privilegios sobre suppliers; authenticated sin DELETE|%s',
    case when not has_table_privilege('anon', 'public.suppliers', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
          and not has_table_privilege('authenticated', 'public.suppliers', 'DELETE,TRUNCATE')
         then 'OK' else 'FALLO' end);

  select count(*) into v_count from public.suppliers
  where lead_days_overrides <> '{}'::jsonb or delivery_every_weeks <> 1 or delivery_anchor_date is not null
     or order_mode <> 'scheduled' or order_deadline is not null;
  r := r || format('configuración|Valores por defecto: semanal, días fijos, sin excepciones (proveedores ya existentes)|%s',
    case when v_count = 0 then 'OK'
         else format('INFO (%s proveedores ya usan el calendario nuevo)', v_count) end);

  -- ============================================ Pruebas con datos (se deshacen)
  begin
    insert into public.suppliers (name, delivery_weekdays, order_lead_days)
    values ('Proveedor de prueba (supplier_schedule_checks.sql)', '{1,4}', 1)
    returning id into v_sup;

    select lead_days_overrides = '{}'::jsonb and delivery_every_weeks = 1 and delivery_anchor_date is null
       and order_mode = 'scheduled' and order_deadline is null
    into v_bool from public.suppliers where id = v_sup;
    r := r || format('valores por defecto|Un proveedor nuevo es semanal, de días fijos y sin hora límite|%s',
      case when v_bool then 'OK' else 'FALLO' end);

    -- ========================================================= 2. Sin sesión (anon)
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    perform set_config('request.jwt.claim.sub', '', true);
    set local role anon;
    begin
      execute format('update public.suppliers set order_mode = %L where id = %L', 'on_demand', v_sup);
      raise exception 'NO_DENEGADO';
    exception
      when insufficient_privilege then r := r || text 'anon|Cambiar el calendario|OK (denegado)';
      when raise_exception then r := r || text 'anon|Cambiar el calendario|FALLO (permitido; revertido)';
      when others then r := r || format('anon|Cambiar el calendario|FALLO (error %s: %s)', sqlstate, replace(sqlerrm, '|', '/'));
    end;
    perform set_config('role', v_original_role, true);

    -- ===================================== 3. Autenticada pero NO autorizada
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_unauthorized, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', v_unauthorized::text, true);
    set local role authenticated;
    begin
      update public.suppliers
      set lead_days_overrides = '{"1": 3}', order_deadline = '12:00', order_mode = 'scheduled'
      where id = v_sup;
      get diagnostics v_count = row_count;
      r := r || format('no autorizada|Cambiar el calendario de un proveedor|%s',
        case when v_count = 0 then 'OK (0 filas afectadas)' else format('FALLO (%s filas afectadas)', v_count) end);
    exception
      when insufficient_privilege then r := r || text 'no autorizada|Cambiar el calendario de un proveedor|OK (denegado)';
      when others then r := r || format('no autorizada|Cambiar el calendario de un proveedor|FALLO (error %s: %s)', sqlstate, replace(sqlerrm, '|', '/'));
    end;
    perform set_config('role', v_original_role, true);

    -- =========================================================== 4. Autorizada
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_authorized, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', v_authorized::text, true);
    set local role authenticated;

    begin
      update public.suppliers
      set lead_days_overrides = '{"1": 3}', order_deadline = '12:00'
      where id = v_sup;
      get diagnostics v_count = row_count;
      r := r || format('autorizada|Antelación distinta para el lunes (3 días) y hora límite 12:00|%s',
        case when v_count = 1 then 'OK' else format('FALLO (%s filas)', v_count) end);
    exception when others then
      r := r || format('autorizada|Antelación distinta para el lunes (3 días) y hora límite 12:00|FALLO (error %s: %s)', sqlstate, replace(sqlerrm, '|', '/'));
    end;

    begin
      insert into public.suppliers (name, delivery_weekdays, order_lead_days, delivery_every_weeks, delivery_anchor_date)
      values ('Quincenal de prueba (supplier_schedule_checks.sql)', '{1}', 4, 2, '2026-11-09')
      returning id into v_new;
      r := r || text 'autorizada|Crea un proveedor quincenal con fecha de referencia|OK';
    exception when others then
      r := r || format('autorizada|Crea un proveedor quincenal con fecha de referencia|FALLO (error %s: %s)', sqlstate, replace(sqlerrm, '|', '/'));
    end;

    begin
      insert into public.suppliers (name, delivery_weekdays, order_lead_days, order_mode)
      values ('A demanda de prueba (supplier_schedule_checks.sql)', '{1,2,3,4,5}', 2, 'on_demand');
      r := r || text 'autorizada|Crea un proveedor a demanda|OK';
    exception when others then
      r := r || format('autorizada|Crea un proveedor a demanda|FALLO (error %s: %s)', sqlstate, replace(sqlerrm, '|', '/'));
    end;

    -- =================================================== 5. Restricciones (autorizada)
    rejected := array[
      ['Antelación por día fuera de rango (8)', 'update public.suppliers set lead_days_overrides = ''{"1": 8}'' where id = %1$L'],
      ['Antelación por día negativa', 'update public.suppliers set lead_days_overrides = ''{"1": -1}'' where id = %1$L'],
      ['Antelación por día con decimales', 'update public.suppliers set lead_days_overrides = ''{"1": 1.5}'' where id = %1$L'],
      ['Antelación por día en texto', 'update public.suppliers set lead_days_overrides = ''{"1": "3"}'' where id = %1$L'],
      ['Antelación para un día que no es de entrega (martes)', 'update public.suppliers set lead_days_overrides = ''{"2": 1}'' where id = %1$L'],
      ['Clave de día no válida (8)', 'update public.suppliers set lead_days_overrides = ''{"8": 1}'' where id = %1$L'],
      ['Antelaciones que no son un objeto', 'update public.suppliers set lead_days_overrides = ''[3]'' where id = %1$L'],
      ['Quitar un día de entrega que tiene antelación propia', 'update public.suppliers set delivery_weekdays = ''{4}'' where id = %1$L'],
      ['Frecuencia de 3 semanas', 'update public.suppliers set delivery_every_weeks = 3, delivery_anchor_date = ''2026-11-09'' where id = %1$L'],
      ['Quincenal sin fecha de referencia', 'update public.suppliers set delivery_every_weeks = 2 where id = %1$L'],
      ['Semanal con fecha de referencia', 'update public.suppliers set delivery_anchor_date = ''2026-11-09'' where id = %1$L'],
      ['Modo de pedido desconocido', 'update public.suppliers set order_mode = ''daily'' where id = %1$L'],
      ['A demanda y quincenal', 'update public.suppliers set order_mode = ''on_demand'' where id = %2$L'],
      ['Hora límite con segundos', 'update public.suppliers set order_deadline = ''12:00:30'' where id = %1$L']
    ];
    foreach t slice 1 in array rejected loop
      begin
        execute format(t[2], v_sup, v_new);
        raise exception 'NO_RECHAZADO';
      exception
        when raise_exception then
          r := r || format('restricciones|%s|FALLO (aceptado; revertido)', t[1]);
        when others then
          r := r || format('restricciones|%s|%s', t[1],
            case when sqlstate = '23514' then 'OK (rechazado, 23514)'
                 else format('FALLO (error %s: %s)', sqlstate, replace(sqlerrm, '|', '/')) end);
      end;
    end loop;

    perform set_config('role', v_original_role, true);

    select lead_days_overrides = '{"1": 3}'::jsonb and order_deadline = '12:00'::time and delivery_weekdays = '{1,4}'
    into v_bool from public.suppliers where id = v_sup;
    r := r || format('restricciones|El proveedor de prueba conserva los datos válidos|%s',
      case when v_bool then 'OK' else 'FALLO' end);

    raise exception 'Fin de las pruebas: se deshacen los datos de prueba' using errcode = 'PX999';
  exception
    when sqlstate 'PX999' then
      null;
  end;

  perform set_config('role', v_original_role, true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);

  select count(*) into v_count from public.suppliers where name like '%supplier_schedule_checks.sql%';
  r := r || format('limpieza|No queda ningún dato de prueba|%s',
    case when v_count = 0 and v_sup is not null then 'OK' else format('FALLO (%s filas)', v_count) end);

  insert into pg_temp.schedule_check_results (n, grupo, comprobacion, resultado)
  select i, split_part(r[i], '|', 1), split_part(r[i], '|', 2), split_part(r[i], '|', 3)
  from generate_subscripts(r, 1) as i;
end;
$$;

select n, grupo, comprobacion, resultado
from pg_temp.schedule_check_results
order by n;
