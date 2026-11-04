-- =============================================================================
-- Panet Admin · Carga de proveedores · hoja «Proveïdors Panet L'Ametlla»
-- (versión del 12/06/2026)
-- =============================================================================
--
-- ⚠️  BORRA DATOS. Lee esto antes de ejecutarlo.
--
-- Qué hace, en una sola transacción (si algo falla, no cambia nada):
--   1. Borra TODOS los pedidos (`orders`), también los preparados y los
--      «no se pide» del historial.
--   2. Borra TODOS los productos habituales (`supplier_products`).
--   3. Borra TODOS los proveedores (`suppliers`).
--   4. Crea los 16 proveedores de la hoja (13 proveedores + 3 pedidos al
--      obrador) con sus días de entrega, antelación, frecuencia, modo de pedido,
--      hora límite y notas.
--   5. Muestra el resultado para revisarlo.
--
-- No toca: festivos (`holidays`), trabajadoras, horas extra ni la cuenta
-- autorizada (`profiles`). No cambia tablas, permisos ni políticas.
--
-- Lo borrado no se puede recuperar desde la app. Si quieres conservar una
-- copia, exporta antes las tablas `orders`, `supplier_products` y `suppliers`
-- desde el Table Editor (botón «Export» → CSV).
--
-- Requisitos: migraciones aplicadas hasta 20261104130000_supplier_schedule_rules.sql
-- (SUPABASE_SETUP.md, sección 12). El script lo comprueba y se detiene si falta.
--
-- Cómo ejecutarlo: SQL Editor de Supabase, con el selector «Role» en `postgres`.
-- Pega el archivo entero y ejecútalo una vez. El editor avisará de que contiene
-- DELETE: es lo esperado (puntos 1 a 3).
--
-- Antes de ejecutar, revisa la CONFIGURACIÓN de abajo: la fecha de referencia
-- de los proveedores quincenales.
--
-- Cómo se ha leído la hoja (X = día de entrega; casilla azul = día de pedido):
--   - Antelación = días entre el pedido y la entrega.
--   - Kimon: pedido el miércoles para el jueves (1 día) y el viernes para el
--     lunes (3 días) → antelación distinta según el día.
--   - Distriluago y Empaworld: «quinzenal, demanar per dilluns» en la columna
--     del jueves → entrega el lunes cada 2 semanas, pedido el jueves (4 días).
--   - As de Hielo («entrega 48 h») y Europastry: X de lunes a viernes sin día
--     de pedido → a demanda (se pide cualquier día). Europastry: 1 día de
--     antelación (SUPUESTO: la hoja no lo indica; revísalo en la app).
--   - Obrador: «fer-les sempre abans de dilluns a les 8:00» → se piden el
--     lunes, hora límite 8:00. Cartonatge tiene X el miércoles y el jueves.
--   - Todos los proveedores: «fer-les sempre abans de les 12:00 h» → hora
--     límite 12:00.
-- =============================================================================

begin;

do $$
declare
  -- ---------------------------------------------------------------- CONFIGURACIÓN
  -- Proveedores quincenales (Distriluago y Empaworld): un lunes en que SÍ
  -- entregan. Las entregas serán ese lunes y uno de cada dos a partir de él
  -- (y hacia atrás). Si no es el correcto, cámbialo aquí o después en la app
  -- (Pedidos → Proveedores → Editar → «Una fecha de entrega»).
  v_quincenal_distriluago date := '2026-11-09';
  v_quincenal_empaworld   date := '2026-11-09';
  -- ---------------------------------------------------------------------------
