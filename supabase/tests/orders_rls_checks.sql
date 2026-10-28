-- =============================================================================
-- Panet Admin · Comprobaciones de RLS de proveedores, pedidos y festivos
-- (tablas `suppliers`, `orders` y `holidays`)
-- =============================================================================
--
-- Uso: SQL Editor de Supabase o `psql`, DESPUÉS de aplicar la migración
-- 20261028221500_suppliers_orders_holidays.sql. Requiere también la de
-- `profiles` y la cuenta autorizada (secciones 5 y 6 de SUPABASE_SETUP.md).
-- Ver SUPABASE_SETUP.md, sección 10.
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
--   - crea un proveedor, un festivo (en el año 2199, para no coincidir con
--     ninguno real) y unos pedidos de prueba; todas las pruebas se ejecutan
--     dentro de un bloque que termina SIEMPRE con un error forzado, así que
--     PostgreSQL deshace todas las filas de prueba y cualquier escritura (la
--     última fila del resultado lo comprueba);
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

create temp table if not exists orders_check_results (
  n int,
  grupo text,
  comprobacion text,
  resultado text
);
truncate pg_temp.orders_check_results;

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
  v_sup uuid;                  -- proveedor de prueba (creado como postgres)
  v_hol uuid;                  -- festivo de prueba
  v_pending uuid;              -- pedido pendiente de v_sup
  v_prepared uuid;             -- pedido preparado de v_sup
  v_skipped uuid;              -- pedido «no se pide» de v_sup
  v_new_sup uuid;              -- proveedor creado por la cuenta autorizada
  v_new_order uuid;            -- pedido creado por la cuenta autorizada
  v_manual uuid;               -- pedido manual creado por la cuenta autorizada
  v_first_prepared_at timestamptz;
  t text[];                    -- una prueba: {etiqueta, sentencia[, sqlstate]}
  denied text[];
  no_rows text[];
  rejected text[];
