-- =============================================================================
-- Panet Admin · Comprobaciones de los horarios del personal
-- (`employee_schedules`, `employee_day_overrides`, `employee_absences`,
-- `employees.last_working_date`, baja y reactivación)
-- =============================================================================
--
-- Uso: SQL Editor de Supabase o `psql`, DESPUÉS de aplicar la migración
-- 20261105100000_employee_schedules.sql. Ver SUPABASE_SETUP.md, sección 14.
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
-- afectar a ninguna fila, escrituras sobre empleadas de prueba que el propio
-- script crea y deshace, y un TRUNCATE de su tabla temporal de resultados.
--
-- No deja cambios: todo ocurre dentro de un bloque que termina SIEMPRE con un
-- error forzado, así que PostgreSQL lo deshace (la última fila lo comprueba).
-- Las pruebas usan empleadas de prueba propias: no tocan las empleadas, los
-- horarios ni las horas extra reales.
--
-- Las fechas son relativas a «hoy» en Europe/Madrid, así que el resultado no
-- depende del día en que se ejecute.
--
-- Resultado esperado: todas las filas con `resultado` que empieza por 'OK',
-- salvo las informativas ('INFO').
-- =============================================================================

create temp table if not exists staff_schedule_check_results (
  n int,
  grupo text,
  comprobacion text,
  resultado text
);
truncate pg_temp.staff_schedule_check_results;

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
  s text[] := '{}';            -- pasos: [grupo, comprobación, sql, esperado]
  t text[];
  v_count int;
  v_bool boolean;
  v_text text;
  v_state text;

  -- Empleadas de prueba (se crean y se deshacen al final).
  v_a uuid := gen_random_uuid();   -- versiones y ausencias
  v_b uuid := gen_random_uuid();   -- cambios de un día y turnos nocturnos
  v_c uuid := gen_random_uuid();   -- baja y reactivación
  v_d uuid := gen_random_uuid();   -- límites entre versiones y deshacer una baja
  v_e uuid := gen_random_uuid();   -- horario creado como postgres (lecturas)
  v_f uuid := gen_random_uuid();   -- desactivada antes del módulo (sin fecha)
  v_g uuid := gen_random_uuid();   -- sin planificación (desactivación de siempre)
  a text; b text; c text; d text; e text; f text; g text;

  v_today date;
  v_monday date;               -- lunes de esta semana
  v_next date;                 -- lunes de la semana que viene
  v_dst_spring date;           -- último domingo de marzo del año que viene
  v_dst_autumn date;           -- último domingo de octubre del año que viene

  -- Semanas de prueba.
  w1 text := '{"1":[{"start":"07:00","end":"14:00"}],"2":[{"start":"07:00","end":"14:00"}],"3":[{"start":"07:00","end":"14:00"}],"4":[{"start":"07:00","end":"14:00"}],"5":[{"start":"07:00","end":"14:00"}],"6":[{"start":"07:00","end":"13:00"}],"7":[]}';
  w1b text := '{"1":[{"start":"08:00","end":"15:00"}],"2":[{"start":"07:00","end":"14:00"}],"3":[{"start":"07:00","end":"14:00"}],"4":[{"start":"07:00","end":"14:00"}],"5":[{"start":"07:00","end":"14:00"}]}';
  -- Miércoles de noche (22:00-06:00) y jueves desde las 07:00.
  wb text := '{"1":[{"start":"07:00","end":"14:00"}],"2":[{"start":"07:00","end":"14:00"}],"3":[{"start":"22:00","end":"06:00"}],"4":[{"start":"07:00","end":"14:00"}],"5":[{"start":"07:00","end":"14:00"}]}';
  -- Solo el domingo de noche (22:00-06:00).
  wd text := '{"7":[{"start":"22:00","end":"06:00"}]}';

  v_overtime_before text;
  v_schedules_before text;
  v_c_history_before text;
  v_counts_before text;
  v_employees_before text;
