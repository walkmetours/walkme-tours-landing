-- WalkMe Bikes · Migración 19-ago-2026: dos modalidades de garantía
-- Pegar completo en Supabase → SQL Editor → Run (idempotente, se puede
-- correr dos veces sin error).
--
-- Hasta hoy la garantía era un solo número, $3,000 MXN por bici
-- (`deposito_unitario`/`deposito_total`), y se usaba para dos cosas que en
-- realidad son distintas: el efectivo que el cliente deja en el mostrador y
-- el monto del hold de Stripe que se agregó ayer.
--
-- Decisión de María (19-ago-26): el cliente elige desde la reserva en línea.
--   · efectivo → $3,000 MXN por bici + se retiene una identificación oficial
--     vigente durante toda la renta (INE o licencia para nacionales,
--     pasaporte vigente para extranjeros) y se devuelve al entregar la bici.
--   · tarjeta  → $7,500 MXN por bici de retención en Stripe (hold, no cobro).
--     La identificación solo se muestra para cotejar el nombre; no se retiene.
--
-- El monto del hold vive en columnas PROPIAS y no toca `deposito_unitario`:
-- las reservas ya creadas conservan su garantía en efectivo intacta y la
-- columna generada `deposito_total` sigue significando exactamente lo mismo
-- que significaba. `deposito_tarjeta_total` es generada por el mismo motivo
-- que `deposito_total`: que la multiplicación viva en un solo lugar.

-- ============================================================
-- 1 · Modalidad elegida y monto de la retención en tarjeta
-- ============================================================
alter table public.reservas_bicis add column if not exists garantia_tipo text
  not null default 'efectivo';
alter table public.reservas_bicis
  drop constraint if exists reservas_bicis_garantia_tipo_chk;
alter table public.reservas_bicis
  add constraint reservas_bicis_garantia_tipo_chk
  check (garantia_tipo in ('efectivo','tarjeta'));

alter table public.reservas_bicis add column if not exists deposito_tarjeta_unitario
  numeric not null default 7500;

alter table public.reservas_bicis add column if not exists deposito_tarjeta_total numeric
  generated always as (deposito_tarjeta_unitario * cantidad_bicis) stored;

-- ============================================================
-- 2 · Identificación física retenida (solo modalidad efectivo)
--     No se guarda el número ni una foto: solo QUÉ documento se retuvo y
--     cuándo, para que el mostrador sepa qué tiene en el cajón y no se le
--     olvide devolverlo. La foto opcional del ID sigue viviendo en el
--     bucket privado (foto_id_path), sin cambios.
-- ============================================================
alter table public.reservas_bicis add column if not exists garantia_id_tipo text;
alter table public.reservas_bicis
  drop constraint if exists reservas_bicis_garantia_id_tipo_chk;
alter table public.reservas_bicis
  add constraint reservas_bicis_garantia_id_tipo_chk
  check (garantia_id_tipo is null or garantia_id_tipo in ('ine','licencia','pasaporte','otro'));

alter table public.reservas_bicis add column if not exists garantia_id_detalle text;
alter table public.reservas_bicis add column if not exists garantia_id_retenido_at timestamptz;
alter table public.reservas_bicis add column if not exists garantia_id_retenido_por text;
alter table public.reservas_bicis add column if not exists garantia_id_devuelto_at timestamptz;
alter table public.reservas_bicis add column if not exists garantia_id_devuelto_por text;

-- Efectivo que de verdad entró al mostrador. Puede diferir de
-- deposito_total (el cliente llegó con menos y María lo aceptó).
-- ⚠ NO confundir con deposito_capturado: esa columna es exclusiva de
-- capturas de Stripe. Lo que la agencia se quedó en efectivo es
-- deposito_efectivo_recibido - deposito_devuelto. Sumar las dos en un
-- reporte contaría el mismo dinero dos veces.
alter table public.reservas_bicis add column if not exists deposito_efectivo_recibido numeric;

-- ============================================================
-- 3 · Monto REALMENTE autorizado en Stripe
--     Es el tope de captura. Puede diferir de deposito_tarjeta_total si el
--     precio cambió después de crear el hold, y queda en null en los holds
--     creados antes de esta migración (el código cae a deposito_total ahí).
-- ============================================================
alter table public.reservas_bicis add column if not exists deposito_autorizado_monto numeric;

create index if not exists reservas_bicis_garantia_tipo_idx
  on public.reservas_bicis (garantia_tipo);

-- El índice que de verdad hace falta en el mostrador: "¿qué documentos
-- tengo todavía en el cajón?".
create index if not exists reservas_bicis_id_resguardo_idx
  on public.reservas_bicis (garantia_id_retenido_at)
  where garantia_id_devuelto_at is null;

