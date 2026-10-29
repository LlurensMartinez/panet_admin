-- =============================================================================
-- Panet Admin · Comprobaciones de RLS de productos habituales
-- (tabla `supplier_products`)
-- =============================================================================
--
-- Uso: SQL Editor de Supabase o `psql`, DESPUÉS de aplicar la migración
-- 20261029214500_supplier_products.sql. Requiere también las de `profiles` y
-- de proveedores, y la cuenta autorizada (secciones 5, 6 y 10 de
-- SUPABASE_SETUP.md). Ver SUPABASE_SETUP.md, sección 11.
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
-- script contiene DELETE, DROP, TRUNCATE o ALTER. Son intentos que se
-- ejecutan con los roles `anon` y `authenticated` y que DEBEN fallar o no
-- afectar a ninguna fila (si alguno funcionara, se deshace y se marca como
-- FALLO), escrituras permitidas sobre filas de prueba que el propio script
-- crea y deshace, y un TRUNCATE de su tabla temporal de resultados. No se
-- modifican tablas, políticas, funciones ni datos reales.
--
-- No deja cambios en la base de datos ni en la sesión: crea dos proveedores y
-- unos productos de prueba dentro de un bloque que termina SIEMPRE con un
-- error forzado, así que PostgreSQL los deshace (la última fila del resultado
-- lo comprueba). El resultado se muestra desde una tabla temporal.
--
-- Resultado esperado: todas las filas con `resultado` que empieza por 'OK',
-- salvo una fila informativa ('INFO') que indica si el UUID de la segunda
-- cuenta existe en auth.users. Un error inesperado en cualquier prueba se
-- registra como 'FALLO (error <código>: <mensaje>)' sin detener el script.
-- =============================================================================

create temp table if not exists products_check_results (
  n int,
  grupo text,
  comprobacion text,
  resultado text
);
truncate pg_temp.products_check_results;

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

  v_original_role text := current_user;
  v_unauthorized_is_random boolean;
  r text[] := '{}';            -- resultados: grupo|comprobación|resultado
  v_count int;
  v_bool boolean;
  v_text text;
  v_sup_a uuid;                -- proveedor de prueba A
  v_sup_b uuid;                -- proveedor de prueba B
  v_prod uuid;                 -- producto de prueba de A
  v_new_prod uuid;             -- producto creado por la cuenta autorizada (en B)
  t text[];
  denied text[];
  no_rows text[];
  rejected text[];