begin
  if v_authorized = '00000000-0000-0000-0000-000000000000' then
    raise exception 'Sustituye v_authorized por el UUID de la cuenta autorizada antes de ejecutar el script.';
  end if;
  if to_regclass('public.employee_schedules') is null then
    raise exception 'Falta la tabla employee_schedules: aplica antes la migración 20261105100000_employee_schedules.sql.';
  end if;
  v_unauthorized := coalesce(v_unauthorized, gen_random_uuid());
  if v_unauthorized = v_authorized then
    raise exception 'v_unauthorized debe ser una cuenta distinta de v_authorized.';
  end if;

  a := quote_literal(v_a); b := quote_literal(v_b); c := quote_literal(v_c);
  d := quote_literal(v_d); e := quote_literal(v_e); f := quote_literal(v_f); g := quote_literal(v_g);
  v_today := private.shop_today();
  v_monday := private.week_start(v_today);
  v_next := v_monday + 7;
  v_dst_spring := make_date(extract(year from v_today)::int + 1, 3, 31);
  v_dst_spring := v_dst_spring - (extract(isodow from v_dst_spring)::int % 7);
  v_dst_autumn := make_date(extract(year from v_today)::int + 1, 10, 31);
  v_dst_autumn := v_dst_autumn - (extract(isodow from v_dst_autumn)::int % 7);

  select md5(coalesce(string_agg(format('%s|%s|%s|%s', id, employee_id, work_date, duration_minutes), ';' order by id), ''))
  into v_overtime_before from public.overtime_entries;
  select format('%s/%s/%s', (select count(*) from public.employee_schedules),
    (select count(*) from public.employee_day_overrides), (select count(*) from public.employee_absences))
  into v_counts_before;
  select md5(coalesce(string_agg(format('%s|%s|%s|%s', id, first_name, is_active, last_working_date), ';' order by id), ''))
  into v_employees_before from public.employees;

  -- =========================================================== 1. Configuración
  select count(*) into v_count from pg_class
  where oid in ('public.employee_schedules'::regclass, 'public.employee_day_overrides'::regclass, 'public.employee_absences'::regclass)
    and relrowsecurity;
  r := r || format('configuración|RLS activado en las tres tablas|%s', case when v_count = 3 then 'OK' else format('FALLO (%s de 3)', v_count) end);

  select string_agg(tablename || '.' || policyname || ':' || cmd, ', ' order by tablename, policyname) into v_text
  from pg_policies where schemaname = 'public'
    and tablename in ('employee_schedules', 'employee_day_overrides', 'employee_absences');
  r := r || format('configuración|Políticas esperadas (SELECT, INSERT, UPDATE y DELETE por tabla)|%s',
    case when v_text = 'employee_absences.employee_absences_delete_authorized:DELETE, employee_absences.employee_absences_insert_authorized:INSERT, employee_absences.employee_absences_select_authorized:SELECT, employee_absences.employee_absences_update_authorized:UPDATE, '
      || 'employee_day_overrides.employee_day_overrides_delete_authorized:DELETE, employee_day_overrides.employee_day_overrides_insert_authorized:INSERT, employee_day_overrides.employee_day_overrides_select_authorized:SELECT, employee_day_overrides.employee_day_overrides_update_authorized:UPDATE, '
      || 'employee_schedules.employee_schedules_delete_future:DELETE, employee_schedules.employee_schedules_insert_authorized:INSERT, employee_schedules.employee_schedules_select_authorized:SELECT, employee_schedules.employee_schedules_update_future:UPDATE'
      then 'OK' else 'FALLO (' || coalesce(v_text, 'ninguna') || ')' end);

  select string_agg(tablename || '.' || policyname, ', ' order by policyname) into v_text
  from pg_policies
  where schemaname = 'public'
    and tablename in ('employee_schedules', 'employee_day_overrides', 'employee_absences')
    and not coalesce(
      permissive = 'PERMISSIVE'
      and roles = array['authenticated']::name[]
      and case cmd
            when 'SELECT' then qual like '%private.is_authorized()%' and with_check is null
            when 'INSERT' then qual is null and with_check like '%private.is_authorized()%'
            when 'UPDATE' then qual like '%private.is_authorized()%' and with_check like '%private.is_authorized()%'
            when 'DELETE' then qual like '%private.is_authorized()%' and with_check is null
            else false
          end,
      false);
  r := r || format('configuración|Todas las políticas: solo authenticated y basadas en is_authorized()|%s',
    case when v_text is null then 'OK' else 'FALLO (' || v_text || ')' end);

  select count(*) into v_count from pg_policies
  where schemaname = 'public' and tablename = 'employee_schedules'
    and policyname in ('employee_schedules_update_future', 'employee_schedules_delete_future')
    and qual like '%private.shop_today()%'
    and (cmd = 'DELETE' or with_check like '%private.shop_today()%');
  r := r || format('configuración|Versiones: solo se editan o borran las futuras|%s', case when v_count = 2 then 'OK' else 'FALLO' end);

  select string_agg(tbl, ', ') into v_text
  from unnest(array['public.employee_schedules', 'public.employee_day_overrides', 'public.employee_absences']) as tbl
  where has_table_privilege('anon', tbl, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     or has_any_column_privilege('anon', tbl, 'SELECT,INSERT,UPDATE,REFERENCES');
  r := r || format('configuración|anon sin privilegios sobre las tres tablas|%s', case when v_text is null then 'OK' else 'FALLO (' || v_text || ')' end);

  select string_agg(tbl, ', ') into v_text
  from unnest(array['public.employee_schedules', 'public.employee_day_overrides', 'public.employee_absences']) as tbl
  where not (has_table_privilege('authenticated', tbl, 'SELECT')
     and has_table_privilege('authenticated', tbl, 'INSERT')
     and has_table_privilege('authenticated', tbl, 'DELETE')
     and not has_table_privilege('authenticated', tbl, 'UPDATE')
     and not has_table_privilege('authenticated', tbl, 'TRUNCATE,REFERENCES,TRIGGER'));
  r := r || format('configuración|authenticated: SELECT, INSERT y DELETE; UPDATE solo por columnas; sin TRUNCATE|%s',
    case when v_text is null then 'OK' else 'FALLO (' || v_text || ')' end);

  r := r || format('configuración|Columnas editables: week y notes; shifts y notes; tipo, fechas y notes|%s',
    case when has_column_privilege('authenticated', 'public.employee_schedules', 'week', 'UPDATE')
          and has_column_privilege('authenticated', 'public.employee_schedules', 'notes', 'UPDATE')
          and not has_column_privilege('authenticated', 'public.employee_schedules', 'valid_from', 'UPDATE')
          and not has_column_privilege('authenticated', 'public.employee_schedules', 'kind', 'UPDATE')
          and not has_column_privilege('authenticated', 'public.employee_schedules', 'employee_id', 'UPDATE')
          and has_column_privilege('authenticated', 'public.employee_day_overrides', 'shifts', 'UPDATE')
          and has_column_privilege('authenticated', 'public.employee_day_overrides', 'notes', 'UPDATE')
          and not has_column_privilege('authenticated', 'public.employee_day_overrides', 'work_date', 'UPDATE')
          and not has_column_privilege('authenticated', 'public.employee_day_overrides', 'employee_id', 'UPDATE')
          and has_column_privilege('authenticated', 'public.employee_absences', 'absence_type', 'UPDATE')
          and has_column_privilege('authenticated', 'public.employee_absences', 'start_date', 'UPDATE')
          and has_column_privilege('authenticated', 'public.employee_absences', 'end_date', 'UPDATE')
          and not has_column_privilege('authenticated', 'public.employee_absences', 'employee_id', 'UPDATE')
         then 'OK' else 'FALLO' end);

  select count(*) into v_count
  from pg_class cl, aclexplode(coalesce(cl.relacl, acldefault('r', cl.relowner))) x
  where cl.oid in ('public.employee_schedules'::regclass, 'public.employee_day_overrides'::regclass, 'public.employee_absences'::regclass)
    and x.grantee = 0;
  r := r || format('configuración|Sin privilegios para PUBLIC en las tablas|%s', case when v_count = 0 then 'OK' else 'FALLO' end);

  select string_agg(tg.tgname, ', ' order by tg.tgname) into v_text
  from pg_trigger tg
  where not tg.tgisinternal and tg.tgenabled = 'O'
    and tg.tgrelid in ('public.employee_schedules'::regclass, 'public.employee_day_overrides'::regclass,
                       'public.employee_absences'::regclass, 'public.employees'::regclass);
  r := r || format('configuración|Triggers de updated_at y de reglas activos|%s',
    case when v_text = 'employee_absences_before_write, employee_absences_set_updated_at, employee_day_overrides_before_write, employee_day_overrides_set_updated_at, employee_schedules_before_write, employee_schedules_set_updated_at, employees_check_leave, employees_set_updated_at'
         then 'OK' else 'FALLO (' || coalesce(v_text, 'ninguno') || ')' end);

  select count(*),
         string_agg(p.oid::regprocedure::text, ', ') filter (
           where has_function_privilege('anon', p.oid, 'EXECUTE')
              or exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x where x.grantee = 0))
  into v_count, v_text
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where (n.nspname = 'private' and p.proname in ('shop_today', 'week_start', 'shift_time_minutes', 'is_valid_day_shifts',
           'shifts_spill_conflict', 'is_valid_week_shifts', 'week_day_shifts', 'is_nonexistent_local_time',
           'first_nonexistent_shift_time', 'resolve_day_shifts', 'planned_shifts', 'is_in_leave_period',
           'employee_schedules_before_write', 'employee_day_overrides_before_write', 'employee_absences_before_write',
           'employees_check_leave'))
     or (n.nspname = 'public' and p.proname in ('deactivate_employee', 'reactivate_employee'));
  r := r || format('configuración|Las 18 funciones nuevas existen y ni anon ni PUBLIC pueden ejecutarlas|%s',
    case when v_count = 18 and v_text is null then 'OK' else format('FALLO (%s funciones; ejecutables: %s)', v_count, coalesce(v_text, 'ninguna')) end);

  select count(*) into v_count
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('deactivate_employee', 'reactivate_employee')
    and not p.prosecdef
    and has_function_privilege('authenticated', p.oid, 'EXECUTE')
    and p.proconfig @> array['search_path=""'];
  r := r || format('configuración|Baja y reactivación: SECURITY INVOKER, search_path vacío, solo authenticated|%s',
    case when v_count = 2 then 'OK' else format('FALLO (%s de 2)', v_count) end);

  select count(*) into v_count
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private' and p.prosecdef
    and p.proname in ('resolve_day_shifts', 'planned_shifts', 'is_in_leave_period', 'employee_schedules_before_write',
                      'employee_day_overrides_before_write', 'employee_absences_before_write', 'employees_check_leave');
  r := r || format('configuración|Funciones internas que leen tablas: SECURITY INVOKER (respetan RLS)|%s', case when v_count = 0 then 'OK' else 'FALLO' end);

  select format('%s:%s', format_type(at.atttypid, at.atttypmod), case when at.attnotnull then 'not null' else 'null' end)
  into v_text from pg_attribute at
  where at.attrelid = 'public.employees'::regclass and at.attname = 'last_working_date' and not at.attisdropped;
  r := r || format('configuración|employees.last_working_date: fecha opcional|%s', case when v_text = 'date:null' then 'OK' else 'FALLO (' || coalesce(v_text, 'no existe') || ')' end);

  r := r || format('configuración|employees: permisos de authenticated sin cambios (sin DELETE)|%s',
    case when has_table_privilege('authenticated', 'public.employees', 'SELECT')
          and has_table_privilege('authenticated', 'public.employees', 'INSERT')
          and has_table_privilege('authenticated', 'public.employees', 'UPDATE')
          and not has_table_privilege('authenticated', 'public.employees', 'DELETE,TRUNCATE')
         then 'OK' else 'FALLO' end);

  select count(*) into v_count from public.employees where last_working_date is not null;
  r := r || format('configuración|Empleadas con fecha de baja|INFO: %s', v_count);
  r := r || format('configuración|Versiones / cambios de un día / ausencias registrados|INFO: %s', v_counts_before);

  -- ============================================ Pruebas con datos (se deshacen)
  begin
    -- Empleadas de prueba, creadas como postgres.
    insert into public.employees (id, first_name, last_name, is_active) values
      (v_a, 'Prueba A', '(employee_schedules_checks.sql)', true),
      (v_b, 'Prueba B', '(employee_schedules_checks.sql)', true),
      (v_c, 'Prueba C', '(employee_schedules_checks.sql)', true),
      (v_d, 'Prueba D', '(employee_schedules_checks.sql)', true),
      (v_e, 'Prueba E', '(employee_schedules_checks.sql)', true),
      (v_f, 'Prueba F', '(employee_schedules_checks.sql)', false),
      (v_g, 'Prueba G', '(employee_schedules_checks.sql)', true);
    insert into public.overtime_entries (employee_id, work_date, duration_minutes, reason) values
      (v_c, v_today - 1, 60, 'Prueba (employee_schedules_checks.sql)'),
      (v_c, v_today - 12, 30, 'Prueba (employee_schedules_checks.sql)');
    select md5(coalesce(string_agg(format('%s|%s|%s|%s', id, employee_id, work_date, duration_minutes), ';' order by id), ''))
    into v_overtime_before from public.overtime_entries;

    -- Pasos: [grupo, comprobación, SQL, esperado]. Esperado:
    --   ok          la sentencia funciona;
    --   rows:N      afecta a N filas;
    --   true        la consulta devuelve true;
    --   <SQLSTATE>  la sentencia falla con ese código (y se deshace).
    -- Los pasos ROLE cambian de sesión: anon, unauth, auth u owner (postgres).

    -- ===================================================== 2. Sin sesión (anon)
    s := s || array[['', '', 'anon', 'ROLE']];
    s := s || array[['anon', 'Leer horarios', 'select count(*) from public.employee_schedules', '42501']];
    s := s || array[['anon', 'Leer cambios de un día', 'select count(*) from public.employee_day_overrides', '42501']];
    s := s || array[['anon', 'Leer ausencias', 'select count(*) from public.employee_absences', '42501']];
    s := s || array[['anon', 'Crear una ausencia', format('insert into public.employee_absences (employee_id, absence_type, start_date, end_date) values (%s, %L, %L, %L)', a, 'vacation', v_next, v_next), '42501']];
    s := s || array[['anon', 'Dar de baja', format('select public.deactivate_employee(%s, %L)', c, v_today), '42501']];
    s := s || array[['anon', 'Reactivar', format('select public.reactivate_employee(%s, %L, true)', f, v_next), '42501']];
    s := s || array[['anon', 'Consultar turnos previstos (función interna)', format('select private.planned_shifts(%s, %L)', a, v_today), '42501']];

    -- Datos para las pruebas de lectura: un horario de E creado como postgres.
    s := s || array[['', '', 'owner', 'ROLE']];
    s := s || array[['preparación', 'Horario de prueba creado como postgres', format('insert into public.employee_schedules (employee_id, valid_from, week) values (%s, %L, %L)', e, v_today - 20, w1), 'ok']];

    -- ===================================== 3. Autenticada pero NO autorizada
    s := s || array[['', '', 'unauth', 'ROLE']];
    s := s || array[['no autorizada', 'No ve ningún horario', 'select count(*) = 0 from public.employee_schedules', 'true']];
    s := s || array[['no autorizada', 'No ve cambios ni ausencias', 'select (select count(*) from public.employee_day_overrides) + (select count(*) from public.employee_absences) = 0', 'true']];
    s := s || array[['no autorizada', 'Crear un horario', format('insert into public.employee_schedules (employee_id, valid_from, week) values (%s, %L, %L)', a, v_today, w1), '42501']];
    s := s || array[['no autorizada', 'Crear un cambio de un día', format('insert into public.employee_day_overrides (employee_id, work_date, shifts) values (%s, %L, %L)', a, v_next, '[]'), '42501']];
    s := s || array[['no autorizada', 'Crear una ausencia', format('insert into public.employee_absences (employee_id, absence_type, start_date, end_date) values (%s, %L, %L, %L)', a, 'leave', v_next, v_next), '42501']];
    s := s || array[['no autorizada', 'Modificar un horario (0 filas)', format('update public.employee_schedules set notes = %L', 'x'), 'rows:0']];
    s := s || array[['no autorizada', 'Borrar horarios (0 filas)', 'delete from public.employee_schedules', 'rows:0']];
    s := s || array[['no autorizada', 'Dar de baja', format('select public.deactivate_employee(%s, %L)', e, v_today), '42501']];
    s := s || array[['no autorizada', 'Reactivar', format('select public.reactivate_employee(%s, %L, true)', f, v_next), '42501']];

    -- =========================================================== 4. Versiones
    s := s || array[['', '', 'auth', 'ROLE']];
    s := s || array[['versiones', 'Ve los horarios', format('select count(*) = 1 from public.employee_schedules where employee_id = %s', e), 'true']];
    s := s || array[['versiones', 'La primera versión puede tener una fecha pasada (carga inicial)', format('insert into public.employee_schedules (employee_id, valid_from, week) values (%s, %L, %L)', a, v_today - 30, w1), 'ok']];
    s := s || array[['versiones', 'Una nueva versión antes del lunes de esta semana (PS002)', format('insert into public.employee_schedules (employee_id, valid_from, week) values (%s, %L, %L)', a, v_monday - 1, w1b), 'PS002']];
    s := s || array[['versiones', 'Una versión anterior a la última (PS001)', format('insert into public.employee_schedules (employee_id, valid_from, week) values (%s, %L, %L)', a, v_today - 40, w1b), 'PS001']];
    s := s || array[['versiones', 'Nueva versión desde el lunes que viene', format('insert into public.employee_schedules (employee_id, valid_from, week) values (%s, %L, %L)', a, v_next, w1b), 'ok']];
    s := s || array[['versiones', 'Otra versión el mismo día (no hay dos versiones vigentes)', format('insert into public.employee_schedules (employee_id, valid_from, week) values (%s, %L, %L)', a, v_next, w1), 'PS001']];
    s := s || array[['versiones', 'Editar la versión vigente (0 filas)', format('update public.employee_schedules set week = %L where employee_id = %s and valid_from = %L', w1b, a, v_today - 30), 'rows:0']];
    s := s || array[['versiones', 'Borrar la versión vigente (0 filas)', format('delete from public.employee_schedules where employee_id = %s and valid_from = %L', a, v_today - 30), 'rows:0']];
    s := s || array[['versiones', 'Editar una versión futura', format('update public.employee_schedules set notes = %L where employee_id = %s and valid_from = %L', 'Nota', a, v_next), 'rows:1']];
    s := s || array[['versiones', 'Cambiar la fecha de una versión', format('update public.employee_schedules set valid_from = %L where employee_id = %s and valid_from = %L', v_next + 7, a, v_next), '42501']];
    s := s || array[['versiones', 'Cambiar el tipo de una versión', format('update public.employee_schedules set kind = %L where employee_id = %s and valid_from = %L', 'end', a, v_next), '42501']];
    s := s || array[['versiones', 'Borrar una versión futura', format('delete from public.employee_schedules where employee_id = %s and valid_from = %L', a, v_next), 'rows:1']];
    s := s || array[['versiones', 'Volver a crearla', format('insert into public.employee_schedules (employee_id, valid_from, week) values (%s, %L, %L)', a, v_next, w1b), 'ok']];
    s := s || array[['versiones', 'La versión vigente hoy es la anterior; la nueva rige desde su fecha',
      format('select private.planned_shifts(%s, %L) = private.week_day_shifts(%L::jsonb, %L) and private.planned_shifts(%s, %L) = %L::jsonb',
        a, v_monday + 2, w1, v_monday + 2, a, v_next, '[{"start":"08:00","end":"15:00"}]'), 'true']];
    s := s || array[['versiones', 'Cerrar sin tener horario (PS010)', format('insert into public.employee_schedules (employee_id, valid_from, kind) values (%s, %L, %L)', b, v_next, 'end'), 'PS010']];

    -- Formato de la semana (B todavía no tiene horario: cualquier fecha vale).
    s := s || array[['formato', 'Día 8', format('insert into public.employee_schedules (employee_id, valid_from, week) values (%s, %L, %L)', b, v_today - 10, '{"8":[]}'), '23514']];
    s := s || array[['formato', 'Hora 24:00', format('insert into public.employee_schedules (employee_id, valid_from, week) values (%s, %L, %L)', b, v_today - 10, '{"1":[{"start":"20:00","end":"24:00"}]}'), '23514']];
    s := s || array[['formato', 'Hora sin cero inicial (7:00)', format('insert into public.employee_schedules (employee_id, valid_from, week) values (%s, %L, %L)', b, v_today - 10, '{"1":[{"start":"7:00","end":"14:00"}]}'), '23514']];
    s := s || array[['formato', 'Inicio igual al fin', format('insert into public.employee_schedules (employee_id, valid_from, week) values (%s, %L, %L)', b, v_today - 10, '{"1":[{"start":"07:00","end":"07:00"}]}'), '23514']];
    s := s || array[['formato', 'Cuatro turnos en un día', format('insert into public.employee_schedules (employee_id, valid_from, week) values (%s, %L, %L)', b, v_today - 10, '{"1":[{"start":"06:00","end":"07:00"},{"start":"08:00","end":"09:00"},{"start":"10:00","end":"11:00"},{"start":"12:00","end":"13:00"}]}'), '23514']];
    s := s || array[['formato', 'Turnos solapados el mismo día', format('insert into public.employee_schedules (employee_id, valid_from, week) values (%s, %L, %L)', b, v_today - 10, '{"1":[{"start":"07:00","end":"14:00"},{"start":"13:30","end":"20:00"}]}'), '23514']];
    s := s || array[['formato', 'Turno nocturno solapado con otro del mismo día', format('insert into public.employee_schedules (employee_id, valid_from, week) values (%s, %L, %L)', b, v_today - 10, '{"1":[{"start":"20:00","end":"02:00"},{"start":"21:00","end":"22:00"}]}'), '23514']];
    s := s || array[['formato', 'Nocturno del lunes que pisa el martes', format('insert into public.employee_schedules (employee_id, valid_from, week) values (%s, %L, %L)', b, v_today - 10, '{"1":[{"start":"22:00","end":"06:00"}],"2":[{"start":"05:30","end":"12:00"}]}'), '23514']];
    s := s || array[['formato', 'Nocturno del domingo que pisa el lunes (la semana se repite)', format('insert into public.employee_schedules (employee_id, valid_from, week) values (%s, %L, %L)', b, v_today - 10, '{"7":[{"start":"23:00","end":"07:30"}],"1":[{"start":"07:00","end":"14:00"}]}'), '23514']];
    s := s || array[['formato', 'Campo extra en un turno', format('insert into public.employee_schedules (employee_id, valid_from, week) values (%s, %L, %L)', b, v_today - 10, '{"1":[{"start":"07:00","end":"14:00","x":1}]}'), '23514']];
    s := s || array[['formato', 'Semana como lista', format('insert into public.employee_schedules (employee_id, valid_from, week) values (%s, %L, %L)', b, v_today - 10, '[]'), '23514']];
    s := s || array[['formato', 'Horario sin semana', format('insert into public.employee_schedules (employee_id, valid_from) values (%s, %L)', b, v_today - 10), '23514']];
    s := s || array[['formato', 'Cierre con semana', format('insert into public.employee_schedules (employee_id, valid_from, kind, week) values (%s, %L, %L, %L)', e, v_next, 'end', w1), '23514']];
    s := s || array[['formato', 'Tipo desconocido', format('insert into public.employee_schedules (employee_id, valid_from, kind, week) values (%s, %L, %L, %L)', b, v_today - 10, 'weekly', w1), '23514']];
    s := s || array[['formato', 'Nocturno que acaba justo cuando empieza el siguiente (06:00 y 06:00)', format('select private.is_valid_week_shifts(%L)', '{"1":[{"start":"22:00","end":"06:00"}],"2":[{"start":"06:00","end":"12:00"}]}'), 'true']];
    s := s || array[['formato', 'Semana vacía (descanso toda la semana) válida', format('select private.is_valid_week_shifts(%L)', '{}'), 'true']];
    s := s || array[['formato', 'Horario de B con el miércoles de noche', format('insert into public.employee_schedules (employee_id, valid_from, week) values (%s, %L, %L)', b, v_today - 10, wb), 'ok']];

    -- Límite entre versiones: D trabaja el domingo de 22:00 a 06:00.
    s := s || array[['límite entre versiones', 'Primera versión de D (domingo de noche)', format('insert into public.employee_schedules (employee_id, valid_from, week) values (%s, %L, %L)', d, v_today - 30, wd), 'ok']];
    s := s || array[['límite entre versiones', 'Nueva versión cuyo lunes empieza a las 05:00 (PS003)', format('insert into public.employee_schedules (employee_id, valid_from, week) values (%s, %L, %L)', d, v_next, '{"1":[{"start":"05:00","end":"12:00"}]}'), 'PS003']];
    s := s || array[['límite entre versiones', 'Nueva versión cuyo lunes empieza a las 06:00', format('insert into public.employee_schedules (employee_id, valid_from, week) values (%s, %L, %L)', d, v_next, '{"1":[{"start":"06:00","end":"12:00"}]}'), 'ok']];
    s := s || array[['límite entre versiones', 'Otra versión una semana después (lunes 06:00)', format('insert into public.employee_schedules (employee_id, valid_from, week) values (%s, %L, %L)', d, v_next + 7, '{"1":[{"start":"06:00","end":"12:00"}]}'), 'ok']];
    s := s || array[['límite entre versiones', 'Editar la versión intermedia: su último domingo, hasta las 07:00, pisa la siguiente (PS003)', format('update public.employee_schedules set week = %L where employee_id = %s and valid_from = %L', '{"7":[{"start":"22:00","end":"07:00"}]}', d, v_next), 'PS003']];
    s := s || array[['límite entre versiones', 'Borrar la versión de la semana siguiente', format('delete from public.employee_schedules where employee_id = %s and valid_from = %L', d, v_next + 7), 'rows:1']];

    -- ================================================== 5. Cambios de un día (B)
    s := s || array[['', '', 'snapshot', 'SNAPSHOT']];
    s := s || array[['cambios de un día', 'Marcar el lunes que viene como libre', format('insert into public.employee_day_overrides (employee_id, work_date, shifts) values (%s, %L, %L)', b, v_next, '[]'), 'ok']];
    s := s || array[['cambios de un día', 'El día libre sustituye al horario habitual', format('select private.planned_shifts(%s, %L) = %L::jsonb', b, v_next, '[]'), 'true']];
    s := s || array[['cambios de un día', 'Cambiar sus turnos', format('update public.employee_day_overrides set shifts = %L where employee_id = %s and work_date = %L', '[{"start":"10:00","end":"14:00"}]', b, v_next), 'rows:1']];
    s := s || array[['cambios de un día', 'Otro cambio el mismo día', format('insert into public.employee_day_overrides (employee_id, work_date, shifts) values (%s, %L, %L)', b, v_next, '[]'), '23505']];
    s := s || array[['cambios de un día', 'Cambiar la fecha de un cambio', format('update public.employee_day_overrides set work_date = %L where employee_id = %s', v_next + 1, b), '42501']];
    s := s || array[['cambios de un día', 'Cambiar la empleada de un cambio', format('update public.employee_day_overrides set employee_id = %s where employee_id = %s', a, b), '42501']];
    s := s || array[['cambios de un día', 'Turnos solapados el mismo día', format('insert into public.employee_day_overrides (employee_id, work_date, shifts) values (%s, %L, %L)', b, v_next + 1, '[{"start":"07:00","end":"14:00"},{"start":"13:00","end":"15:00"}]'), '23514']];
    s := s || array[['cambios de un día', 'Jueves desde las 05:00, tras el miércoles de noche hasta las 06:00 (PS003)', format('insert into public.employee_day_overrides (employee_id, work_date, shifts) values (%s, %L, %L)', b, v_next + 3, '[{"start":"05:00","end":"10:00"}]'), 'PS003']];
    s := s || array[['cambios de un día', 'Jueves desde las 06:00', format('insert into public.employee_day_overrides (employee_id, work_date, shifts) values (%s, %L, %L)', b, v_next + 3, '[{"start":"06:00","end":"10:00"}]'), 'ok']];
    s := s || array[['cambios de un día', 'Miércoles de 22:00 a 08:00, que pisa el jueves (PS003)', format('insert into public.employee_day_overrides (employee_id, work_date, shifts) values (%s, %L, %L)', b, v_next + 2, '[{"start":"22:00","end":"08:00"}]'), 'PS003']];
    s := s || array[['cambios de un día', 'Miércoles libre', format('insert into public.employee_day_overrides (employee_id, work_date, shifts) values (%s, %L, %L)', b, v_next + 2, '[]'), 'ok']];
    s := s || array[['cambios de un día', 'Con el miércoles libre, el jueves puede empezar a las 05:00', format('update public.employee_day_overrides set shifts = %L where employee_id = %s and work_date = %L', '[{"start":"05:00","end":"10:00"}]', b, v_next + 3), 'rows:1']];
    s := s || array[['cambios de un día', 'Volver al horario habitual (borrar el cambio del jueves)', format('delete from public.employee_day_overrides where employee_id = %s and work_date = %L', b, v_next + 3), 'rows:1']];
    s := s || array[['cambios de un día', 'El jueves vuelve a tener su turno habitual', format('select private.planned_shifts(%s, %L) = %L::jsonb', b, v_next + 3, '[{"start":"07:00","end":"14:00"}]'), 'true']];
    s := s || array[['cambios de un día', 'Borrar el cambio del miércoles', format('delete from public.employee_day_overrides where employee_id = %s and work_date = %L', b, v_next + 2), 'rows:1']];
    s := s || array[['cambio de hora', format('Hora que no existe: %s a las 02:30 (PS004)', to_char(v_dst_spring, 'DD/MM/YYYY')), format('insert into public.employee_day_overrides (employee_id, work_date, shifts) values (%s, %L, %L)', b, v_dst_spring, '[{"start":"02:30","end":"06:00"}]'), 'PS004']];
    s := s || array[['cambio de hora', 'Turno nocturno que acaba a una hora que no existe (PS004)', format('insert into public.employee_day_overrides (employee_id, work_date, shifts) values (%s, %L, %L)', b, v_dst_spring - 1, '[{"start":"22:00","end":"02:15"}]'), 'PS004']];
    s := s || array[['cambio de hora', 'El mismo día desde las 03:00 sí se acepta', format('insert into public.employee_day_overrides (employee_id, work_date, shifts) values (%s, %L, %L)', b, v_dst_spring, '[{"start":"03:00","end":"06:00"}]'), 'ok']];
    s := s || array[['cambio de hora', format('Hora repetida: %s a las 02:30 se acepta', to_char(v_dst_autumn, 'DD/MM/YYYY')), format('insert into public.employee_day_overrides (employee_id, work_date, shifts) values (%s, %L, %L)', b, v_dst_autumn, '[{"start":"02:30","end":"06:00"}]'), 'ok']];
    s := s || array[['cambio de hora', 'Borrar los cambios de prueba', format('delete from public.employee_day_overrides where employee_id = %s and work_date in (%L, %L)', b, v_dst_spring, v_dst_autumn), 'rows:2']];
    s := s || array[['', '', 'snapshot', 'COMPARE']];

    -- ========================================================= 6. Ausencias (A)
    s := s || array[['ausencias', 'Vacaciones de lunes a viernes', format('insert into public.employee_absences (employee_id, absence_type, start_date, end_date) values (%s, %L, %L, %L)', a, 'vacation', v_next, v_next + 4), 'ok']];
    s := s || array[['ausencias', 'La ausencia deja el día sin turnos', format('select private.planned_shifts(%s, %L) = %L::jsonb', a, v_next, '[]'), 'true']];
    s := s || array[['ausencias', 'Permiso que se solapa un día (PS005)', format('insert into public.employee_absences (employee_id, absence_type, start_date, end_date) values (%s, %L, %L, %L)', a, 'leave', v_next + 4, v_next + 6), 'PS005']];
    s := s || array[['ausencias', 'Permiso que empieza el día siguiente', format('insert into public.employee_absences (employee_id, absence_type, start_date, end_date) values (%s, %L, %L, %L)', a, 'leave', v_next + 5, v_next + 6), 'ok']];
    s := s || array[['ausencias', 'Alargar las vacaciones hasta pisar el permiso (PS005)', format('update public.employee_absences set end_date = %L where employee_id = %s and absence_type = %L', v_next + 5, a, 'vacation'), 'PS005']];
    s := s || array[['ausencias', 'Otra empleada, mismas fechas', format('insert into public.employee_absences (employee_id, absence_type, start_date, end_date) values (%s, %L, %L, %L)', b, 'other', v_next, v_next + 4), 'ok']];
    s := s || array[['ausencias', 'Fin anterior al inicio', format('insert into public.employee_absences (employee_id, absence_type, start_date, end_date) values (%s, %L, %L, %L)', a, 'other', v_next + 20, v_next + 19), '23514']];
    s := s || array[['ausencias', 'Tipo no permitido (sick)', format('insert into public.employee_absences (employee_id, absence_type, start_date, end_date) values (%s, %L, %L, %L)', a, 'sick', v_next + 20, v_next + 20), '23514']];
    s := s || array[['ausencias', 'Cambiar la empleada de una ausencia', format('update public.employee_absences set employee_id = %s where employee_id = %s', c, a), '42501']];
    s := s || array[['ausencias', 'Borrar el permiso', format('delete from public.employee_absences where employee_id = %s and absence_type = %L', a, 'leave'), 'rows:1']];

    -- ========================================== 7. Baja desde la base de datos
    s := s || array[['baja directa', 'Desactivar sin fecha a una empleada con horario (PS009)', format('update public.employees set is_active = false where id = %s', b), 'PS009']];
    s := s || array[['baja directa', 'Poner la fecha de baja a mano sin cerrar el horario (PS009)', format('update public.employees set is_active = false, last_working_date = %L where id = %s', v_today, b), 'PS009']];
    s := s || array[['baja directa', 'Desactivar sin fecha a una empleada sin horarios (como hasta ahora)', format('update public.employees set is_active = false where id = %s', g), 'rows:1']];
    s := s || array[['baja directa', 'Y volver a activarla (como hasta ahora)', format('update public.employees set is_active = true where id = %s', g), 'rows:1']];
    s := s || array[['baja directa', 'Fecha de baja con la empleada activa', format('update public.employees set last_working_date = %L where id = %s', v_today - 1, g), '23514']];
    s := s || array[['baja directa', 'Fecha de baja posterior a hoy (PS007)', format('update public.employees set is_active = false, last_working_date = %L where id = %s', v_today + 1, g), 'PS007']];

    -- ======================================================== 8. Baja (C)
    s := s || array[['baja', 'Preparación: horario, cambios, ausencias y una versión futura', format(
      'insert into public.employee_schedules (employee_id, valid_from, week) values (%1$s, %2$L, %4$L), (%1$s, %3$L, %4$L)',
      c, v_today - 60, v_next + 7, w1), 'ok']];
    s := s || array[['baja', 'Preparación: cambio pasado y cambio futuro', format(
      'insert into public.employee_day_overrides (employee_id, work_date, shifts) values (%1$s, %2$L, %4$L), (%1$s, %3$L, %4$L)',
      c, v_today - 3, v_today + 5, '[]'), 'ok']];
    s := s || array[['baja', 'Preparación: vacaciones en curso y un permiso futuro', format(
      'insert into public.employee_absences (employee_id, absence_type, start_date, end_date) values (%1$s, %2$L, %3$L, %4$L), (%1$s, %5$L, %6$L, %7$L)',
      c, 'vacation', v_today - 2, v_today + 10, 'leave', v_today + 20, v_today + 22), 'ok']];
    s := s || array[['', '', 'c-history', 'C_HISTORY']];
    s := s || array[['baja', 'Último día posterior a hoy (PS007)', format('select public.deactivate_employee(%s, %L)', c, v_today + 1), 'PS007']];
    s := s || array[['baja', 'Último día anterior a un horario ya empezado (PS007)', format('select public.deactivate_employee(%s, %L)', a, v_today - 31), 'PS007']];
    s := s || array[['baja', 'Empleada que no existe', format('select public.deactivate_employee(%L, %L)', gen_random_uuid(), v_today), 'P0002']];
    s := s || array[['baja', 'Sin fecha', format('select public.deactivate_employee(%s, null)', c), '22004']];
    s := s || array[['baja', 'Baja con último día hace 10 días: borra solo lo futuro', format(
      'select r->>%L = %L and (r->>%L)::int = 1 and (r->>%L)::int = 1 and (r->>%L)::int = 1 and (r->>%L)::int = 1 and (r->>%L)::boolean from (select public.deactivate_employee(%s, %L) as r) x',
      'last_working_date', v_today - 10, 'deleted_schedules', 'deleted_day_changes', 'deleted_absences', 'shortened_absences', 'closed_schedule', c, v_today - 10), 'true']];
    s := s || array[['baja', 'Queda desactivada con su último día', format('select not is_active and last_working_date = %L from public.employees where id = %s', v_today - 10, c), 'true']];
    s := s || array[['baja', 'Horario cerrado desde el día siguiente al último día', format('select kind = %L from public.employee_schedules where employee_id = %s and valid_from = %L', 'end', c, v_today - 9), 'true']];
    s := s || array[['baja', '', 'c-history', 'C_HISTORY_COMPARE']];
    s := s || array[['baja', 'Se conserva el cambio pasado posterior al último día', format('select count(*) = 1 from public.employee_day_overrides where employee_id = %s and work_date = %L', c, v_today - 3), 'true']];
    s := s || array[['baja', 'Las vacaciones en curso acaban hoy', format('select count(*) = 1 from public.employee_absences where employee_id = %s and start_date = %L and end_date = %L', c, v_today - 2, v_today), 'true']];
    s := s || array[['baja', 'No queda planificación posterior a hoy', format(
      'select not exists (select 1 from public.employee_day_overrides where employee_id = %1$s and work_date > %2$L) and not exists (select 1 from public.employee_absences where employee_id = %1$s and end_date > %2$L) and not exists (select 1 from public.employee_schedules where employee_id = %1$s and valid_from > %2$L)',
      c, v_today), 'true']];
    s := s || array[['baja', 'El último día conserva su horario; después de la baja no hay turnos', format(
      'select private.planned_shifts(%1$s, %2$L) = private.week_day_shifts(%4$L::jsonb, %2$L) and private.planned_shifts(%1$s, %3$L) = %5$L::jsonb',
      c, v_today - 10, v_today - 3, w1, '[]'), 'true']];
    s := s || array[['baja', 'Dar de baja otra vez (PS008)', format('select public.deactivate_employee(%s, %L)', c, v_today), 'PS008']];
    s := s || array[['baja', 'Cambio de un día después de la baja (PS006)', format('insert into public.employee_day_overrides (employee_id, work_date, shifts) values (%s, %L, %L)', c, v_today + 1, '[]'), 'PS006']];
    s := s || array[['baja', 'Modificar su historial de cambios (PS006)', format('delete from public.employee_day_overrides where employee_id = %s', c), 'PS006']];
    s := s || array[['baja', 'Ausencia después de la baja (PS006)', format('insert into public.employee_absences (employee_id, absence_type, start_date, end_date) values (%s, %L, %L, %L)', c, 'leave', v_next, v_next), 'PS006']];
    s := s || array[['baja', 'Nuevo horario sin reactivarla (PS006)', format('insert into public.employee_schedules (employee_id, valid_from, week) values (%s, %L, %L)', c, v_next, w1), 'PS006']];
    s := s || array[['baja', 'Activarla a mano sin quitar la fecha', format('update public.employees set is_active = true where id = %s', c), '23514']];
    s := s || array[['baja', 'Cambiar la fecha de baja a mano (PS008)', format('update public.employees set last_working_date = %L where id = %s', v_today - 5, c), 'PS008']];

    -- ===================================================== 9. Reactivación (C)
    s := s || array[['reactivación', 'Vuelta el último día de trabajo o antes (PS007)', format('select public.reactivate_employee(%s, %L, true)', c, v_today - 10), 'PS007']];
    s := s || array[['reactivación', 'Copiar el horario antes del lunes de esta semana (PS002)', format('select public.reactivate_employee(%s, %L, true)', c, v_monday - 1), 'PS002']];
    s := s || array[['reactivación', 'Si falla, sigue de baja (operación atómica)', format('select not is_active and last_working_date = %L from public.employees where id = %s', v_today - 10, c), 'true']];
    s := s || array[['reactivación', 'Vuelta el lunes que viene copiando el último horario', format(
      'select (r->>%L)::boolean and not (r->>%L)::boolean from (select public.reactivate_employee(%s, %L, true) as r) x',
      'copied_schedule', 'restored_previous_schedule', c, v_next), 'true']];
    s := s || array[['reactivación', 'Activa y sin fecha de baja', format('select is_active and last_working_date is null from public.employees where id = %s', c), 'true']];
    s := s || array[['reactivación', 'Nuevo horario desde la vuelta, igual al último', format('select kind = %L and week = %L::jsonb from public.employee_schedules where employee_id = %s and valid_from = %L', 'schedule', w1, c, v_next), 'true']];
    s := s || array[['reactivación', 'El periodo de baja sigue sin horario', format('select private.planned_shifts(%s, %L) = %L::jsonb and private.planned_shifts(%s, %L) = %L::jsonb', c, v_today - 3, '[]', c, v_today, '[]'), 'true']];
    s := s || array[['reactivación', '', 'c-history', 'C_HISTORY_COMPARE']];
    s := s || array[['reactivación', 'Reactivar a una empleada activa (PS008)', format('select public.reactivate_employee(%s, %L, true)', c, v_next + 7), 'PS008']];
    s := s || array[['reactivación', 'Desactivada antes del módulo (sin fecha ni horario): no hay horario que copiar', format(
      'select not (r->>%L)::boolean from (select public.reactivate_employee(%s, %L, true) as r) x',
      'copied_schedule', f, v_today), 'true']];
    s := s || array[['reactivación', 'Y queda activa', format('select is_active from public.employees where id = %s', f), 'true']];

    -- ===================================== 10. Deshacer una baja del mismo día (D)
    s := s || array[['deshacer baja', 'Baja con último día hoy (borra su versión futura)', format(
      'select (r->>%L)::int = 1 and (r->>%L)::boolean from (select public.deactivate_employee(%s, %L) as r) x',
      'deleted_schedules', 'closed_schedule', d, v_today), 'true']];
    s := s || array[['deshacer baja', 'Quitar el cierre del horario estando de baja (PS010)', format('delete from public.employee_schedules where employee_id = %s and kind = %L', d, 'end'), 'PS010']];
    s := s || array[['deshacer baja', 'Vuelta mañana: se quita el cierre y sigue su horario', format(
      'select (r->>%L)::boolean and not (r->>%L)::boolean from (select public.reactivate_employee(%s, %L, true) as r) x',
      'restored_previous_schedule', 'copied_schedule', d, v_today + 1), 'true']];
    s := s || array[['deshacer baja', 'Sin cierre y con su horario anterior vigente', format(
      'select not exists (select 1 from public.employee_schedules where employee_id = %1$s and kind = %2$L) and (select max(valid_from) from public.employee_schedules where employee_id = %1$s) = %3$L',
      d, 'end', v_today - 30), 'true']];

    s := s || array[['horas extra', 'La baja y la reactivación no tocan las horas extra', '__overtime__', 'true']];
    s := s || array[['', '', 'owner', 'ROLE']];

    -- --------------------------------------------------------------- Ejecución
    foreach t slice 1 in array s loop
      if t[4] = 'ROLE' then
        perform set_config('role', v_original_role, true);
        if t[3] = 'anon' then
          perform set_config('request.jwt.claims', '{"role":"anon"}', true);
          perform set_config('request.jwt.claim.sub', '', true);
          set local role anon;
        elsif t[3] in ('unauth', 'auth') then
          perform set_config('request.jwt.claims',
            json_build_object('sub', case t[3] when 'auth' then v_authorized else v_unauthorized end, 'role', 'authenticated')::text, true);
          perform set_config('request.jwt.claim.sub', (case t[3] when 'auth' then v_authorized else v_unauthorized end)::text, true);
          set local role authenticated;
        end if;
        continue;
      end if;

      -- Huellas de las versiones del horario (para comprobar que nada las toca).
      if t[4] in ('SNAPSHOT', 'COMPARE', 'C_HISTORY', 'C_HISTORY_COMPARE') then
        if t[4] in ('SNAPSHOT', 'COMPARE') then
          select md5(coalesce(string_agg(format('%s|%s|%s|%s|%s|%s', id, employee_id, valid_from, kind, week, updated_at), ';' order by id), ''))
          into v_text from public.employee_schedules;
        else
          select md5(coalesce(string_agg(format('%s|%s|%s|%s|%s', id, valid_from, kind, week, updated_at), ';' order by id), ''))
          into v_text from public.employee_schedules
          where employee_id = v_c and valid_from <= v_today and id in (select id from public.employee_schedules where employee_id = v_c and kind = 'schedule');
        end if;
        if t[4] = 'SNAPSHOT' then
          v_schedules_before := v_text;
        elsif t[4] = 'COMPARE' then
          r := r || format('cambios de un día|Los cambios de un día no modifican ninguna versión del horario|%s',
            case when v_text = v_schedules_before then 'OK' else 'FALLO' end);
        elsif t[4] = 'C_HISTORY' then
          v_c_history_before := v_text;
        else
          r := r || format('%s|Los horarios vigentes o pasados no cambian|%s',
            t[1],
            case when v_text = v_c_history_before then 'OK' else 'FALLO' end);
        end if;
        continue;
      end if;

      if t[3] = '__overtime__' then
        select md5(coalesce(string_agg(format('%s|%s|%s|%s', id, employee_id, work_date, duration_minutes), ';' order by id), ''))
        into v_text from public.overtime_entries;
        r := r || format('%s|%s|%s', t[1], t[2], case when v_text = v_overtime_before then 'OK' else 'FALLO' end);
        continue;
      end if;

      begin
        if t[4] = 'true' then
          execute t[3] into v_bool;
          r := r || format('%s|%s|%s', t[1], t[2], case when v_bool then 'OK' else 'FALLO (' || coalesce(v_bool::text, 'null') || ')' end);
        elsif t[4] = 'ok' then
          execute t[3];
          r := r || format('%s|%s|OK', t[1], t[2]);
        elsif t[4] like 'rows:%' then
          execute t[3];
          get diagnostics v_count = row_count;
          r := r || format('%s|%s|%s', t[1], t[2],
            case when v_count = split_part(t[4], ':', 2)::int then format('OK (%s filas)', v_count) else format('FALLO (%s filas)', v_count) end);
        else
          execute t[3];
          raise exception 'NO_RECHAZADO';
        end if;
      exception
        when raise_exception then
          if sqlerrm = 'NO_RECHAZADO' then
            r := r || format('%s|%s|FALLO (aceptado; revertido)', t[1], t[2]);
          else
            r := r || format('%s|%s|FALLO (error %s: %s)', t[1], t[2], sqlstate, replace(sqlerrm, '|', '/'));
          end if;
        when others then
          v_state := sqlstate;
          r := r || format('%s|%s|%s', t[1], t[2],
            case when v_state = t[4] then format('OK (rechazado, %s)', v_state)
                 else format('FALLO (error %s: %s)', v_state, replace(sqlerrm, '|', '/')) end);
      end;
    end loop;

    perform set_config('role', v_original_role, true);
    raise exception 'Fin de las pruebas: se deshacen los datos de prueba' using errcode = 'PX999';
  exception
    when sqlstate 'PX999' then
      null;
  end;

  perform set_config('role', v_original_role, true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);

  select format('%s/%s/%s', (select count(*) from public.employee_schedules),
    (select count(*) from public.employee_day_overrides), (select count(*) from public.employee_absences))
  into v_text;
  select md5(coalesce(string_agg(format('%s|%s|%s|%s', id, first_name, is_active, last_working_date), ';' order by id), '')) = v_employees_before
  into v_bool from public.employees;
  r := r || format('limpieza|Empleadas, horarios, cambios y ausencias quedan como estaban|%s',
    case when v_text = v_counts_before and v_bool then 'OK' else 'FALLO' end);

  insert into pg_temp.staff_schedule_check_results (n, grupo, comprobacion, resultado)
  select i, split_part(r[i], '|', 1), split_part(r[i], '|', 2), split_part(r[i], '|', 3)
  from generate_subscripts(r, 1) as i;
end;
$$;

select n, grupo, comprobacion, resultado
from pg_temp.staff_schedule_check_results
order by n;