-- ============================================================
-- 4 · La función de creación atómica tiene lista blanca de columnas en su
--     INSERT: sin actualizarla, garantia_tipo y deposito_tarjeta_unitario
--     se perderían en silencio (la reserva se crea, pero siempre en
--     efectivo). Es la misma función de sql/reservas-bicis.sql con esas
--     dos columnas agregadas y terminos_version en v2.
-- ============================================================
create or replace function public.crear_reserva_bici(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_capacidad   int;
  v_ocupadas    int;
  v_disponibles int;
  v_inicio      timestamptz := (payload->>'inicio')::timestamptz;
  v_fin         timestamptz := (payload->>'fin')::timestamptz;
  v_cantidad    int         := (payload->>'cantidad_bicis')::int;
  v_forzar      boolean     := coalesce((payload->>'forzar')::boolean, false);
  v_folio       int;
  v_token       text        := payload->>'token';
begin
  -- Serializa TODAS las creaciones: con 6 bicis, la carrera por la última
  -- es real. El lock se libera solo al terminar la transacción.
  perform pg_advisory_xact_lock(hashtext('walkme_bikes_crear'));

  -- Capacidad: solo 'mantenimiento' resta (una bici rota no se reserva
  -- para el jueves). 'rentada'/'cargando' son estados operativos de HOY,
  -- no de la fecha futura que se está reservando.
  select count(*) into v_capacidad
  from bikes_flota where estado <> 'mantenimiento';

  -- Ocupación en la ventana [inicio, fin): reservas activas que solapan,
  -- más las pendiente_pago cuyo hold de 30 min sigue vigente.
  select coalesce(sum(cantidad_bicis), 0) into v_ocupadas
  from reservas_bicis
  where inicio < v_fin
    and fin > v_inicio
    and (
      estado in ('pendiente_efectivo','pagada','en_curso')
      or (estado = 'pendiente_pago' and expira_at > now())
    );

  v_disponibles := greatest(v_capacidad - v_ocupadas, 0);

  if not v_forzar and v_cantidad > v_disponibles then
    return jsonb_build_object(
      'ok', false,
      'error', 'sin_disponibilidad',
      'disponibles', v_disponibles
    );
  end if;

  insert into reservas_bicis (
    token, idioma, canal, tipo_bici, duracion_id, duracion_nombre,
    fecha_reserva, hora_inicio, inicio, fin, cantidad_bicis,
    precio_unitario, total, deposito_unitario,
    garantia_tipo, deposito_tarjeta_unitario,
    nombre_completo, email, telefono, nacionalidad, documento, hotel,
    firma_nombre, firma_ip, firma_ua, terminos_version,
    foto_id_path, foto_reserva_path,
    estado, expira_at
  ) values (
    v_token,
    coalesce(payload->>'idioma', 'es'),
    coalesce(payload->>'canal', 'web'),
    coalesce(payload->>'tipo_bici', 'ebike-u1'),
    payload->>'duracion_id',
    payload->>'duracion_nombre',
    (payload->>'fecha_reserva')::date,
    (payload->>'hora_inicio')::time,
    v_inicio,
    v_fin,
    v_cantidad,
    (payload->>'precio_unitario')::numeric,
    (payload->>'total')::numeric,
    coalesce((payload->>'deposito_unitario')::numeric, 3000),
    -- Se NORMALIZA aquí, no se confía en el check: un valor inesperado
    -- debe caer a 'efectivo', nunca reventar el insert. Este repo ya
    -- perdió reservas por esa vía con el check de `idioma`.
    case when payload->>'garantia_tipo' = 'tarjeta' then 'tarjeta' else 'efectivo' end,
    coalesce((payload->>'deposito_tarjeta_unitario')::numeric, 7500),
    payload->>'nombre_completo',
    nullif(payload->>'email', ''),
    nullif(payload->>'telefono', ''),
    nullif(payload->>'nacionalidad', ''),
    nullif(payload->>'documento', ''),
    nullif(payload->>'hotel', ''),
    payload->>'firma_nombre',
    nullif(payload->>'firma_ip', ''),
    nullif(payload->>'firma_ua', ''),
    coalesce(payload->>'terminos_version', 'bici-v2-2026-08'),
    nullif(payload->>'foto_id_path', ''),
    nullif(payload->>'foto_reserva_path', ''),
    coalesce(payload->>'estado', 'pendiente_pago'),
    (payload->>'expira_at')::timestamptz
  )
  returning folio into v_folio;

  return jsonb_build_object('ok', true, 'folio', v_folio, 'token', v_token);
end;
$$;

revoke execute on function public.crear_reserva_bici(jsonb) from public, anon, authenticated;
grant  execute on function public.crear_reserva_bici(jsonb) to service_role;