begin
  if v_authorized = '00000000-0000-0000-0000-000000000000' then
    raise exception 'Sustituye v_authorized por el UUID de la cuenta autorizada antes de ejecutar el script.';
  end if;
  if to_regclass('public.supplier_products') is null then
    raise exception 'Falta la tabla supplier_products: aplica antes la migración 20261029214500_supplier_products.sql.';
  end if;
  v_unauthorized_is_random := v_unauthorized is null;
  v_unauthorized := coalesce(v_unauthorized, gen_random_uuid());
  if v_unauthorized = v_authorized then
    raise exception 'v_unauthorized debe ser una cuenta distinta de v_authorized.';
  end if;

  -- =========================================================== 1. Configuración
  select c.relrowsecurity into v_bool from pg_class c where c.oid = 'public.supplier_products'::regclass;
  r := r || format('configuración|RLS activado en supplier_products|%s', case when v_bool then 'OK' else 'FALLO' end);

  select string_agg(policyname || ':' || cmd, ', ' order by policyname) into v_text
  from pg_policies where schemaname = 'public' and tablename = 'supplier_products';
  r := r || format('configuración|Políticas SELECT, INSERT y UPDATE (sin DELETE)|%s',
    case when v_text = 'supplier_products_insert_authorized:INSERT, supplier_products_select_authorized:SELECT, supplier_products_update_authorized:UPDATE'
         then 'OK' else 'FALLO (' || coalesce(v_text, 'ninguna') || ')' end);

  select string_agg(policyname, ', ' order by policyname) into v_text
  from pg_policies
  where schemaname = 'public' and tablename = 'supplier_products'
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

  r := r || format('configuración|anon sin privilegios sobre supplier_products|%s',
    case when not has_table_privilege('anon', 'public.supplier_products', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
          and not has_any_column_privilege('anon', 'public.supplier_products', 'SELECT,INSERT,UPDATE,REFERENCES')
         then 'OK' else 'FALLO' end);

  r := r || format('configuración|authenticated: SELECT e INSERT; sin DELETE, TRUNCATE ni UPDATE de tabla|%s',
    case when has_table_privilege('authenticated', 'public.supplier_products', 'SELECT')
          and has_table_privilege('authenticated', 'public.supplier_products', 'INSERT')
          and not has_table_privilege('authenticated', 'public.supplier_products', 'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
         then 'OK' else 'FALLO' end);

  select string_agg(a.attname, ', ' order by a.attname) into v_text
  from pg_attribute a
  where a.attrelid = 'public.supplier_products'::regclass and a.attnum > 0 and not a.attisdropped
    and has_column_privilege('authenticated', 'public.supplier_products', a.attname, 'UPDATE');
  r := r || format('configuración|authenticated: UPDATE solo de is_active, name, unit y usual_quantity|%s',
    case when v_text = 'is_active, name, unit, usual_quantity' then 'OK' else 'FALLO (' || coalesce(v_text, 'ninguna') || ')' end);

  r := r || format('configuración|Sin privilegios para PUBLIC|%s',
    case when not exists (
            select 1 from pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
            where c.oid = 'public.supplier_products'::regclass and a.grantee = 0)
         then 'OK' else 'FALLO' end);

  select count(*) into v_count
  from pg_constraint
  where conrelid = 'public.supplier_products'::regclass and contype = 'f'
    and confrelid = 'public.suppliers'::regclass and confdeltype = 'r';
  r := r || format('configuración|Clave foránea supplier_products → suppliers con ON DELETE RESTRICT|%s',
    case when v_count = 1 then 'OK' else format('FALLO (%s encontradas)', v_count) end);

  select count(*) into v_count
  from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
  where i.indexrelid = to_regclass('public.supplier_products_name_unique_idx')
    and i.indisunique and a.attname = 'supplier_id';
  r := r || format('configuración|Índice único de nombre por proveedor (empieza por supplier_id)|%s',
    case when v_count = 1 then 'OK' else 'FALLO' end);

  select count(*) into v_count
  from pg_trigger tg
  where not tg.tgisinternal and tg.tgenabled = 'O'
    and tg.tgfoid = 'private.set_updated_at()'::regprocedure
    and tg.tgrelid = 'public.supplier_products'::regclass;
  r := r || format('configuración|Trigger de updated_at activo|%s',
    case when v_count = 1 then 'OK' else format('FALLO (%s encontrados)', v_count) end);

  select count(*) into v_count from public.profiles where id = v_authorized;
  r := r || format('configuración|La cuenta autorizada tiene fila en profiles|%s',
    case when v_count = 1 then 'OK' else 'FALLO (añádela antes: ver SUPABASE_SETUP.md, sección 6)' end);

  select count(*) into v_count from public.profiles where id = v_unauthorized;
  r := r || format('configuración|La segunda cuenta NO tiene fila en profiles|%s',
    case when v_count = 0 then 'OK' else 'FALLO' end);

  select count(*) into v_count from auth.users where id = v_unauthorized;
  r := r || format('configuración|Segunda cuenta: existe en auth.users|%s',
    case
      when v_unauthorized_is_random then 'INFO: UUID aleatorio (no es una cuenta real; la prueba de RLS sigue siendo válida)'
      when v_count = 1 then 'INFO: sí, es una cuenta real'
      else 'INFO: no existe; revisa el UUID de v_unauthorized'
    end);

  -- ============================================ Pruebas con datos (se deshacen)
  begin
    insert into public.suppliers (name) values ('Proveedor A (supplier_products_rls_checks.sql)') returning id into v_sup_a;
    insert into public.suppliers (name) values ('Proveedor B (supplier_products_rls_checks.sql)') returning id into v_sup_b;
    insert into public.supplier_products (supplier_id, name, unit, usual_quantity, updated_at)
    values (v_sup_a, 'Harina de fuerza', 'sacos', 2, '2000-01-01')
    returning id into v_prod;

    -- ========================================================= 2. Sin sesión (anon)
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    perform set_config('request.jwt.claim.sub', '', true);
    set local role anon;

    denied := array[
      ['Leer productos', 'select count(*) from public.supplier_products'],
      ['Crear producto', 'insert into public.supplier_products (supplier_id, name, unit, usual_quantity) values (%1$L, ''X'', ''u'', 1)'],
      ['Modificar productos', 'update public.supplier_products set usual_quantity = 9'],
      ['Eliminar productos', 'delete from public.supplier_products'],
      ['TRUNCATE supplier_products', 'truncate public.supplier_products']
    ];
    foreach t slice 1 in array denied loop
      begin
        execute format(t[2], v_sup_a, v_prod);
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
      select count(*) into v_count from public.supplier_products;
      r := r || format('no autorizada|No ve ningún producto|%s',
        case when v_count = 0 then 'OK' else format('FALLO (ve %s)', v_count) end);
    exception when others then
      r := r || format('no autorizada|No ve ningún producto|FALLO (error %s: %s)', sqlstate, replace(sqlerrm, '|', '/'));
    end;

    denied := array[
      ['Crear producto', 'insert into public.supplier_products (supplier_id, name, unit, usual_quantity) values (%1$L, ''X'', ''u'', 1)'],
      ['Eliminar el producto de prueba', 'delete from public.supplier_products where id = %2$L'],
      ['TRUNCATE supplier_products', 'truncate public.supplier_products'],
      ['Desactivar RLS de supplier_products', 'alter table public.supplier_products disable row level security'],
      ['Borrar la política de lectura', 'drop policy supplier_products_select_authorized on public.supplier_products'],
      ['Crear una política abierta', 'create policy permitir_todo on public.supplier_products for all to authenticated using (true) with check (true)']
    ];
    foreach t slice 1 in array denied loop
      begin
        execute format(t[2], v_sup_a, v_prod);
        raise exception 'NO_DENEGADO';
      exception
        when insufficient_privilege then r := r || format('no autorizada|%s|OK (denegado)', t[1]);
        when raise_exception then r := r || format('no autorizada|%s|FALLO (permitido; revertido)', t[1]);
        when others then r := r || format('no autorizada|%s|FALLO (error %s: %s)', t[1], sqlstate, replace(sqlerrm, '|', '/'));
      end;
    end loop;

    no_rows := array[
      ['Modificar el producto de prueba', 'update public.supplier_products set usual_quantity = 9 where id = %2$L'],
      ['Desactivar el producto de prueba', 'update public.supplier_products set is_active = false where id = %2$L']
    ];
    foreach t slice 1 in array no_rows loop
      begin
        execute format(t[2], v_sup_a, v_prod);
        get diagnostics v_count = row_count;
        r := r || format('no autorizada|%s|%s', t[1],
          case when v_count = 0 then 'OK (0 filas afectadas)' else format('FALLO (%s filas afectadas)', v_count) end);
      exception
        when insufficient_privilege then r := r || format('no autorizada|%s|OK (denegado)', t[1]);
        when others then r := r || format('no autorizada|%s|FALLO (error %s: %s)', t[1], sqlstate, replace(sqlerrm, '|', '/'));
      end;
    end loop;

    perform set_config('role', v_original_role, true);

    select count(*) into v_count from public.supplier_products
    where id = v_prod and usual_quantity = 2 and is_active and supplier_id = v_sup_a;
    r := r || format('no autorizada|El producto de prueba sigue intacto tras sus intentos|%s',
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
      select count(*) into v_count from public.supplier_products where id = v_prod;
      r := r || format('autorizada|Ve el producto de prueba|%s', case when v_count = 1 then 'OK' else format('FALLO (ve %s)', v_count) end);
    exception when others then
      r := r || format('autorizada|Ve el producto de prueba|FALLO (error %s: %s)', sqlstate, replace(sqlerrm, '|', '/'));
    end;

    begin
      insert into public.supplier_products (supplier_id, name, unit, usual_quantity)
      values (v_sup_b, 'Levadura fresca', 'kg', 2.5)
      returning id into v_new_prod;
      select count(*) into v_count from public.supplier_products
      where id = v_new_prod and usual_quantity = 2.5 and is_active and supplier_id = v_sup_b;
      r := r || format('autorizada|Crea un producto con cantidad decimal (2,5 kg), activo por defecto|%s',
        case when v_count = 1 then 'OK' else 'FALLO' end);
    exception when others then
      r := r || format('autorizada|Crea un producto con cantidad decimal (2,5 kg), activo por defecto|FALLO (error %s: %s)', sqlstate, replace(sqlerrm, '|', '/'));
    end;

    begin
      insert into public.supplier_products (supplier_id, name, unit, usual_quantity)
      values (v_sup_b, 'Harina de fuerza', 'sacos', 1);
      r := r || text 'autorizada|Otro proveedor puede tener un producto con el mismo nombre|OK';
    exception when others then
      r := r || format('autorizada|Otro proveedor puede tener un producto con el mismo nombre|FALLO (error %s: %s)', sqlstate, replace(sqlerrm, '|', '/'));
    end;

    begin
      insert into public.supplier_products (supplier_id, name, unit, usual_quantity)
      values (v_sup_a, 'Pena', 'cajas', 1), (v_sup_a, 'Peña', 'cajas', 1);
      r := r || text 'autorizada|Admite dos productos que solo se diferencian en «ñ» y «n»|OK';
    exception when others then
      r := r || format('autorizada|Admite dos productos que solo se diferencian en «ñ» y «n»|FALLO (error %s: %s)', sqlstate, replace(sqlerrm, '|', '/'));
    end;

    begin
      update public.supplier_products
      set name = 'Harina de fuerza W300', unit = 'sacos de 25 kg', usual_quantity = 99999.99
      where id = v_prod;
      get diagnostics v_count = row_count;
      select v_count = 1 and p.usual_quantity = 99999.99 and p.updated_at = now() into v_bool
      from public.supplier_products p where p.id = v_prod;
      r := r || format('autorizada|Edita nombre, unidad y cantidad (máximo 99999.99); updated_at se actualiza|%s',
        case when v_bool then 'OK' else 'FALLO' end);
    exception when others then
      r := r || format('autorizada|Edita nombre, unidad y cantidad (máximo 99999.99); updated_at se actualiza|FALLO (error %s: %s)', sqlstate, replace(sqlerrm, '|', '/'));
    end;

    begin
      update public.supplier_products set is_active = false where id = v_prod;
      select count(*) into v_count from public.supplier_products where id = v_prod and not is_active;
      update public.supplier_products set is_active = true where id = v_prod;
      select v_count = 1 and p.is_active into v_bool from public.supplier_products p where p.id = v_prod;
      r := r || format('autorizada|Desactiva y reactiva un producto (se conserva)|%s', case when v_bool then 'OK' else 'FALLO' end);
    exception when others then
      r := r || format('autorizada|Desactiva y reactiva un producto (se conserva)|FALLO (error %s: %s)', sqlstate, replace(sqlerrm, '|', '/'));
    end;

    -- %1$L = proveedor B, %2$L = producto de A.
    denied := array[
      ['Eliminar un producto (se desactivan, no se borran)', 'delete from public.supplier_products where id = %2$L'],
      ['Pasar un producto a otro proveedor', 'update public.supplier_products set supplier_id = %1$L where id = %2$L'],
      ['Fijar updated_at desde el cliente', 'update public.supplier_products set updated_at = ''2000-01-01'' where id = %2$L'],
      ['Fijar created_at desde el cliente', 'update public.supplier_products set created_at = ''2000-01-01'' where id = %2$L'],
      ['TRUNCATE supplier_products', 'truncate public.supplier_products']
    ];
    foreach t slice 1 in array denied loop
      begin
        execute format(t[2], v_sup_b, v_prod);
        raise exception 'NO_DENEGADO';
      exception
        when insufficient_privilege then r := r || format('autorizada|%s|OK (denegado)', t[1]);
        when raise_exception then r := r || format('autorizada|%s|FALLO (permitido; revertido)', t[1]);
        when others then r := r || format('autorizada|%s|FALLO (error %s: %s)', t[1], sqlstate, replace(sqlerrm, '|', '/'));
      end;
    end loop;

    -- Restricciones (como la cuenta autorizada). %1$L = proveedor A, %2$L =
    -- producto de A («Harina de fuerza W300»), %3$L = producto nuevo de B.
    rejected := array[
      ['Nombre vacío', 'insert into public.supplier_products (supplier_id, name, unit, usual_quantity) values (%1$L, '''', ''u'', 1)', '23514'],
      ['Nombre solo con espacios y saltos de línea', 'insert into public.supplier_products (supplier_id, name, unit, usual_quantity) values (%1$L, E'' \t\n '', ''u'', 1)', '23514'],
      ['Nombre nulo', 'insert into public.supplier_products (supplier_id, name, unit, usual_quantity) values (%1$L, null, ''u'', 1)', '23502'],
      ['Unidad vacía', 'insert into public.supplier_products (supplier_id, name, unit, usual_quantity) values (%1$L, ''X'', ''  '', 1)', '23514'],
      ['Unidad nula', 'insert into public.supplier_products (supplier_id, name, unit, usual_quantity) values (%1$L, ''X'', null, 1)', '23502'],
      ['Cantidad 0', 'insert into public.supplier_products (supplier_id, name, unit, usual_quantity) values (%1$L, ''X'', ''u'', 0)', '23514'],
      ['Cantidad negativa', 'insert into public.supplier_products (supplier_id, name, unit, usual_quantity) values (%1$L, ''X'', ''u'', -1)', '23514'],
      ['Cantidad de 100000', 'insert into public.supplier_products (supplier_id, name, unit, usual_quantity) values (%1$L, ''X'', ''u'', 100000)', '23514'],
      ['Cantidad nula', 'insert into public.supplier_products (supplier_id, name, unit, usual_quantity) values (%1$L, ''X'', ''u'', null)', '23502'],
      ['Cambiar la cantidad a 0', 'update public.supplier_products set usual_quantity = 0 where id = %2$L', '23514'],
      ['Producto duplicado en el mismo proveedor (mayúsculas, espacios y acentos)', 'insert into public.supplier_products (supplier_id, name, unit, usual_quantity) values (%1$L, E''  HARÍNA de\tfuerza  w300 '', ''u'', 1)', '23505'],
      ['Producto duplicado (acento escrito como carácter combinado)', 'insert into public.supplier_products (supplier_id, name, unit, usual_quantity) values (%1$L, U&''Pen\0303a'', ''u'', 1)', '23505'],
      ['Renombrar un producto con el nombre de otro del mismo proveedor', 'update public.supplier_products set name = ''pena'' where id = %2$L', '23505'],
      ['Producto de un proveedor inexistente', 'insert into public.supplier_products (supplier_id, name, unit, usual_quantity) values (gen_random_uuid(), ''X'', ''u'', 1)', '23503']
    ];
    foreach t slice 1 in array rejected loop
      begin
        execute format(t[2], v_sup_a, v_prod, v_new_prod);
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
    -- productos (ON DELETE RESTRICT).
    begin
      delete from public.suppliers where id = v_sup_a;
      raise exception 'NO_RECHAZADO';
    exception
      when foreign_key_violation then
        r := r || text 'restricciones|Borrar un proveedor con productos (como postgres)|OK (rechazado, 23503)';
      when raise_exception then
        r := r || text 'restricciones|Borrar un proveedor con productos (como postgres)|FALLO (borrado; revertido)';
      when others then
        r := r || format('restricciones|Borrar un proveedor con productos (como postgres)|FALLO (error %s: %s)', sqlstate, replace(sqlerrm, '|', '/'));
    end;

    raise exception 'Fin de las pruebas: se deshacen los datos de prueba' using errcode = 'PX999';
  exception
    when sqlstate 'PX999' then
      null;
  end;

  perform set_config('role', v_original_role, true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);

  select (select count(*) from public.suppliers where id in (v_sup_a, v_sup_b) or name like '%supplier_products_rls_checks.sql%')
       + (select count(*) from public.supplier_products where supplier_id in (v_sup_a, v_sup_b))
    into v_count;
  r := r || format('limpieza|No queda ningún dato de prueba|%s',
    case when v_count = 0 and v_sup_a is not null then 'OK' else format('FALLO (%s filas)', v_count) end);

  insert into pg_temp.products_check_results (n, grupo, comprobacion, resultado)
  select i, split_part(r[i], '|', 1), split_part(r[i], '|', 2), split_part(r[i], '|', 3)
  from generate_subscripts(r, 1) as i;
end;
$$;

select n, grupo, comprobacion, resultado
from pg_temp.products_check_results
order by n;
