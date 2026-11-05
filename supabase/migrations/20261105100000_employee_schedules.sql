-- =============================================================================
-- Panet Admin · Migración 20261105100000 · Horarios del personal
-- =============================================================================
--
-- Qué hace (solo añade objetos: no borra ni modifica datos existentes y no
-- toca `overtime_entries`, `profiles`, `suppliers`, `orders`,
-- `supplier_products`, `holidays` ni `shop_settings`):
--   1. Funciones internas (esquema `private`): «hoy» en Europe/Madrid, lunes de
--      la semana, validación de turnos y horas que no existen por el cambio al
--      horario de verano.
--   2. Columna `employees.last_working_date`: último día trabajado (incluido)
--      de una empleada dada de baja. Las empleadas existentes quedan sin fecha.
--   3. Tabla `employee_schedules`: versiones del horario habitual. Cada versión
--      rige desde `valid_from` hasta el día antes de la siguiente, así que dos
--      versiones nunca se solapan. Una versión `end` significa «sin horario
--      desde esta fecha» (se crea al dar de baja). Solo se añaden versiones al
--      final; las vigentes o pasadas no se pueden modificar ni borrar.
--   4. Tabla `employee_day_overrides`: cambios de un día concreto (otros turnos
--      o día libre). Nunca modifican el horario habitual.
--   5. Tabla `employee_absences`: vacaciones, permisos y otras ausencias por
--      rango de fechas. Sin motivos médicos ni datos de salud.
--   6. Triggers que hacen cumplir las reglas que no caben en un CHECK:
--      solapamientos con el día anterior y el siguiente (turnos nocturnos),
--      ausencias solapadas, nada planificado después de una baja, etc.
--   7. Funciones `public.deactivate_employee` y `public.reactivate_employee`:
--      baja y reactivación con fecha, cada una en una sola operación atómica.
--      Se ejecutan con los permisos de quien las llama (RLS se sigue
--      aplicando). La baja solo elimina planificación FUTURA (fechas
--      posteriores a hoy); nunca toca horarios vigentes o pasados ni horas extra.
--   8. RLS: solo la cuenta autorizada (private.is_authorized()) puede leer y
--      escribir.
--
-- Errores de reglas de negocio: SQLSTATE propios PS001…PS010 (ver
-- DATA_MODEL.md, «Horarios del personal»), con un mensaje en castellano y la
-- fecha relevante en `detail` (AAAA-MM-DD) para que la app muestre su propio
-- texto.
--
-- Requisitos: migraciones 20261028095000_profiles_authorization.sql
-- (private.is_authorized(), private.set_updated_at()) y
-- 20261028125000_employees_overtime.sql (public.employees).
--
-- Cómo aplicarla: ver SUPABASE_SETUP.md, sección 14. Se ejecuta una sola vez y
-- de forma atómica (en el SQL Editor, entre `begin;` y `commit;`). Si algo
-- falla, la transacción se revierte entera y no cambia nada.
--
-- Comprobaciones: supabase/tests/employee_schedules_checks.sql.
-- =============================================================================


-- 1. Funciones internas ----------------------------------------------------------

-- Fecha de hoy en la tienda (Europe/Madrid), no en UTC.
create function private.shop_today()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'Europe/Madrid')::date
$$;

comment on function private.shop_today() is
  'Fecha de hoy en Europe/Madrid.';

-- Lunes de la semana (lunes-domingo) de una fecha.
create function private.week_start(p_date date)
returns date
language sql
immutable
set search_path = ''
as $$
  select p_date - (extract(isodow from p_date)::integer - 1)
$$;

comment on function private.week_start(date) is
  'Lunes de la semana (lunes-domingo) que contiene la fecha.';