begin
  if not exists (
    select 1 from pg_attribute
    where attrelid = 'public.suppliers'::regclass and attname = 'order_mode' and not attisdropped
  ) then
    raise exception 'Falta la migración 20261104130000_supplier_schedule_rules.sql: aplícala antes (SUPABASE_SETUP.md, sección 12).';
  end if;
  if extract(isodow from v_quincenal_distriluago) <> 1 or extract(isodow from v_quincenal_empaworld) <> 1 then
    raise exception 'Las fechas de referencia de los quincenales deben ser lunes.';
  end if;

  -- 1-3. Borrado (en este orden por las claves foráneas).
  delete from public.orders;
  delete from public.supplier_products;
  delete from public.suppliers;

  -- 4. Proveedores de la hoja.
  --    delivery_weekdays: 1 = lunes … 7 = domingo.
  insert into public.suppliers
    (name, delivery_weekdays, order_lead_days, lead_days_overrides, delivery_every_weeks, delivery_anchor_date, order_mode, order_deadline, notes)
  values
    -- Comandes proveïdors (abans de les 12:00 h)
    ('Kimon',           '{1,4}',       1, '{"1": 3}', 1, null,                    'scheduled', '12:00', 'Taronges / verdura.'),
    ('Copral',          '{4}',         1, '{}',       1, null,                    'scheduled', '12:00', 'Tomàquet triturat, formatge ratllat, mantega.'),
    ('Serhs',           '{2}',         1, '{}',       1, null,                    'scheduled', '12:00', 'Varis / begudes.'),
    ('DDI Provea',      '{2}',         1, '{}',       1, null,                    'scheduled', '12:00', 'Aigua / cervesa.'),
    ('Grupo Cacaolat',  '{2}',         1, '{}',       1, null,                    'scheduled', '12:00', 'Llet, begudes vegetals, Cacaolat.'),
    ('Fusion',          '{3}',         2, '{}',       1, null,                    'scheduled', '12:00', 'Embutit. Fer comanda el dilluns per dimecres.'),
    ('First Coffee',    '{4}',         1, '{}',       1, null,                    'scheduled', '12:00', 'Cafè, xoco, tes, etc.'),
    ('Distriluago',     '{1}',         4, '{}',       2, v_quincenal_distriluago, 'scheduled', '12:00', 'Neteja. Quinzenal: demanar el dijous per dilluns.'),
    ('Empaworld',       '{1}',         4, '{}',       2, v_quincenal_empaworld,   'scheduled', '12:00', 'Empanadilles. Quinzenal: demanar el dijous per dilluns.'),
    ('Horchata Lider',  '{2,4,6}',     1, '{}',       1, null,                    'scheduled', '12:00', null),
    ('As de Hielo',     '{1,2,3,4,5}', 2, '{}',       1, null,                    'on_demand', '12:00', 'Entrega en 48 h. Es pot demanar qualsevol dia.'),
    ('Panamar',         '{2,4}',       1, '{}',       1, null,                    'scheduled', '12:00', 'Mínim 2 caixes.'),
    ('Europastry',      '{1,2,3,4,5}', 1, '{}',       1, null,                    'on_demand', '12:00', null),
    -- Comandes obrador (abans de dilluns a les 8:00 h)
    ('Obrador · Pastisseria', '{3}',   2, '{}',                 1, null, 'scheduled', '08:00', 'Comanda d''obrador: fer-la sempre abans de dilluns a les 8:00.'),
    ('Obrador · Cartonatge',  '{3,4}', 2, '{"4": 3}',           1, null, 'scheduled', '08:00', 'Comanda d''obrador: fer-la sempre abans de dilluns a les 8:00.'),
    ('Obrador · Xocolat',     '{5}',   4, '{}',                 1, null, 'scheduled', '08:00', 'Comanda d''obrador: fer-la sempre abans de dilluns a les 8:00.');
end $$;

commit;

-- 5. Resultado: un proveedor por fila, con el día en que se prepara cada entrega.
select
  s.name as proveedor,
  case s.order_mode when 'on_demand' then 'A demanda' else 'Días fijos' end as modo,
  case when s.order_mode = 'on_demand' then format('%s · llega %s día(s) después de pedir',
    (select string_agg((array['lun','mar','mié','jue','vie','sáb','dom'])[d], ', ' order by d) from unnest(s.delivery_weekdays) as d),
    s.order_lead_days)
  else (
    select string_agg(
      format('%s (pedido %s)',
        (array['lun','mar','mié','jue','vie','sáb','dom'])[d],
        (array['lun','mar','mié','jue','vie','sáb','dom'])[((d - 1 - coalesce((s.lead_days_overrides ->> d::text)::int, s.order_lead_days)) % 7 + 7) % 7 + 1]),
      ', ' order by d)
    from unnest(s.delivery_weekdays) as d
  ) end as entregas,
  case when s.delivery_every_weeks = 2 then format('Cada 2 semanas (ref. %s)', s.delivery_anchor_date) else 'Cada semana' end as frecuencia,
  to_char(s.order_deadline, 'HH24:MI') as hora_limite,
  s.notes as notas
from public.suppliers s
order by s.name;
