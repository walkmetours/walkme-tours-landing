-- WalkMe · JOYÀ (Cirque du Soleil) — esquema de reservas
-- Pegar completo en Supabase → SQL Editor → Run (una sola vez).
--
-- Mismo patrón que sql/reservas-bicis.sql, simplificado: JOYÀ no tiene
-- inventario propio (el teatro asigna sus bloques, no WalkMe) ni depósito
-- de garantía, así que no hay advisory lock de disponibilidad ni columnas
-- de garantía/hold. Es solo folio + cupón + notificación.
--
-- · folio: entero secuencial desde 5000 (mismo esquema que bicis). Es
--   PÚBLICO y por lo tanto enumerable — jamás se usa como llave de URL.
-- · token: 16 chars aleatorios — la llave real del cupón (?t=...).
-- · RLS activo SIN policies: la anon key no lee nada; solo las functions
--   de Vercel (service_role) tocan esta tabla.

-- ============================================================
-- 1 · Folio secuencial desde 5000
-- ============================================================
create sequence if not exists public.folio_joya_seq
  as integer start with 5000 increment by 1 minvalue 5000;

-- ============================================================
-- 2 · Reservas de JOYÀ
-- ============================================================
create table if not exists public.reservas_joya (
  id            uuid primary key default gen_random_uuid(),
  folio         integer not null unique default nextval('public.folio_joya_seq'),
  token         text    not null unique,
  estado        text    not null default 'pendiente_pago'
                check (estado in ('pendiente_pago','pagada','cancelada','no_show')),
  idioma        text    not null default 'es' check (idioma in ('es','en')),
  canal         text    not null default 'web' check (canal in ('web','mostrador')),

  -- Qué se reserva
  tier_id       text    not null
                check (tier_id in ('vip','show-cena','celebration','elite',
                                    'solo-central','solo-lateral',
                                    'jungala-daypass','jungala-beyond')),
  tier_nombre   text    not null,           -- etiqueta ya resuelta en el idioma del cliente
  seccion       text    not null,
  fecha_funcion date    not null,
  horario       text    not null,
  adultos       int     not null check (adultos between 1 and 20),
  ninos         int     not null default 0 check (ninos between 0 and 20),

  -- Transporte (informativo — el teatro/Jungala no lo controla WalkMe;
  -- es una tarifa fija por persona que WalkMe sí cobra)
  transporte_id     text not null default 'no'
                    check (transporte_id in ('no','pdc','riviera','cun')),
  transporte_tarifa numeric not null default 0,
  hotel             text,

  -- Dinero (el total SIEMPRE se recalcula en servidor desde el catálogo)
  precio_adulto numeric not null,
  precio_nino   numeric not null,
  subtotal_boletos numeric not null,
  subtotal_transporte numeric not null default 0,
  total         numeric not null,
  moneda        text    not null default 'MXN',

  -- Cliente
  nombre_completo text not null,
  email         text,
  telefono      text,
  notas         text,

  -- Metadatos de creación
  firma_ip      text,
  firma_ua      text,

  -- Pago (lo actualiza el equipo a mano tras cobrar por fuera — no hay
  -- pasarela integrada; ver contexto en el plan)
  metodo_pago   text check (metodo_pago in ('mercadopago','stripe','transferencia','efectivo')),
  pago_ref      text,
  pago_ts       timestamptz,

  notas_internas text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists reservas_joya_token_idx  on public.reservas_joya (token);
create index if not exists reservas_joya_folio_idx  on public.reservas_joya (folio);
create index if not exists reservas_joya_estado_idx on public.reservas_joya (estado);

-- ============================================================
-- 3 · Auditoría del CRM (mismo patrón que crm_eventos de bicis;
--     se reusa la tabla existente si ya corrió reservas-bicis.sql)
-- ============================================================
create table if not exists public.crm_eventos (
  id         bigserial primary key,
  reserva_id uuid,
  actor      text not null,
  accion     text not null,
  detalle    jsonb,
  created_at timestamptz not null default now()
);

-- ============================================================
-- 4 · Creación (sin advisory lock: no hay inventario que competir)
--     payload: { token, idioma, canal, tier_id, tier_nombre, seccion,
--                fecha_funcion, horario, adultos, ninos,
--                transporte_id, transporte_tarifa, hotel,
--                precio_adulto, precio_nino, subtotal_boletos,
--                subtotal_transporte, total,
--                nombre_completo, email, telefono, notas,
--                firma_ip, firma_ua }
--     Devuelve: { ok:true, folio, token }
-- ============================================================
create or replace function public.crear_reserva_joya(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_folio int;
  v_token text := payload->>'token';
begin
  insert into reservas_joya (
    token, idioma, canal, tier_id, tier_nombre, seccion,
    fecha_funcion, horario, adultos, ninos,
    transporte_id, transporte_tarifa, hotel,
    precio_adulto, precio_nino, subtotal_boletos, subtotal_transporte, total,
    nombre_completo, email, telefono, notas,
    firma_ip, firma_ua,
    estado
  ) values (
    v_token,
    coalesce(payload->>'idioma', 'es'),
    coalesce(payload->>'canal', 'web'),
    payload->>'tier_id',
    payload->>'tier_nombre',
    payload->>'seccion',
    (payload->>'fecha_funcion')::date,
    payload->>'horario',
    (payload->>'adultos')::int,
    coalesce((payload->>'ninos')::int, 0),
    coalesce(payload->>'transporte_id', 'no'),
    coalesce((payload->>'transporte_tarifa')::numeric, 0),
    nullif(payload->>'hotel', ''),
    (payload->>'precio_adulto')::numeric,
    (payload->>'precio_nino')::numeric,
    (payload->>'subtotal_boletos')::numeric,
    coalesce((payload->>'subtotal_transporte')::numeric, 0),
    (payload->>'total')::numeric,
    payload->>'nombre_completo',
    nullif(payload->>'email', ''),
    nullif(payload->>'telefono', ''),
    nullif(payload->>'notas', ''),
    nullif(payload->>'firma_ip', ''),
    nullif(payload->>'firma_ua', ''),
    'pendiente_pago'
  )
  returning folio into v_folio;

  return jsonb_build_object('ok', true, 'folio', v_folio, 'token', v_token);
end;
$$;

revoke execute on function public.crear_reserva_joya(jsonb) from public, anon, authenticated;
grant  execute on function public.crear_reserva_joya(jsonb) to service_role;

-- ============================================================
-- 5 · RLS: activo, SIN policies — nadie entra con la anon key.
-- ============================================================
alter table public.reservas_joya enable row level security;

grant select, insert, update, delete on public.reservas_joya to service_role;