-- Minutos desde las 00:00 de una hora «HH:MM» (de 00:00 a 23:59). null si el
-- valor no es una cadena con ese formato.
create function private.shift_time_minutes(p_value jsonb)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
    when jsonb_typeof(p_value) = 'string'
      and (p_value #>> '{}') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    then split_part(p_value #>> '{}', ':', 1)::integer * 60
       + split_part(p_value #>> '{}', ':', 2)::integer
  end
$$;

comment on function private.shift_time_minutes(jsonb) is
  'Minutos desde medianoche de una hora "HH:MM"; null si el formato no es válido.';

-- Turnos de UN día: [{"start":"07:00","end":"14:00"}, …].
--   - como mucho 3 turnos, cada uno con exactamente "start" y "end";
--   - inicio distinto de fin (si fin < inicio, el turno acaba al día
--     siguiente: 22:00-02:00);
--   - sin solapamientos entre los turnos del mismo día.
create function private.is_valid_day_shifts(p_shifts jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_shifts is null or jsonb_typeof(p_shifts) <> 'array' then false
    when jsonb_array_length(p_shifts) > 3 then false
    when exists (
      select 1
      from jsonb_array_elements(p_shifts) as s (value)
      where case
        when jsonb_typeof(s.value) <> 'object' then true
        when (select count(*) from jsonb_object_keys(s.value)) <> 2 then true
        when private.shift_time_minutes(s.value -> 'start') is null then true
        when private.shift_time_minutes(s.value -> 'end') is null then true
        else private.shift_time_minutes(s.value -> 'start')
           = private.shift_time_minutes(s.value -> 'end')
      end
    ) then false
    else not exists (
      with raw as (
        select o.n,
               private.shift_time_minutes(o.value -> 'start') as start_min,
               private.shift_time_minutes(o.value -> 'end') as end_min
        from jsonb_array_elements(p_shifts) with ordinality as o (value, n)
      ),
      intervals as (
        select n, start_min,
               case when end_min <= start_min then end_min + 1440 else end_min end as end_min
        from raw
      )
      select 1
      from intervals a
      join intervals b on a.n < b.n
      where a.start_min < b.end_min and b.start_min < a.end_min
    )
  end
$$;

comment on function private.is_valid_day_shifts(jsonb) is
  'true si es una lista válida de turnos de un día (máx. 3, "HH:MM", inicio distinto de fin, sin solapamientos).';

-- true si algún turno nocturno de `p_prev` (que acaba al día siguiente) se
-- solapa con algún turno de `p_next` (los turnos del día siguiente). Acabar a
-- las 06:00 y empezar a las 06:00 no es solapamiento. Supone listas válidas.
create function private.shifts_spill_conflict(p_prev jsonb, p_next jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    (
      select max(private.shift_time_minutes(p.value -> 'end'))
      from jsonb_array_elements(coalesce(p_prev, '[]'::jsonb)) as p (value)
      where private.shift_time_minutes(p.value -> 'end')
         <= private.shift_time_minutes(p.value -> 'start')
    ) > (
      select min(private.shift_time_minutes(n.value -> 'start'))
      from jsonb_array_elements(coalesce(p_next, '[]'::jsonb)) as n (value)
    ),
    false
  )
$$;

comment on function private.shifts_spill_conflict(jsonb, jsonb) is
  'true si un turno nocturno del primer día se solapa con un turno del día siguiente.';

-- Semana del horario habitual: {"1": [turnos], …, "7": [turnos]} (ISO: 1 =
-- lunes). Un día que falta o con [] es descanso. Además de validar cada día,
-- comprueba que ningún turno nocturno pise el día siguiente, incluido el
-- domingo con el lunes (la semana se repite).
create function private.is_valid_week_shifts(p_week jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_week is null or jsonb_typeof(p_week) <> 'object' then false
    when exists (
      select 1
      from jsonb_each(p_week) as d (key, value)
      where d.key !~ '^[1-7]$' or not private.is_valid_day_shifts(d.value)
    ) then false
    else not exists (
      select 1
      from generate_series(1, 7) as g (day)
      where private.shifts_spill_conflict(
        coalesce(p_week -> g.day::text, '[]'::jsonb),
        coalesce(p_week -> (g.day % 7 + 1)::text, '[]'::jsonb)
      )
    )
  end
$$;

comment on function private.is_valid_week_shifts(jsonb) is
  'true si es una semana válida {"1".."7": turnos}, sin solapes entre días consecutivos (domingo-lunes incluido).';

-- Turnos de una semana para el día de la semana de una fecha.
create function private.week_day_shifts(p_week jsonb, p_date date)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_week -> extract(isodow from p_date)::integer::text, '[]'::jsonb)
$$;

-- true si la hora local (fecha + minutos) no existe en Europe/Madrid porque
-- ese día se adelanta el reloj (último domingo de marzo, de 02:00 a 02:59).
-- Las horas que se repiten (último domingo de octubre) sí existen.
create function private.is_nonexistent_local_time(p_date date, p_minutes integer)
returns boolean
language sql
stable
set search_path = ''
as $$
  select ((p_date + make_interval(mins => p_minutes)) at time zone 'Europe/Madrid')
           at time zone 'Europe/Madrid'
         <> p_date + make_interval(mins => p_minutes)
$$;

-- Primera hora de unos turnos que no existe ese día por el cambio al horario
-- de verano, como texto «AAAA-MM-DD HH:MM», o null si todas existen. El fin de
-- un turno nocturno se comprueba en el día siguiente.
create function private.first_nonexistent_shift_time(p_date date, p_shifts jsonb)
returns text
language sql
stable
set search_path = ''
as $$
  select min(to_char(t.day + make_interval(mins => t.minutes), 'YYYY-MM-DD HH24:MI'))
  from jsonb_array_elements(coalesce(p_shifts, '[]'::jsonb)) as s (value)
  cross join lateral (
    values
      (p_date, private.shift_time_minutes(s.value -> 'start')),
      (case
         when private.shift_time_minutes(s.value -> 'end')
           <= private.shift_time_minutes(s.value -> 'start')
         then p_date + 1
         else p_date
       end,
       private.shift_time_minutes(s.value -> 'end'))
  ) as t (day, minutes)
  where private.is_nonexistent_local_time(t.day, t.minutes)
$$;

revoke all on function private.shop_today() from public, anon;
revoke all on function private.week_start(date) from public, anon;
revoke all on function private.shift_time_minutes(jsonb) from public, anon;
revoke all on function private.is_valid_day_shifts(jsonb) from public, anon;
revoke all on function private.shifts_spill_conflict(jsonb, jsonb) from public, anon;
revoke all on function private.is_valid_week_shifts(jsonb) from public, anon;
revoke all on function private.week_day_shifts(jsonb, date) from public, anon;
revoke all on function private.is_nonexistent_local_time(date, integer) from public, anon;
revoke all on function private.first_nonexistent_shift_time(date, jsonb) from public, anon;
-- `authenticated` las necesita porque las usan las políticas, los CHECK y los
-- triggers, que se evalúan con los permisos de quien hace la petición.
grant execute on function private.shop_today() to authenticated;
grant execute on function private.week_start(date) to authenticated;
grant execute on function private.shift_time_minutes(jsonb) to authenticated;
grant execute on function private.is_valid_day_shifts(jsonb) to authenticated;
grant execute on function private.shifts_spill_conflict(jsonb, jsonb) to authenticated;
grant execute on function private.is_valid_week_shifts(jsonb) to authenticated;
grant execute on function private.week_day_shifts(jsonb, date) to authenticated;
grant execute on function private.is_nonexistent_local_time(date, integer) to authenticated;
grant execute on function private.first_nonexistent_shift_time(date, jsonb) to authenticated;


-- 2. Fecha de baja en `employees` --------------------------------------------------

alter table public.employees
  add column last_working_date date,
  -- Solo las empleadas desactivadas tienen fecha de baja. Las desactivadas
  -- antes de esta migración quedan sin fecha.
  add constraint employees_last_working_date_inactive
    check (last_working_date is null or is_active = false);

comment on column public.employees.last_working_date is
  'Último día trabajado (incluido) de una empleada dada de baja. Desde el día siguiente no aparece en la planificación. Lo fija public.deactivate_employee().';


-- 3. Versiones del horario habitual -------------------------------------------------

create table public.employee_schedules (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id) on delete restrict,
  -- Desde cuándo rige. Rige hasta el día antes de la versión siguiente.
  valid_from date not null,
  -- schedule = horario semanal; end = sin horario desde valid_from (baja).
  kind text not null default 'schedule',
  -- {"1": [{"start":"07:00","end":"14:00"}], …, "7": []}; null si kind = end.
  week jsonb,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Una sola versión por empleada y fecha: así no hay dos versiones vigentes
  -- a la vez.
  constraint employee_schedules_employee_valid_from_key unique (employee_id, valid_from),
  constraint employee_schedules_kind_valid check (kind in ('schedule', 'end')),
  constraint employee_schedules_week_valid check (
    case kind
      when 'schedule' then week is not null and private.is_valid_week_shifts(week)
      when 'end' then week is null
      else false
    end
  )
);

comment on table public.employee_schedules is
  'Versiones del horario habitual. Cada una rige desde valid_from hasta el día antes de la siguiente. Solo se añaden al final; las vigentes o pasadas no se modifican ni se borran.';
comment on column public.employee_schedules.kind is
  'schedule = horario semanal (week); end = sin horario desde valid_from (se crea al dar de baja).';
comment on column public.employee_schedules.week is
  'Turnos por día ISO (1 = lunes … 7 = domingo). Día ausente o [] = descanso. Un turno con fin anterior o igual al inicio acaba al día siguiente y cuenta entero en el día en que empieza.';

create trigger employee_schedules_set_updated_at
before update on public.employee_schedules
for each row
execute function private.set_updated_at();


-- 4. Cambios de un día ---------------------------------------------------------------

create table public.employee_day_overrides (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id) on delete restrict,
  work_date date not null,
  -- Turnos de ese día (sustituyen a los habituales). [] = día libre.
  shifts jsonb not null default '[]'::jsonb,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint employee_day_overrides_employee_work_date_key unique (employee_id, work_date),
  constraint employee_day_overrides_shifts_valid check (private.is_valid_day_shifts(shifts))
);

comment on table public.employee_day_overrides is
  'Cambios de un día concreto (otros turnos o día libre). No modifican el horario habitual: borrar el cambio devuelve el día al horario habitual.';
comment on column public.employee_day_overrides.shifts is
  'Turnos de ese día, como en employee_schedules.week. [] = día libre.';

create trigger employee_day_overrides_set_updated_at
before update on public.employee_day_overrides
for each row
execute function private.set_updated_at();


-- 5. Ausencias -------------------------------------------------------------------------

create table public.employee_absences (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id) on delete restrict,
  -- vacation = Vacaciones; leave = Permiso; other = Otro. Sin tipos médicos.
  absence_type text not null,
  start_date date not null,
  end_date date not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint employee_absences_type_valid check (absence_type in ('vacation', 'leave', 'other')),
  constraint employee_absences_dates_valid check (end_date >= start_date)
);