begin
  if v_authorized = '00000000-0000-0000-0000-000000000000' then
    raise exception 'Sustituye v_authorized por el UUID de la cuenta autorizada antes de ejecutar el script.';
  end if;
  if to_regclass('public.suppliers') is null or to_regclass('public.orders') is null
     or to_regclass('public.holidays') is null then
    raise exception 'Faltan las tablas suppliers, orders u holidays: aplica antes la migración 20261028221500_suppliers_orders_holidays.sql.';
  end if;
  v_unauthorized_is_random := v_unauthorized is null;
  v_unauthorized := coalesce(v_unauthorized, gen_random_uuid());
  if v_unauthorized = v_authorized then
    raise exception 'v_unauthorized debe ser una cuenta distinta de v_authorized.';
  end if;

  -- =========================================================== 1. Configuración
  select bool_and(c.relrowsecurity) and count(*) = 3 into v_bool
  from pg_class c
  where c.oid in ('public.suppliers'::regclass, 'public.orders'::regclass, 'public.holidays'::regclass);
  r := r || format('configuración|RLS activado en suppliers, orders y holidays|%s',
    case when v_bool then 'OK' else 'FALLO' end);

  select string_agg(policyname || ':' || cmd, ', ' order by policyname) into v_text
  from pg_policies where schemaname = 'public' and tablename = 'suppliers';
  r := r || format('configuración|suppliers: políticas SELECT, INSERT y UPDATE (sin DELETE)|%s',
    case when v_text = 'suppliers_insert_authorized:INSERT, suppliers_select_authorized:SELECT, suppliers_update_authorized:UPDATE'
         then 'OK' else 'FALLO (' || coalesce(v_text, 'ninguna') || ')' end);

  select string_agg(policyname || ':' || cmd, ', ' order by policyname) into v_text
  from pg_policies where schemaname = 'public' and tablename = 'holidays';
  r := r || format('configuración|holidays: políticas SELECT, INSERT, UPDATE y DELETE|%s',
    case when v_text = 'holidays_delete_authorized:DELETE, holidays_insert_authorized:INSERT, holidays_select_authorized:SELECT, holidays_update_authorized:UPDATE'
         then 'OK' else 'FALLO (' || coalesce(v_text, 'ninguna') || ')' end);

  select string_agg(policyname || ':' || cmd, ', ' order by policyname) into v_text
  from pg_policies where schemaname = 'public' and tablename = 'orders';
  r := r || format('configuración|orders: políticas SELECT, INSERT, UPDATE y DELETE de pendientes|%s',
    case when v_text = 'orders_delete_pending_authorized:DELETE, orders_insert_authorized:INSERT, orders_select_authorized:SELECT, orders_update_authorized:UPDATE'
         then 'OK' else 'FALLO (' || coalesce(v_text, 'ninguna') || ')' end);

  -- Cada política: permisiva, solo para authenticated y condicionada a
  -- private.is_authorized() en USING y/o WITH CHECK según el comando.
  select string_agg(policyname, ', ' order by policyname) into v_text
  from pg_policies
  where schemaname = 'public' and tablename in ('suppliers', 'orders', 'holidays')
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

  select qual into v_text
  from pg_policies
  where schemaname = 'public' and tablename = 'orders' and policyname = 'orders_delete_pending_authorized';
  r := r || format('configuración|orders: la política de DELETE exige status = pending|%s',
    case when v_text like '%status = ''pending''%' then 'OK' else 'FALLO (' || coalesce(v_text, 'sin política') || ')' end);

  r := r || format('configuración|anon sin privilegios sobre suppliers, orders ni holidays|%s',
    case when not has_table_privilege('anon', 'public.suppliers', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
          and not has_table_privilege('anon', 'public.orders', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
          and not has_table_privilege('anon', 'public.holidays', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
          and not has_any_column_privilege('anon', 'public.suppliers', 'SELECT,INSERT,UPDATE,REFERENCES')
          and not has_any_column_privilege('anon', 'public.orders', 'SELECT,INSERT,UPDATE,REFERENCES')
          and not has_any_column_privilege('anon', 'public.holidays', 'SELECT,INSERT,UPDATE,REFERENCES')
         then 'OK' else 'FALLO' end);

  r := r || format('configuración|authenticated en suppliers: SELECT, INSERT y UPDATE; sin DELETE ni TRUNCATE|%s',
    case when has_table_privilege('authenticated', 'public.suppliers', 'SELECT')
          and has_table_privilege('authenticated', 'public.suppliers', 'INSERT')
          and has_table_privilege('authenticated', 'public.suppliers', 'UPDATE')
          and not has_table_privilege('authenticated', 'public.suppliers', 'DELETE,TRUNCATE,REFERENCES,TRIGGER')
         then 'OK' else 'FALLO' end);

  r := r || format('configuración|authenticated en holidays: SELECT, INSERT, UPDATE y DELETE; sin TRUNCATE|%s',
    case when has_table_privilege('authenticated', 'public.holidays', 'SELECT')
          and has_table_privilege('authenticated', 'public.holidays', 'INSERT')
          and has_table_privilege('authenticated', 'public.holidays', 'UPDATE')
          and has_table_privilege('authenticated', 'public.holidays', 'DELETE')
          and not has_table_privilege('authenticated', 'public.holidays', 'TRUNCATE,REFERENCES,TRIGGER')
         then 'OK' else 'FALLO' end);

  r := r || format('configuración|authenticated en orders: SELECT, INSERT y DELETE; sin TRUNCATE|%s',
    case when has_table_privilege('authenticated', 'public.orders', 'SELECT')
          and has_table_privilege('authenticated', 'public.orders', 'INSERT')
          and has_table_privilege('authenticated', 'public.orders', 'DELETE')
          and not has_table_privilege('authenticated', 'public.orders', 'TRUNCATE,REFERENCES,TRIGGER')
         then 'OK' else 'FALLO' end);

  select string_agg(a.attname, ', ' order by a.attname) into v_text
  from pg_attribute a
  where a.attrelid = 'public.orders'::regclass and a.attnum > 0 and not a.attisdropped
    and has_column_privilege('authenticated', 'public.orders', a.attname, 'UPDATE');
  r := r || format('configuración|authenticated en orders: UPDATE solo de delivery_date, notes, prepare_date y status|%s',
    case when v_text = 'delivery_date, notes, prepare_date, status' and not has_table_privilege('authenticated', 'public.orders', 'UPDATE')
         then 'OK' else 'FALLO (' || coalesce(v_text, 'ninguna') || ')' end);

  r := r || format('configuración|Sin privilegios para PUBLIC en las tres tablas|%s',
    case when not exists (
            select 1 from pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
            where c.oid in ('public.suppliers'::regclass, 'public.orders'::regclass, 'public.holidays'::regclass)
              and a.grantee = 0
          )
         then 'OK' else 'FALLO' end);

  select count(*) into v_count
  from pg_constraint
  where conrelid = 'public.orders'::regclass
    and contype = 'f'
    and confrelid = 'public.suppliers'::regclass
    and confdeltype = 'r';
  r := r || format('configuración|Clave foránea orders → suppliers con ON DELETE RESTRICT|%s',
    case when v_count = 1 then 'OK' else format('FALLO (%s encontradas)', v_count) end);

  select string_agg(conname, ', ' order by conname) into v_text
  from pg_constraint
  where contype = 'u'
    and conrelid in ('public.orders'::regclass, 'public.holidays'::regclass);
  r := r || format('configuración|Únicos: un pedido por proveedor y entrega, por previsión y un festivo por fecha|%s',
    case when v_text = 'holidays_holiday_date_unique, orders_supplier_delivery_unique, orders_supplier_scheduled_unique'
         then 'OK' else 'FALLO (' || coalesce(v_text, 'ninguno') || ')' end);

  select count(*) into v_count
  from pg_index i
  where i.indrelid = 'public.suppliers'::regclass
    and i.indisunique
    and i.indexrelid = to_regclass('public.suppliers_name_unique_idx');
  r := r || format('configuración|Índice único de nombre de proveedor (sin mayúsculas, acentos ni espacios)|%s',
    case when v_count = 1 then 'OK' else 'FALLO' end);

  select count(*) into v_count
  from (values ('public.orders_prepare_date_idx'), ('public.orders_delivery_date_idx')) as v(name)
  where to_regclass(v.name) is not null;
  r := r || format('configuración|Índices de orders por prepare_date y por delivery_date|%s',
    case when v_count = 2 then 'OK' else format('FALLO (%s encontrados)', v_count) end);

  select count(*) into v_count
  from pg_trigger tg
  where not tg.tgisinternal
    and tg.tgenabled = 'O'
    and tg.tgfoid = 'private.set_updated_at()'::regprocedure
    and tg.tgrelid in ('public.suppliers'::regclass, 'public.orders'::regclass, 'public.holidays'::regclass);
  r := r || format('configuración|Triggers de updated_at activos en las tres tablas|%s',
    case when v_count = 3 then 'OK' else format('FALLO (%s encontrados)', v_count) end);

  select count(*) into v_count
  from pg_trigger tg
  where not tg.tgisinternal
    and tg.tgenabled = 'O'
    and tg.tgrelid = 'public.orders'::regclass
    and tg.tgfoid = to_regprocedure('private.set_order_prepared_at()')
    -- BEFORE (2) + INSERT (4) + UPDATE (16), a nivel de fila (1).
    and tg.tgtype & (1 | 2 | 4 | 16) = (1 | 2 | 4 | 16);
  r := r || format('configuración|Trigger de prepared_at activo al crear y modificar pedidos|%s',
    case when v_count = 1 then 'OK' else format('FALLO (%s encontrados)', v_count) end);

  select not p.prosecdef
     and p.proconfig @> array['search_path=""']
     and not has_function_privilege('anon', p.oid, 'EXECUTE')
     and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
    into v_bool
  from pg_proc p
  where p.oid = to_regprocedure('private.set_order_prepared_at()');
  r := r || format('configuración|set_order_prepared_at(): sin SECURITY DEFINER, search_path vacío y sin EXECUTE para clientes|%s',
    case when v_bool then 'OK' else format('FALLO (%s)', coalesce(v_bool::text, 'no existe')) end);

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
    insert into public.suppliers (name, delivery_weekdays, order_lead_days, notes, updated_at)
    values ('Proveedor de prueba (orders_rls_checks.sql)', '{1,4}', 2, 'Fila temporal de orders_rls_checks.sql', '2000-01-01')
    returning id into v_sup;
    insert into public.holidays (holiday_date, name, scope, updated_at)
    values ('2199-12-25', 'Festivo de prueba (orders_rls_checks.sql)', 'national', '2000-01-01')
    returning id into v_hol;
    insert into public.orders (supplier_id, scheduled_delivery_date, delivery_date, prepare_date, status, notes, updated_at)
    values (v_sup, current_date + 3, current_date + 3, current_date + 1, 'pending', 'Pedido de prueba', '2000-01-01')
    returning id into v_pending;
    -- prepared_at explícito: así los datos de prueba se crean aunque faltara el
    -- trigger, y las filas de «autorizada» y «restricciones» lo señalan.
    insert into public.orders (supplier_id, scheduled_delivery_date, delivery_date, prepare_date, status, prepared_at)
    values (v_sup, current_date - 4, current_date - 4, current_date - 6, 'prepared', now())
    returning id into v_prepared;
    insert into public.orders (supplier_id, scheduled_delivery_date, delivery_date, prepare_date, status)
    values (v_sup, current_date - 1, current_date - 1, current_date - 3, 'skipped')
    returning id into v_skipped;

    -- ========================================================= 2. Sin sesión (anon)
    -- auth.uid() lee primero request.jwt.claim.sub y, si está vacío,
    -- request.jwt.claims. Se fijan ambos para que no influya ningún valor
    -- previo de la sesión. %1$L = proveedor de prueba.
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    perform set_config('request.jwt.claim.sub', '', true);
    set local role anon;

    denied := array[
      ['Leer suppliers', 'select count(*) from public.suppliers'],
      ['Leer orders', 'select count(*) from public.orders'],
      ['Leer holidays', 'select count(*) from public.holidays'],
      ['Crear proveedor', 'insert into public.suppliers (name) values (''X'')'],
      ['Crear pedido', 'insert into public.orders (supplier_id, delivery_date, prepare_date) values (%1$L, current_date + 10, current_date + 9)'],
      ['Crear festivo', 'insert into public.holidays (holiday_date, name, scope) values (''2199-01-02'', ''X'', ''local'')'],
      ['Modificar proveedores', 'update public.suppliers set notes = ''x'''],
      ['Modificar pedidos', 'update public.orders set status = ''prepared'''],
      ['Modificar festivos', 'update public.holidays set name = ''x'''],
      ['Eliminar proveedores', 'delete from public.suppliers'],
      ['Eliminar pedidos', 'delete from public.orders'],
      ['Eliminar festivos', 'delete from public.holidays'],
      ['TRUNCATE suppliers', 'truncate public.suppliers cascade'],
      ['TRUNCATE orders', 'truncate public.orders'],
      ['TRUNCATE holidays', 'truncate public.holidays']
    ];
    foreach t slice 1 in array denied loop
      begin
        execute format(t[2], v_sup);
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

    foreach t slice 1 in array array[
      ['No ve ningún proveedor', 'select count(*) from public.suppliers'],
      ['No ve ningún pedido', 'select count(*) from public.orders'],
      ['No ve ningún festivo', 'select count(*) from public.holidays']
    ] loop
      begin
        execute t[2] into v_count;
        r := r || format('no autorizada|%s|%s', t[1],
          case when v_count = 0 then 'OK' else format('FALLO (ve %s)', v_count) end);
      exception when others then
        r := r || format('no autorizada|%s|FALLO (error %s: %s)', t[1], sqlstate, replace(sqlerrm, '|', '/'));
      end;
    end loop;

    -- Deben fallar con error de permisos (RLS o falta de privilegio).
    denied := array[
      ['Crear proveedor', 'insert into public.suppliers (name) values (''X'')'],
      ['Crear pedido', 'insert into public.orders (supplier_id, delivery_date, prepare_date) values (%1$L, current_date + 10, current_date + 9)'],
      ['Crear festivo', 'insert into public.holidays (holiday_date, name, scope) values (''2199-01-02'', ''X'', ''local'')'],
      ['Eliminar el proveedor de prueba', 'delete from public.suppliers where id = %1$L'],
      ['TRUNCATE suppliers', 'truncate public.suppliers cascade'],
      ['TRUNCATE orders', 'truncate public.orders'],
      ['TRUNCATE holidays', 'truncate public.holidays'],
      ['Desactivar RLS de orders', 'alter table public.orders disable row level security'],
      ['Borrar la política de lectura de suppliers', 'drop policy suppliers_select_authorized on public.suppliers'],
      ['Crear una política abierta en holidays', 'create policy permitir_todo on public.holidays for all to authenticated using (true) with check (true)']
    ];
    foreach t slice 1 in array denied loop
      begin
        execute format(t[2], v_sup);
        raise exception 'NO_DENEGADO';
      exception
        when insufficient_privilege then r := r || format('no autorizada|%s|OK (denegado)', t[1]);
        when raise_exception then r := r || format('no autorizada|%s|FALLO (permitido; revertido)', t[1]);
        when others then r := r || format('no autorizada|%s|FALLO (error %s: %s)', t[1], sqlstate, replace(sqlerrm, '|', '/'));
      end;
    end loop;

    -- Con RLS, UPDATE y DELETE sobre filas invisibles no dan error: no afectan
    -- a ninguna fila (igual que la API devuelve 200 con una lista vacía).
    -- %1$L = proveedor, %2$L = pedido pendiente, %3$L = festivo.
    no_rows := array[
      ['Modificar el proveedor de prueba', 'update public.suppliers set notes = ''modificado'' where id = %1$L'],
      ['Desactivar el proveedor de prueba', 'update public.suppliers set is_active = false where id = %1$L'],
      ['Marcar el pedido pendiente como preparado', 'update public.orders set status = ''prepared'' where id = %2$L'],
      ['Eliminar el pedido pendiente', 'delete from public.orders where id = %2$L'],
      ['Modificar el festivo de prueba', 'update public.holidays set name = ''modificado'' where id = %3$L'],
      ['Eliminar el festivo de prueba', 'delete from public.holidays where id = %3$L']
    ];
    foreach t slice 1 in array no_rows loop
      begin
        execute format(t[2], v_sup, v_pending, v_hol);
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
    from public.suppliers s
    join public.orders o on o.supplier_id = s.id
    where s.id = v_sup and s.is_active and s.notes = 'Fila temporal de orders_rls_checks.sql'
      and o.id = v_pending and o.status = 'pending'
      and exists (select 1 from public.holidays h where h.id = v_hol and h.name = 'Festivo de prueba (orders_rls_checks.sql)');
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
      from public.orders o join public.suppliers s on s.id = o.supplier_id
      where s.id = v_sup and o.id in (v_pending, v_prepared, v_skipped);
      select v_count = 3 and exists (select 1 from public.holidays where id = v_hol) into v_bool;
      r := r || format('autorizada|Ve el proveedor, sus tres pedidos y el festivo de prueba|%s',
        case when v_bool then 'OK' else format('FALLO (ve %s pedidos)', v_count) end);
    exception when others then
      r := r || format('autorizada|Ve el proveedor, sus tres pedidos y el festivo de prueba|FALLO (error %s: %s)', sqlstate, replace(sqlerrm, '|', '/'));
    end;

    -- Proveedores --------------------------------------------------------------
    begin
      insert into public.suppliers (name, delivery_weekdays, order_lead_days)
      values ('Alta desde la app (orders_rls_checks.sql)', '{1,3,5}', 0)
      returning id into v_new_sup;
      r := r || text 'autorizada|Crea un proveedor con días de entrega y antelación 0|OK';
    exception when others then
      r := r || format('autorizada|Crea un proveedor con días de entrega y antelación 0|FALLO (error %s: %s)', sqlstate, replace(sqlerrm, '|', '/'));
    end;

    begin
      insert into public.suppliers (name) values ('Pena (orders_rls_checks.sql)'), ('Peña (orders_rls_checks.sql)');
      r := r || text 'autorizada|Admite dos proveedores que solo se diferencian en «ñ» y «n»|OK';
    exception when others then
      r := r || format('autorizada|Admite dos proveedores que solo se diferencian en «ñ» y «n»|FALLO (error %s: %s)', sqlstate, replace(sqlerrm, '|', '/'));
    end;

    begin
      update public.suppliers
      set delivery_weekdays = '{2,6}', order_lead_days = 7, notes = 'Antelación máxima'
      where id = v_sup;
      get diagnostics v_count = row_count;
      select v_count = 1 and s.delivery_weekdays = '{2,6}' and s.order_lead_days = 7 and s.updated_at = now()
        into v_bool
      from public.suppliers s where s.id = v_sup;
      r := r || format('autorizada|Edita días y antelación (7) de un proveedor y updated_at se actualiza|%s',
        case when v_bool then 'OK' else 'FALLO' end);
    exception when others then
      r := r || format('autorizada|Edita días y antelación (7) de un proveedor y updated_at se actualiza|FALLO (error %s: %s)', sqlstate, replace(sqlerrm, '|', '/'));
    end;

    begin
      update public.suppliers set updated_at = '1999-01-01' where id = v_sup;
      select s.updated_at = now() into v_bool from public.suppliers s where s.id = v_sup;
      r := r || format('autorizada|No puede fijar updated_at desde el cliente (lo fija el trigger)|%s',
        case when v_bool then 'OK' else 'FALLO' end);
    exception when others then
      r := r || format('autorizada|No puede fijar updated_at desde el cliente (lo fija el trigger)|FALLO (error %s: %s)', sqlstate, replace(sqlerrm, '|', '/'));
    end;

    begin
      update public.suppliers set is_active = false where id = v_sup;
      select count(*) into v_count
      from public.suppliers s join public.orders o on o.supplier_id = s.id
      where s.id = v_sup and not s.is_active;
      r := r || format('autorizada|Desactiva un proveedor y conserva sus pedidos|%s',
        case when v_count = 3 then 'OK' else format('FALLO (%s pedidos)', v_count) end);
      update public.suppliers set is_active = true where id = v_sup;
    exception when others then
      r := r || format('autorizada|Desactiva un proveedor y conserva sus pedidos|FALLO (error %s: %s)', sqlstate, replace(sqlerrm, '|', '/'));
    end;

    -- Festivos -----------------------------------------------------------------
    begin
      insert into public.holidays (holiday_date, name, scope, notes)
      values ('2199-06-24', 'Sant Joan (prueba)', 'regional', null),
             ('2199-09-11', 'Fiesta local (prueba)', 'local', 'Confirmar cada año');
      update public.holidays set name = 'Festivo de prueba corregido', scope = 'local' where id = v_hol;
      select count(*) into v_count from public.holidays
      where (holiday_date in ('2199-06-24', '2199-09-11'))
         or (id = v_hol and name = 'Festivo de prueba corregido' and scope = 'local' and updated_at = now());
      r := r || format('autorizada|Crea festivos autonómicos y locales y corrige uno|%s',
        case when v_count = 3 then 'OK' else format('FALLO (%s filas)', v_count) end);
    exception when others then
      r := r || format('autorizada|Crea festivos autonómicos y locales y corrige uno|FALLO (error %s: %s)', sqlstate, replace(sqlerrm, '|', '/'));
    end;

    begin
      delete from public.holidays where holiday_date = '2199-09-11';
      get diagnostics v_count = row_count;
      r := r || format('autorizada|Elimina un festivo|%s',
        case when v_count = 1 then 'OK' else format('FALLO (%s filas eliminadas)', v_count) end);
    exception when others then
      r := r || format('autorizada|Elimina un festivo|FALLO (error %s: %s)', sqlstate, replace(sqlerrm, '|', '/'));
    end;

    -- Pedidos ------------------------------------------------------------------
    -- Una previsión del calendario se convierte en pedido al actuar sobre ella.
    -- El cliente envía prepared_at aunque esté pendiente: el trigger lo ignora.
    begin
      insert into public.orders (supplier_id, scheduled_delivery_date, delivery_date, prepare_date, notes, prepared_at)
      values (v_new_sup, current_date + 7, current_date + 7, current_date + 7, '2 sacos de harina', '2000-01-01')
      returning id into v_new_order;
      select o.status = 'pending' and o.prepared_at is null into v_bool
      from public.orders o where o.id = v_new_order;
      r := r || format('autorizada|Crea un pedido desde una previsión; pendiente por defecto y sin prepared_at|%s',
        case when v_bool then 'OK' else 'FALLO' end);
    exception when others then
      r := r || format('autorizada|Crea un pedido desde una previsión; pendiente por defecto y sin prepared_at|FALLO (error %s: %s)', sqlstate, replace(sqlerrm, '|', '/'));
    end;

    begin
      update public.orders set status = 'prepared' where id = v_new_order;
      select o.status = 'prepared' and o.prepared_at = now() and o.updated_at = now(), o.prepared_at
        into v_bool, v_first_prepared_at
      from public.orders o where o.id = v_new_order;
      r := r || format('autorizada|Marca un pedido como preparado: prepared_at con la hora del servidor|%s',
        case when v_bool then 'OK' else 'FALLO' end);
    exception when others then
      r := r || format('autorizada|Marca un pedido como preparado: prepared_at con la hora del servidor|FALLO (error %s: %s)', sqlstate, replace(sqlerrm, '|', '/'));
    end;

    begin
      update public.orders set notes = 'Añadida levadura' where id = v_new_order;
      select o.prepared_at = v_first_prepared_at into v_bool from public.orders o where o.id = v_new_order;
      r := r || format('autorizada|Editar un pedido preparado conserva su prepared_at|%s',
        case when v_bool then 'OK' else 'FALLO' end);
    exception when others then
      r := r || format('autorizada|Editar un pedido preparado conserva su prepared_at|FALLO (error %s: %s)', sqlstate, replace(sqlerrm, '|', '/'));
    end;

    begin
      update public.orders set status = 'pending' where id = v_new_order;
      select o.status = 'pending' and o.prepared_at is null into v_bool from public.orders o where o.id = v_new_order;
      r := r || format('autorizada|Vuelve a pendiente un pedido preparado y prepared_at se vacía|%s',
        case when v_bool then 'OK' else 'FALLO' end);
    exception when others then
      r := r || format('autorizada|Vuelve a pendiente un pedido preparado y prepared_at se vacía|FALLO (error %s: %s)', sqlstate, replace(sqlerrm, '|', '/'));
    end;

    begin
      update public.orders set status = 'skipped' where id = v_new_order;
      select o.status = 'skipped' and o.prepared_at is null into v_bool from public.orders o where o.id = v_new_order;
      r := r || format('autorizada|Marca un pedido como «no se pide» (skipped)|%s',
        case when v_bool then 'OK' else 'FALLO' end);
      update public.orders set status = 'pending' where id = v_skipped;
      select o.status = 'pending' into v_bool from public.orders o where o.id = v_skipped;
      r := r || format('autorizada|Vuelve a pendiente un pedido descartado|%s',
        case when v_bool then 'OK' else 'FALLO' end);
      update public.orders set status = 'skipped' where id = v_skipped;
    exception when others then
      r := r || format('autorizada|Marca y desmarca «no se pide»|FALLO (error %s: %s)', sqlstate, replace(sqlerrm, '|', '/'));
    end;

    -- Corregir fechas (por ejemplo, tras confirmar con el proveedor un cambio
    -- por festivo): la previsión de origen no cambia.
    begin
      update public.orders
      set delivery_date = current_date + 2, prepare_date = current_date
      where id = v_pending;
      select o.delivery_date = current_date + 2 and o.prepare_date = current_date
         and o.scheduled_delivery_date = current_date + 3
        into v_bool
      from public.orders o where o.id = v_pending;
      r := r || format('autorizada|Corrige las fechas de un pedido; la entrega prevista de origen se conserva|%s',
        case when v_bool then 'OK' else 'FALLO' end);
    exception when others then
      r := r || format('autorizada|Corrige las fechas de un pedido; la entrega prevista de origen se conserva|FALLO (error %s: %s)', sqlstate, replace(sqlerrm, '|', '/'));
    end;

    begin
      update public.orders set prepare_date = delivery_date where id = v_pending;
      get diagnostics v_count = row_count;
      r := r || format('autorizada|Admite preparar el mismo día de la entrega|%s',
        case when v_count = 1 then 'OK' else 'FALLO' end);
    exception when others then
      r := r || format('autorizada|Admite preparar el mismo día de la entrega|FALLO (error %s: %s)', sqlstate, replace(sqlerrm, '|', '/'));
    end;

    -- Pedidos creados a mano (sin previsión): varios del mismo proveedor en
    -- fechas distintas.
    begin
      insert into public.orders (supplier_id, delivery_date, prepare_date, notes)
      values (v_sup, current_date + 20, current_date + 19, 'Pedido extra')
      returning id into v_manual;
      insert into public.orders (supplier_id, delivery_date, prepare_date)
      values (v_sup, current_date + 21, current_date + 21);
      select count(*) into v_count from public.orders
      where supplier_id = v_sup and scheduled_delivery_date is null;
      r := r || format('autorizada|Crea pedidos manuales del mismo proveedor en fechas distintas|%s',
        case when v_count = 2 then 'OK' else format('FALLO (%s pedidos)', v_count) end);
    exception when others then
      r := r || format('autorizada|Crea pedidos manuales del mismo proveedor en fechas distintas|FALLO (error %s: %s)', sqlstate, replace(sqlerrm, '|', '/'));
    end;

    begin
      delete from public.orders where id = v_manual;
      get diagnostics v_count = row_count;
      r := r || format('autorizada|Elimina un pedido pendiente|%s',
        case when v_count = 1 then 'OK' else format('FALLO (%s filas eliminadas)', v_count) end);
    exception when others then
      r := r || format('autorizada|Elimina un pedido pendiente|FALLO (error %s: %s)', sqlstate, replace(sqlerrm, '|', '/'));
    end;

    -- Los preparados y los descartados no se eliminan: el DELETE no afecta a
    -- ninguna fila.
    no_rows := array[
      ['Eliminar un pedido preparado (se conserva)', 'delete from public.orders where id = %1$L'],
      ['Eliminar un pedido «no se pide» (se conserva)', 'delete from public.orders where id = %2$L']
    ];
    foreach t slice 1 in array no_rows loop
      begin
        execute format(t[2], v_prepared, v_skipped);
        get diagnostics v_count = row_count;
        r := r || format('autorizada|%s|%s', t[1],
          case when v_count = 0 then 'OK (0 filas afectadas)' else format('FALLO (%s filas eliminadas)', v_count) end);
      exception
        when others then r := r || format('autorizada|%s|FALLO (error %s: %s)', t[1], sqlstate, replace(sqlerrm, '|', '/'));
      end;
    end loop;

    -- Ni siquiera la cuenta autorizada puede borrar proveedores, vaciar tablas
    -- ni cambiar las columnas protegidas de un pedido.
    -- %1$L = proveedor nuevo, %2$L = pedido pendiente, %3$L = proveedor de prueba.
    denied := array[
      ['Eliminar un proveedor (se desactivan, no se borran)', 'delete from public.suppliers where id = %1$L'],
      ['Cambiar el proveedor de un pedido', 'update public.orders set supplier_id = %1$L where id = %2$L'],
      ['Cambiar la entrega prevista de origen de un pedido', 'update public.orders set scheduled_delivery_date = current_date + 30 where id = %2$L'],
      ['Fijar prepared_at directamente', 'update public.orders set prepared_at = now() where id = %2$L'],
      ['Fijar created_at de un pedido', 'update public.orders set created_at = ''2000-01-01'' where id = %2$L'],
      ['TRUNCATE suppliers', 'truncate public.suppliers cascade'],
      ['TRUNCATE orders', 'truncate public.orders'],
      ['TRUNCATE holidays', 'truncate public.holidays']
    ];
    foreach t slice 1 in array denied loop
      begin
        execute format(t[2], v_new_sup, v_pending, v_sup);
        raise exception 'NO_DENEGADO';
      exception
        when insufficient_privilege then r := r || format('autorizada|%s|OK (denegado)', t[1]);
        when raise_exception then r := r || format('autorizada|%s|FALLO (permitido; revertido)', t[1]);
        when others then r := r || format('autorizada|%s|FALLO (error %s: %s)', t[1], sqlstate, replace(sqlerrm, '|', '/'));
      end;
    end loop;

    -- Restricciones: deben rechazarse con el código indicado (como la cuenta
    -- autorizada). %1$L = proveedor de prueba, %2$L = pedido pendiente
    -- (entrega en current_date + 2, previsión de current_date + 3).
    rejected := array[
      ['Proveedor con nombre vacío', 'insert into public.suppliers (name) values ('''')', '23514'],
      ['Proveedor con nombre solo de espacios y saltos de línea', 'insert into public.suppliers (name) values (E'' \t\n '')', '23514'],
      ['Proveedor sin nombre (null)', 'insert into public.suppliers (name) values (null)', '23502'],
      ['Proveedor duplicado (mayúsculas y espacios distintos)', 'insert into public.suppliers (name) values (E''  PROVEEDOR de  prueba\t(orders_rls_checks.sql) '')', '23505'],
      ['Proveedor duplicado (solo cambian los acentos)', 'insert into public.suppliers (name) values (''Próveedör dé prùeba (orders_rls_checks.sql)'')', '23505'],
      ['Proveedor duplicado (acento escrito como carácter combinado)', 'insert into public.suppliers (name) values (U&''Prove\0301edor de prueba (orders_rls_checks.sql)'')', '23505'],
      ['Renombrar un proveedor con el nombre de otro', 'update public.suppliers set name = ''alta desde la app (orders_rls_checks.sql)'' where id = %1$L', '23505'],
      ['Día de entrega 0', 'insert into public.suppliers (name, delivery_weekdays) values (''Días X'', ''{0,1}'')', '23514'],
      ['Día de entrega 8', 'insert into public.suppliers (name, delivery_weekdays) values (''Días X'', ''{8}'')', '23514'],
      ['Día de entrega nulo en la lista', 'insert into public.suppliers (name, delivery_weekdays) values (''Días X'', ''{1,NULL}'')', '23514'],
      ['Días de entrega en una matriz de dos dimensiones', 'insert into public.suppliers (name, delivery_weekdays) values (''Días X'', ''{{1,2},{3,4}}'')', '23514'],
      ['Días de entrega nulos', 'insert into public.suppliers (name, delivery_weekdays) values (''Días X'', null)', '23502'],
      ['Antelación negativa', 'insert into public.suppliers (name, order_lead_days) values (''Antelación X'', -1)', '23514'],
      ['Antelación de 8 días', 'update public.suppliers set order_lead_days = 8 where id = %1$L', '23514'],
      ['Festivo en una fecha ya configurada', 'insert into public.holidays (holiday_date, name, scope) values (''2199-12-25'', ''Repetido'', ''local'')', '23505'],
      ['Festivo con ámbito desconocido', 'insert into public.holidays (holiday_date, name, scope) values (''2199-03-19'', ''San José'', ''municipal'')', '23514'],
      ['Festivo sin nombre (espacios)', 'insert into public.holidays (holiday_date, name, scope) values (''2199-03-19'', ''  '', ''regional'')', '23514'],
      ['Festivo sin fecha (null)', 'insert into public.holidays (holiday_date, name, scope) values (null, ''X'', ''local'')', '23502'],
      ['Pedido con estado desconocido', 'insert into public.orders (supplier_id, delivery_date, prepare_date, status) values (%1$L, current_date + 40, current_date + 39, ''ordered'')', '23514'],
      ['Pedido con preparación posterior a la entrega', 'insert into public.orders (supplier_id, delivery_date, prepare_date) values (%1$L, current_date + 40, current_date + 41)', '23514'],
      ['Corregir la preparación a después de la entrega', 'update public.orders set prepare_date = delivery_date + 1 where id = %2$L', '23514'],
      ['Pedido sin fecha de entrega (null)', 'insert into public.orders (supplier_id, delivery_date, prepare_date) values (%1$L, null, current_date)', '23502'],
      ['Pedido sin fecha de preparación (null)', 'insert into public.orders (supplier_id, delivery_date, prepare_date) values (%1$L, current_date + 40, null)', '23502'],
      ['Pedido de un proveedor inexistente', 'insert into public.orders (supplier_id, delivery_date, prepare_date) values (gen_random_uuid(), current_date + 40, current_date + 39)', '23503'],
      ['Segundo pedido del mismo proveedor y fecha de entrega', 'insert into public.orders (supplier_id, delivery_date, prepare_date) values (%1$L, current_date + 2, current_date + 1)', '23505'],
      ['Segundo pedido desde la misma previsión (dos dispositivos)', 'insert into public.orders (supplier_id, scheduled_delivery_date, delivery_date, prepare_date) values (%1$L, current_date + 3, current_date + 5, current_date + 4)', '23505'],
      ['Mover un pedido a una entrega que ya tiene otro pedido', 'update public.orders set delivery_date = current_date - 4, prepare_date = current_date - 5 where id = %2$L', '23505']
    ];
    foreach t slice 1 in array rejected loop
      begin
        execute format(t[2], v_sup, v_pending);
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

    -- Como postgres: ni desde el panel se puede borrar un proveedor con
    -- pedidos (ON DELETE RESTRICT).
    begin
      delete from public.suppliers where id = v_sup;
      raise exception 'NO_RECHAZADO';
    exception
      when foreign_key_violation then
        r := r || text 'restricciones|Borrar un proveedor con pedidos (como postgres)|OK (rechazado, 23503)';
      when raise_exception then
        r := r || text 'restricciones|Borrar un proveedor con pedidos (como postgres)|FALLO (borrado; revertido)';
      when others then
        r := r || format('restricciones|Borrar un proveedor con pedidos (como postgres)|FALLO (error %s: %s)', sqlstate, replace(sqlerrm, '|', '/'));
    end;

    -- Como postgres: aunque se envíe un prepared_at incoherente, el trigger
    -- lo corrige según el estado.
    begin
      update public.orders set prepared_at = '2000-01-01' where id = v_skipped;
      insert into public.orders (supplier_id, delivery_date, prepare_date, status, prepared_at)
      values (v_sup, current_date + 50, current_date + 49, 'prepared', null);
      select count(*) into v_count from public.orders
      where (id = v_skipped and prepared_at is null)
         or (supplier_id = v_sup and delivery_date = current_date + 50 and prepared_at = now());
      r := r || format('restricciones|prepared_at siempre coherente con el estado (trigger)|%s',
        case when v_count = 2 then 'OK' else format('FALLO (%s filas)', v_count) end);
    exception when others then
      r := r || format('restricciones|prepared_at siempre coherente con el estado (trigger)|FALLO (error %s: %s)', sqlstate, replace(sqlerrm, '|', '/'));
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

  select (select count(*) from public.suppliers where id in (v_sup, v_new_sup) or name like '%orders_rls_checks.sql%')
       + (select count(*) from public.orders where supplier_id in (v_sup, v_new_sup))
       + (select count(*) from public.holidays where holiday_date between '2199-01-01' and '2199-12-31')
    into v_count;
  r := r || format('limpieza|No queda ningún dato de prueba|%s',
    case when v_count = 0 and v_sup is not null then 'OK' else format('FALLO (%s filas)', v_count) end);

  insert into pg_temp.orders_check_results (n, grupo, comprobacion, resultado)
  select i, split_part(r[i], '|', 1), split_part(r[i], '|', 2), split_part(r[i], '|', 3)
  from generate_subscripts(r, 1) as i;
end;
$$;

select n, grupo, comprobacion, resultado
from pg_temp.orders_check_results
order by n;