comment on table public.employee_absences is
  'Vacaciones, permisos y otras ausencias por rango de fechas (ambas incluidas). No guardar motivos médicos ni datos de salud.';
comment on column public.employee_absences.notes is
  'Observaciones opcionales. No escribir motivos médicos ni datos de salud.';

create index employee_absences_employee_id_start_date_idx
  on public.employee_absences (employee_id, start_date);

create trigger employee_absences_set_updated_at
before update on public.employee_absences
for each row
execute function private.set_updated_at();


-- 6. Turnos previstos de un día ----------------------------------------------------
-- La misma regla de prioridad que usa la app (DATA_MODEL.md):
--   1. después de last_working_date → nada;
--   2. versión vigente de tipo end → nada;
--   3. ausencia → nada;
--   4. cambio de ese día → sus turnos;
--   5. versión vigente → turnos de ese día de la semana;
--   6. sin versión → nada.
-- `resolve_day_shifts` permite calcularlo con una semana distinta de la
-- guardada (para validar una versión antes de guardarla).

create function private.resolve_day_shifts(
  p_employee_id uuid,
  p_date date,
  p_week jsonb,
  p_is_end boolean
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_last date;
  v_shifts jsonb;
begin
  select e.last_working_date into v_last
  from public.employees e
  where e.id = p_employee_id;

  if v_last is not null and p_date > v_last then
    return '[]'::jsonb;
  end if;
  if p_is_end then
    return '[]'::jsonb;
  end if;
  if exists (
    select 1 from public.employee_absences a
    where a.employee_id = p_employee_id
      and p_date between a.start_date and a.end_date
  ) then
    return '[]'::jsonb;
  end if;

  select o.shifts into v_shifts
  from public.employee_day_overrides o
  where o.employee_id = p_employee_id and o.work_date = p_date;
  if found then
    return v_shifts;
  end if;

  if p_week is null then
    return '[]'::jsonb;
  end if;
  return private.week_day_shifts(p_week, p_date);
end;
$$;

create function private.planned_shifts(p_employee_id uuid, p_date date)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_kind text;
  v_week jsonb;
begin
  select s.kind, s.week into v_kind, v_week
  from public.employee_schedules s
  where s.employee_id = p_employee_id and s.valid_from <= p_date
  order by s.valid_from desc
  limit 1;

  return private.resolve_day_shifts(p_employee_id, p_date, v_week, coalesce(v_kind = 'end', false));
end;
$$;

comment on function private.planned_shifts(uuid, date) is
  'Turnos previstos de una empleada en una fecha (baja > versión end > ausencia > cambio del día > horario habitual).';

-- true si la fecha cae en un periodo sin horario por baja (versión end
-- vigente o posterior a last_working_date).
create function private.is_in_leave_period(p_employee_id uuid, p_date date)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce((
      select e.last_working_date < p_date
      from public.employees e
      where e.id = p_employee_id
    ), false)
    or coalesce((
      select s.kind = 'end'
      from public.employee_schedules s
      where s.employee_id = p_employee_id and s.valid_from <= p_date
      order by s.valid_from desc
      limit 1
    ), false)
$$;

revoke all on function private.resolve_day_shifts(uuid, date, jsonb, boolean) from public, anon;
revoke all on function private.planned_shifts(uuid, date) from public, anon;
revoke all on function private.is_in_leave_period(uuid, date) from public, anon;
grant execute on function private.resolve_day_shifts(uuid, date, jsonb, boolean) to authenticated;
grant execute on function private.planned_shifts(uuid, date) to authenticated;
grant execute on function private.is_in_leave_period(uuid, date) to authenticated;


-- 7. Reglas de las versiones del horario habitual --------------------------------
-- Errores:
--   PS001 la versión no es posterior a la última registrada;
--   PS002 fecha anterior al lunes de la semana actual (salvo la primera versión);
--   PS003 un turno nocturno se solapa con el día siguiente;
--   PS006 la empleada está desactivada;
--   PS010 versión de fin no válida o que no se puede borrar.

create function private.employee_schedules_before_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_is_active boolean;
  v_latest date;
  v_latest_kind text;
  v_next date;
  v_min date;
begin
  -- Bloquea la fila de la empleada para que dos escrituras simultáneas no
  -- se salten las comprobaciones. Si no se ve (cuenta no autorizada), RLS
  -- rechazará la operación después.
  select e.is_active into v_is_active
  from public.employees e
  where e.id = coalesce(new.employee_id, old.employee_id)
  for update;
  if not found then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    if old.kind = 'end' and not v_is_active then
      raise exception using
        errcode = 'PS010',
        message = 'No se puede quitar el cierre del horario mientras la empleada esté de baja.';
    end if;
    return old;
  end if;

  -- Datos con formato no válido: los rechaza el CHECK de la tabla (23514).
  if not coalesce(case new.kind
    when 'schedule' then new.week is not null and private.is_valid_week_shifts(new.week)
    when 'end' then new.week is null
    else false
  end, false) then
    return new;
  end if;

  if tg_op = 'INSERT' then
    select s.valid_from, s.kind into v_latest, v_latest_kind
    from public.employee_schedules s
    where s.employee_id = new.employee_id
    order by s.valid_from desc
    limit 1;

    -- Solo se añaden versiones al final: el historial no se reescribe.
    if v_latest is not null and new.valid_from <= v_latest then
      raise exception using
        errcode = 'PS001',
        message = format('El nuevo horario debe empezar después del %s, fecha del último horario registrado.', to_char(v_latest, 'DD/MM/YYYY')),
        detail = v_latest::text;
    end if;

    if new.kind = 'end' then
      if v_latest is null then
        raise exception using errcode = 'PS010', message = 'La empleada no tiene ningún horario que cerrar.';
      end if;
      if v_latest_kind = 'end' then
        raise exception using errcode = 'PS010', message = 'El horario de la empleada ya está cerrado.';
      end if;
      return new;
    end if;

    if not v_is_active then
      raise exception using
        errcode = 'PS006',
        message = 'La empleada está desactivada. Reactívala antes de registrar un horario.';
    end if;

    -- La primera versión puede tener cualquier fecha (carga inicial); las
    -- siguientes, como pronto el lunes de la semana actual.
    v_min := private.week_start(private.shop_today());
    if v_latest is not null and new.valid_from < v_min then
      raise exception using
        errcode = 'PS002',
        message = format('El nuevo horario no puede empezar antes del lunes %s.', to_char(v_min, 'DD/MM/YYYY')),
        detail = v_min::text;
    end if;
  end if;

  -- INSERT o UPDATE de una versión con horario: el primer día no puede
  -- chocar con un turno nocturno del día anterior…
  if new.kind = 'schedule' then
    if private.shifts_spill_conflict(
      private.planned_shifts(new.employee_id, new.valid_from - 1),
      private.resolve_day_shifts(new.employee_id, new.valid_from, new.week, false)
    ) then
      raise exception using
        errcode = 'PS003',
        message = format('El primer día del horario (%s) se solapa con un turno nocturno del día anterior.', to_char(new.valid_from, 'DD/MM/YYYY')),
        detail = new.valid_from::text;
    end if;

    -- …y, al editar una versión futura que tiene otra detrás, su último día
    -- no puede chocar con el primero de la siguiente.
    if tg_op = 'UPDATE' then
      select min(s.valid_from) into v_next
      from public.employee_schedules s
      where s.employee_id = new.employee_id and s.valid_from > new.valid_from;
      if v_next is not null and private.shifts_spill_conflict(
        private.resolve_day_shifts(new.employee_id, v_next - 1, new.week, false),
        private.planned_shifts(new.employee_id, v_next)
      ) then
        raise exception using
          errcode = 'PS003',
          message = format('El último día de este horario se solapa con el horario que empieza el %s.', to_char(v_next, 'DD/MM/YYYY')),
          detail = v_next::text;
      end if;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.employee_schedules_before_write() from public, anon, authenticated;

create trigger employee_schedules_before_write
before insert or update or delete on public.employee_schedules
for each row
execute function private.employee_schedules_before_write();


-- 8. Reglas de los cambios de un día -------------------------------------------------
-- Errores:
--   PS003 solapamiento con un turno nocturno del día anterior o con el día
--         siguiente;
--   PS004 una hora que no existe ese día por el cambio al horario de verano;
--   PS006 la empleada está desactivada o ese día estaba de baja.

create function private.employee_day_overrides_before_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_is_active boolean;
  v_missing text;
begin
  select e.is_active into v_is_active
  from public.employees e
  where e.id = coalesce(new.employee_id, old.employee_id)
  for update;
  if not found then
    return coalesce(new, old);
  end if;

  -- La planificación de una empleada desactivada no se modifica.
  if not v_is_active then
    raise exception using
      errcode = 'PS006',
      message = 'La empleada está desactivada: su planificación no se puede modificar.';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  -- Turnos con formato no válido: los rechaza el CHECK de la tabla (23514).
  if not coalesce(private.is_valid_day_shifts(new.shifts), false) then
    return new;
  end if;

  if private.is_in_leave_period(new.employee_id, new.work_date) then
    raise exception using
      errcode = 'PS006',
      message = format('El %s la empleada no tenía horario por una baja anterior.', to_char(new.work_date, 'DD/MM/YYYY')),
      detail = new.work_date::text;
  end if;

  v_missing := private.first_nonexistent_shift_time(new.work_date, new.shifts);
  if v_missing is not null then
    raise exception using
      errcode = 'PS004',
      message = format('La hora %s no existe el %s por el cambio al horario de verano. Modifica el turno.',
        substr(v_missing, 12, 5), to_char(v_missing::date, 'DD/MM/YYYY')),
      detail = v_missing;
  end if;

  if private.shifts_spill_conflict(private.planned_shifts(new.employee_id, new.work_date - 1), new.shifts) then
    raise exception using
      errcode = 'PS003',
      message = format('Los turnos del %s se solapan con un turno nocturno del día anterior.', to_char(new.work_date, 'DD/MM/YYYY')),
      detail = (new.work_date - 1)::text;
  end if;

  if private.shifts_spill_conflict(new.shifts, private.planned_shifts(new.employee_id, new.work_date + 1)) then
    raise exception using
      errcode = 'PS003',
      message = format('El turno nocturno del %s se solapa con los turnos del día siguiente.', to_char(new.work_date, 'DD/MM/YYYY')),
      detail = (new.work_date + 1)::text;
  end if;

  return new;
end;
$$;

revoke all on function private.employee_day_overrides_before_write() from public, anon, authenticated;

create trigger employee_day_overrides_before_write
before insert or update or delete on public.employee_day_overrides
for each row
execute function private.employee_day_overrides_before_write();


-- 9. Reglas de las ausencias -------------------------------------------------------------
-- Errores:
--   PS005 se solapa con otra ausencia de la misma empleada;
--   PS006 la empleada está desactivada o las fechas caen en una baja anterior.

create function private.employee_absences_before_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_is_active boolean;
  v_other record;
begin
  select e.is_active into v_is_active
  from public.employees e
  where e.id = coalesce(new.employee_id, old.employee_id)
  for update;
  if not found then
    return coalesce(new, old);
  end if;

  if not v_is_active then
    raise exception using
      errcode = 'PS006',
      message = 'La empleada está desactivada: su planificación no se puede modificar.';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  -- Fechas incompletas o invertidas: las rechazan las restricciones (23502,
  -- 23514).
  if new.start_date is null or new.end_date is null or new.end_date < new.start_date then
    return new;
  end if;

  -- El bloqueo de la fila de la empleada (arriba) impide que dos ausencias
  -- solapadas se guarden a la vez.
  select a.start_date, a.end_date into v_other
  from public.employee_absences a
  where a.employee_id = new.employee_id
    and a.id <> new.id
    and a.start_date <= new.end_date
    and a.end_date >= new.start_date
  order by a.start_date
  limit 1;
  if found then
    raise exception using
      errcode = 'PS005',
      message = format('Se solapa con otra ausencia registrada del %s al %s.',
        to_char(v_other.start_date, 'DD/MM/YYYY'), to_char(v_other.end_date, 'DD/MM/YYYY')),
      detail = v_other.start_date::text || '/' || v_other.end_date::text;
  end if;

  -- No puede caer en un periodo sin horario por una baja anterior.
  if exists (
    select 1
    from (
      select s.valid_from,
             lead(s.valid_from) over (order by s.valid_from) as next_from,
             s.kind
      from public.employee_schedules s
      where s.employee_id = new.employee_id
    ) as v
    where v.kind = 'end'
      and v.valid_from <= new.end_date
      and (v.next_from is null or v.next_from > new.start_date)
  ) then
    raise exception using
      errcode = 'PS006',
      message = 'Las fechas coinciden con un periodo en que la empleada estaba de baja.';
  end if;

  return new;
end;
$$;

revoke all on function private.employee_absences_before_write() from public, anon, authenticated;

create trigger employee_absences_before_write
before insert or update or delete on public.employee_absences
for each row
execute function private.employee_absences_before_write();


-- 10. Coherencia de la baja en `employees` ----------------------------------------------
-- Protege las reglas aunque se modifique `employees` directamente, sin usar
-- public.deactivate_employee():
--   - con fecha de baja, no puede quedar planificación después de hoy ni un
--     horario vigente después de la baja (PS009);
--   - la fecha de baja no puede ser posterior a hoy (PS007);
--   - para cambiar la fecha hay que reactivar antes (PS008);
--   - una empleada con planificación no se puede desactivar sin fecha (PS009).
-- Las empleadas sin planificación se pueden seguir desactivando como antes.

create function private.employees_check_leave()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_today date := private.shop_today();
  v_kind text;
begin
  if new.last_working_date is not null
     and old.last_working_date is not null
     and new.last_working_date <> old.last_working_date then
    raise exception using
      errcode = 'PS008',
      message = 'Para cambiar la fecha de baja, reactiva antes a la empleada.';
  end if;

  if new.last_working_date is not null and old.last_working_date is null then
    if new.last_working_date > v_today then
      raise exception using
        errcode = 'PS007',
        message = 'El último día de trabajo no puede ser posterior a hoy.',
        detail = v_today::text;
    end if;

    select s.kind into v_kind
    from public.employee_schedules s
    where s.employee_id = new.id and s.valid_from <= new.last_working_date + 1
    order by s.valid_from desc
    limit 1;

    if v_kind = 'schedule'
       or exists (
         select 1 from public.employee_schedules s
         where s.employee_id = new.id
           and s.valid_from > new.last_working_date + 1
       )
       or exists (
         select 1 from public.employee_day_overrides o
         where o.employee_id = new.id and o.work_date > v_today
       )
       or exists (
         select 1 from public.employee_absences a
         where a.employee_id = new.id and a.end_date > v_today
       ) then
      raise exception using
        errcode = 'PS009',
        message = 'Para dar de baja a una empleada con horarios, usa la baja con fecha de la aplicación.';
    end if;
  end if;

  if not new.is_active and new.last_working_date is null and old.is_active and (
    exists (select 1 from public.employee_schedules s where s.employee_id = new.id)
    or exists (select 1 from public.employee_day_overrides o where o.employee_id = new.id)
    or exists (select 1 from public.employee_absences a where a.employee_id = new.id)
  ) then
    raise exception using
      errcode = 'PS009',
      message = 'Esta empleada tiene horarios: indica su último día de trabajo para darla de baja.';
  end if;

  return new;
end;
$$;

revoke all on function private.employees_check_leave() from public, anon, authenticated;

create trigger employees_check_leave
before update of is_active, last_working_date on public.employees
for each row
execute function private.employees_check_leave();


-- 11. Baja y reactivación ----------------------------------------------------------------
-- Funciones en `public` para que la app las llame (supabase.rpc). SECURITY
-- INVOKER: se ejecutan con los permisos de la cuenta que llama, así que RLS y
-- los triggers anteriores se siguen aplicando. Cada llamada es una sola
-- transacción: si algo falla, no cambia nada.

create function public.deactivate_employee(p_employee_id uuid, p_last_working_date date)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_today date := private.shop_today();
  v_is_active boolean;
  v_last date;
  v_blocking date;
  v_kind text;
  v_deleted_schedules integer;
  v_deleted_day_changes integer;
  v_deleted_absences integer;
  v_shortened_absences integer;
  v_closed boolean := false;
begin
  if not coalesce((select private.is_authorized()), false) then
    raise exception using errcode = '42501', message = 'Cuenta no autorizada.';
  end if;
  if p_employee_id is null or p_last_working_date is null then
    raise exception using errcode = '22004', message = 'Faltan la empleada o el último día de trabajo.';
  end if;

  select e.is_active, e.last_working_date into v_is_active, v_last
  from public.employees e
  where e.id = p_employee_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'No se encuentra la empleada.';
  end if;

  if v_last is not null then
    raise exception using
      errcode = 'PS008',
      message = format('La empleada ya está dada de baja (último día: %s).', to_char(v_last, 'DD/MM/YYYY')),
      detail = v_last::text;
  end if;
  if p_last_working_date > v_today then
    raise exception using
      errcode = 'PS007',
      message = 'El último día de trabajo no puede ser posterior a hoy.',
      detail = v_today::text;
  end if;

  -- Un horario que ya ha empezado después del último día no se borra
  -- (es historial): hay que elegir una fecha igual o posterior.
  select min(s.valid_from) into v_blocking
  from public.employee_schedules s
  where s.employee_id = p_employee_id
    and s.valid_from > p_last_working_date
    and s.valid_from <= v_today;
  if v_blocking is not null then
    raise exception using
      errcode = 'PS007',
      message = format('Hay un horario que empezó el %s, después del último día de trabajo. Elige una fecha igual o posterior al %s.',
        to_char(v_blocking, 'DD/MM/YYYY'), to_char(v_blocking, 'DD/MM/YYYY')),
      detail = v_blocking::text;
  end if;

  -- Solo planificación FUTURA (posterior a hoy). Los cambios y ausencias
  -- entre el último día y hoy se conservan; la app no los muestra porque caen
  -- después de la baja.
  delete from public.employee_schedules
  where employee_id = p_employee_id and valid_from > v_today;
  get diagnostics v_deleted_schedules = row_count;

  delete from public.employee_day_overrides
  where employee_id = p_employee_id and work_date > v_today;
  get diagnostics v_deleted_day_changes = row_count;

  delete from public.employee_absences
  where employee_id = p_employee_id and start_date > v_today;
  get diagnostics v_deleted_absences = row_count;

  update public.employee_absences
  set end_date = v_today
  where employee_id = p_employee_id and start_date <= v_today and end_date > v_today;
  get diagnostics v_shortened_absences = row_count;

  -- Cierra el horario desde el día siguiente al último día (si tenía uno).
  select s.kind into v_kind
  from public.employee_schedules s
  where s.employee_id = p_employee_id and s.valid_from <= p_last_working_date + 1
  order by s.valid_from desc
  limit 1;
  if v_kind = 'schedule' then
    insert into public.employee_schedules (employee_id, valid_from, kind, week, notes)
    values (p_employee_id, p_last_working_date + 1, 'end', null, 'Baja');
    v_closed := true;
  end if;

  update public.employees
  set is_active = false, last_working_date = p_last_working_date
  where id = p_employee_id;

  return jsonb_build_object(
    'last_working_date', p_last_working_date,
    'deleted_schedules', v_deleted_schedules,
    'deleted_day_changes', v_deleted_day_changes,
    'deleted_absences', v_deleted_absences,
    'shortened_absences', v_shortened_absences,
    'closed_schedule', v_closed
  );
end;
$$;

comment on function public.deactivate_employee(uuid, date) is
  'Da de baja a una empleada con su último día de trabajo (incluido): elimina solo su planificación posterior a hoy, recorta ausencias en curso, cierra su horario y la desactiva. No toca horarios vigentes o pasados ni horas extra.';

create function public.reactivate_employee(
  p_employee_id uuid,
  p_return_date date,
  p_copy_schedule boolean default true
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_today date := private.shop_today();
  v_is_active boolean;
  v_last date;
  v_has_current boolean;
  v_current_id uuid;
  v_current_kind text;
  v_current_from date;
  v_week jsonb;
  v_restored boolean := false;
  v_copied boolean := false;
begin
  if not coalesce((select private.is_authorized()), false) then
    raise exception using errcode = '42501', message = 'Cuenta no autorizada.';
  end if;
  if p_employee_id is null or p_return_date is null then
    raise exception using errcode = '22004', message = 'Faltan la empleada o la fecha de vuelta.';
  end if;

  select e.is_active, e.last_working_date into v_is_active, v_last
  from public.employees e
  where e.id = p_employee_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'No se encuentra la empleada.';
  end if;

  if v_is_active then
    raise exception using errcode = 'PS008', message = 'La empleada ya está activa.';
  end if;
  if v_last is not null and p_return_date <= v_last then
    raise exception using
      errcode = 'PS007',
      message = format('La fecha de vuelta debe ser posterior al último día de trabajo (%s).', to_char(v_last, 'DD/MM/YYYY')),
      detail = v_last::text;
  end if;

  update public.employees
  set is_active = true, last_working_date = null
  where id = p_employee_id;

  -- Versión vigente el día de la vuelta.
  select s.id, s.kind, s.valid_from into v_current_id, v_current_kind, v_current_from
  from public.employee_schedules s
  where s.employee_id = p_employee_id and s.valid_from <= p_return_date
  order by s.valid_from desc
  limit 1;
  v_has_current := found;

  if v_has_current and v_current_kind = 'end' and v_current_from = p_return_date
     and v_current_from > v_today then
    -- Vuelve justo el día en que se cerraba el horario y ese cierre todavía no
    -- ha empezado: se quita el cierre y sigue su horario anterior.
    delete from public.employee_schedules where id = v_current_id;
    v_restored := true;
  elsif p_copy_schedule and (not v_has_current or v_current_kind = 'end') then
    -- Copia el último horario semanal desde la fecha de vuelta. Los triggers
    -- comprueban la fecha mínima y los solapamientos.
    select s.week into v_week
    from public.employee_schedules s
    where s.employee_id = p_employee_id and s.kind = 'schedule'
    order by s.valid_from desc
    limit 1;
    if found then
      insert into public.employee_schedules (employee_id, valid_from, kind, week)
      values (p_employee_id, p_return_date, 'schedule', v_week);
      v_copied := true;
    end if;
  end if;

  return jsonb_build_object(
    'return_date', p_return_date,
    'restored_previous_schedule', v_restored,
    'copied_schedule', v_copied
  );
end;
$$;

comment on function public.reactivate_employee(uuid, date, boolean) is
  'Reactiva a una empleada con su fecha de vuelta y, opcionalmente, copia su último horario semanal desde esa fecha. El periodo de baja se conserva sin horario.';

-- Por defecto PostgreSQL concede EXECUTE a PUBLIC (y Supabase, a anon). Solo
-- `authenticated` puede llamarlas; además comprueban private.is_authorized().
revoke all on function public.deactivate_employee(uuid, date) from public, anon, authenticated;
revoke all on function public.reactivate_employee(uuid, date, boolean) from public, anon, authenticated;
grant execute on function public.deactivate_employee(uuid, date) to authenticated;
grant execute on function public.reactivate_employee(uuid, date, boolean) to authenticated;


-- 12. RLS y permisos -------------------------------------------------------------------
-- Supabase concede por defecto todos los privilegios de las tablas nuevas de
-- `public` a anon y authenticated (incluido TRUNCATE, que no respeta RLS). Se
-- retiran todos y se concede solo lo necesario. Las columnas que identifican
-- la fila (empleada, fechas de vigencia, día) no se pueden modificar.

alter table public.employee_schedules enable row level security;
alter table public.employee_day_overrides enable row level security;
alter table public.employee_absences enable row level security;

revoke all on table public.employee_schedules from anon, authenticated;
grant select, insert, delete on table public.employee_schedules to authenticated;
grant update (week, notes) on table public.employee_schedules to authenticated;

revoke all on table public.employee_day_overrides from anon, authenticated;
grant select, insert, delete on table public.employee_day_overrides to authenticated;
grant update (shifts, notes) on table public.employee_day_overrides to authenticated;

revoke all on table public.employee_absences from anon, authenticated;
grant select, insert, delete on table public.employee_absences to authenticated;
grant update (absence_type, start_date, end_date, notes) on table public.employee_absences to authenticated;

-- Versiones: se leen y se añaden; solo las futuras (después de hoy) se pueden
-- editar o borrar.
create policy "employee_schedules_select_authorized"
on public.employee_schedules
for select
to authenticated
using ((select private.is_authorized()));

create policy "employee_schedules_insert_authorized"
on public.employee_schedules
for insert
to authenticated
with check ((select private.is_authorized()));

create policy "employee_schedules_update_future"
on public.employee_schedules
for update
to authenticated
using ((select private.is_authorized()) and valid_from > (select private.shop_today()))
with check ((select private.is_authorized()) and valid_from > (select private.shop_today()));

create policy "employee_schedules_delete_future"
on public.employee_schedules
for delete
to authenticated
using ((select private.is_authorized()) and valid_from > (select private.shop_today()));

create policy "employee_day_overrides_select_authorized"
on public.employee_day_overrides
for select
to authenticated
using ((select private.is_authorized()));

create policy "employee_day_overrides_insert_authorized"
on public.employee_day_overrides
for insert
to authenticated
with check ((select private.is_authorized()));

create policy "employee_day_overrides_update_authorized"
on public.employee_day_overrides
for update
to authenticated
using ((select private.is_authorized()))
with check ((select private.is_authorized()));

create policy "employee_day_overrides_delete_authorized"
on public.employee_day_overrides
for delete
to authenticated
using ((select private.is_authorized()));

create policy "employee_absences_select_authorized"
on public.employee_absences
for select
to authenticated
using ((select private.is_authorized()));

create policy "employee_absences_insert_authorized"
on public.employee_absences
for insert
to authenticated
with check ((select private.is_authorized()));

create policy "employee_absences_update_authorized"
on public.employee_absences
for update
to authenticated
using ((select private.is_authorized()))
with check ((select private.is_authorized()));

create policy "employee_absences_delete_authorized"
on public.employee_absences
for delete
to authenticated
using ((select private.is_authorized()));
