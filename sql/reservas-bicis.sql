-- WalkMe Bikes · Esquema de reservas de bicis + flota + auditoría del CRM
-- Pegar completo en Supabase → SQL Editor → Run (una sola vez).
--
-- Diseño:
-- · folio: entero secuencial desde 5000 (pedido de María). Es PÚBLICO y
--   por lo tanto enumerable — jamás se usa como llave de URL.
-- · token: 16 chars aleatorios — la llave real del cupón (?t=...).
-- · [inicio, fin): intervalos SEMIABIERTOS. 10-12 y 12-14 no chocan.
-- · Disponibilidad y creación son ATÓMICAS vía crear_reserva_bici()
--   con advisory lock (dos clientes por la última bici = un OK y un no).
-- · RLS activo SIN policies en todo: la anon key no lee nada; solo las
--   functions de Vercel (service_role) tocan estas tablas.

-- ============================================================
-- 1 · Folio secuencial desde 5000
--     Los saltos (5000, 5001, 5003) son normales: una inserción fallida
--     consume un número. Único y creciente, no contiguo.
-- ============================================================
create sequence if not exists public.folio_bici_seq
  as integer start with 5000 increment by 1 minvalue 5000;

-- ============================================================
-- 2 · Flota (6 unidades propias hoy; `dueno` queda listo para
--     consignación futura, v1 no la usa)
-- ============================================================
create table if not exists public.bikes_flota (
  id         text primary key,              -- 'B-01' … 'B-06'
  modelo     text not null default 'EBIKE-U1',
  bateria    int  not null default 100 check (bateria between 0 and 100),
  estado     text not null default 'disponible'
             check (estado in ('disponible','rentada','cargando','mantenimiento')),
  dueno      text,                          -- null = propia
  notas      text,
  orden      int  not null default 0,
  created_at timestamptz not null default now()
);

insert into public.bikes_flota (id, orden) values
  ('B-01', 1), ('B-02', 2), ('B-03', 3), ('B-04', 4), ('B-05', 5), ('B-06', 6)
on conflict (id) do nothing;

-- ============================================================
-- 3 · Reservas de bicis
-- ============================================================
create table if not exists public.reservas_bicis (
  id            uuid primary key default gen_random_uuid(),
  folio         integer not null unique default nextval('public.folio_bici_seq'),
  token         text    not null unique,
  estado        text    not null default 'pendiente_pago'
                check (estado in ('pendiente_pago','pendiente_efectivo','pagada',
                                  'en_curso','cerrada','cancelada','no_show')),
  idioma        text    not null default 'es' check (idioma in ('es','en')),
  canal         text    not null default 'web' check (canal in ('web','mostrador')),

  -- Qué se renta
  tipo_bici     text    not null default 'ebike-u1',
  duracion_id   text    not null check (duracion_id in ('2h','dia','24h','semana','mes')),
  duracion_nombre text  not null,           -- etiqueta ya resuelta en el idioma del cliente
  fecha_reserva date    not null,
  hora_inicio   time    not null,
  inicio        timestamptz not null,       -- calculado en servidor (America/Cancun)
  fin           timestamptz not null,       -- calculado en servidor
  cantidad_bicis int    not null check (cantidad_bicis between 1 and 12),
  unidades      text[]  not null default '{}',   -- {'B-02','B-03'} — asigna el CRM

  -- Dinero (el total SIEMPRE se recalcula en servidor desde el catálogo)
  precio_unitario   numeric not null,
  total             numeric not null,
  moneda            text    not null default 'MXN',
  deposito_unitario numeric not null default 3000,
  deposito_total    numeric generated always as (deposito_unitario * cantidad_bicis) stored,

  -- Cliente. email es NOT NULL solo conceptualmente para la web (lo
  -- exige crear.js); en mostrador un walk-in puede no tener correo.
  nombre_completo text not null,
  email         text,
  telefono      text,
  nacionalidad  text,                       -- lo captura el CRM en mostrador
  documento     text,                       -- pasaporte/licencia (CRM)
  hotel         text,

  -- Aceptación de términos (clickwrap: checkbox + nombre tecleado)
  firma_nombre  text not null,
  firma_ts      timestamptz not null default now(),
  firma_ip      text,
  firma_ua      text,
  terminos_version text not null default 'bici-v1-2026-08',

  -- Foto del pasaporte/ID, subida por el cliente. Ruta dentro del bucket
  -- PRIVADO 'documentos-bicis' (crearlo a mano en Supabase → Storage →
  -- New bucket → Public: NO). Para verla hay que generar un signed URL,
  -- nunca una URL pública fija (es un documento de identidad).
  foto_id_path  text,

  -- Pago
  metodo_pago   text check (metodo_pago in ('mercadopago','stripe','efectivo')),
  pago_ref      text,
  pago_ts       timestamptz,

  -- Hold: una pendiente_pago vencida deja de contar para disponibilidad
  expira_at     timestamptz,

  -- Cierre de renta (lo llena el CRM al devolver la bici)
  cargo_retraso     numeric not null default 0,
  cargo_danos       numeric not null default 0,
  cargo_nota        text,
  deposito_devuelto numeric,
  cerrada_at        timestamptz,
  cerrada_por       text,
  notas_internas    text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Por si la tabla ya existía sin esta columna (create table if not exists
-- de arriba no la habría agregado): idempotente, seguro correr siempre.
alter table public.reservas_bicis add column if not exists foto_id_path text;

-- ── Migración 15-ago-2026: formulario nuevo de renta (diseño "Renta Bikes") ──
-- El formulario pasó a 5 idiomas y pide una segunda foto (la reserva de
-- hotel/Airbnb, OPCIONAL — decisión de María: que no bloquee la reserva).
alter table public.reservas_bicis add column if not exists foto_reserva_path text;

-- El check original era check (idioma in ('es','en')). Con el formulario en
-- 5 idiomas, un cliente italiano hacía fallar el insert y PERDÍA la reserva.
-- Se amplía. El nombre del check inline lo genera Postgres, así que primero
-- se busca por definición y luego se recrea con nombre propio (idempotente).
do $$
declare v_conname text;
begin
  select conname into v_conname
    from pg_constraint
   where conrelid = 'public.reservas_bicis'::regclass
     and contype  = 'c'
     and conname <> 'reservas_bicis_idioma_chk'
     and pg_get_constraintdef(oid) ilike '%idioma%';
  if v_conname is not null then
    execute format('alter table public.reservas_bicis drop constraint %I', v_conname);
  end if;
end $$;

alter table public.reservas_bicis drop constraint if exists reservas_bicis_idioma_chk;
alter table public.reservas_bicis
  add constraint reservas_bicis_idioma_chk
  check (idioma in ('es','en','it','fr','pt'));

create index if not exists reservas_bicis_token_idx   on public.reservas_bicis (token);
create index if not exists reservas_bicis_folio_idx   on public.reservas_bicis (folio);
create index if not exists reservas_bicis_estado_idx  on public.reservas_bicis (estado);
create index if not exists reservas_bicis_ventana_idx on public.reservas_bicis (inicio, fin);

-- ============================================================
-- 4 · Auditoría del CRM (quién marcó qué)
-- ============================================================
create table if not exists public.crm_eventos (
  id         bigserial primary key,
  reserva_id uuid references public.reservas_bicis (id) on delete set null,
  actor      text not null,                 -- email de María o Gina
  accion     text not null,                 -- 'estado', 'unidades', 'cerrar', …
  detalle    jsonb,
  created_at timestamptz not null default now()
);

-- ============================================================
-- 5 · Creación atómica con chequeo de disponibilidad
--     payload: { token, idioma, canal, duracion_id, duracion_nombre,
--                fecha_reserva, hora_inicio, inicio, fin, cantidad_bicis,
--                precio_unitario, total, deposito_unitario,
--                nombre_completo, email, telefono, firma_nombre,
--                firma_ip, firma_ua, terminos_version, expira_at,
--                nacionalidad?, documento?, hotel?,          -- 15-ago-26
--                foto_id_path?, foto_reserva_path?,          -- 15-ago-26
--                forzar (bool, solo CRM) }
--     Devuelve: { ok:true, folio, token }
--            o  { ok:false, error:'sin_disponibilidad', disponibles:N }
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
    payload->>'nombre_completo',
    nullif(payload->>'email', ''),
    nullif(payload->>'telefono', ''),
    nullif(payload->>'nacionalidad', ''),
    nullif(payload->>'documento', ''),
    nullif(payload->>'hotel', ''),
    payload->>'firma_nombre',
    nullif(payload->>'firma_ip', ''),
    nullif(payload->>'firma_ua', ''),
    coalesce(payload->>'terminos_version', 'bici-v1-2026-08'),
    nullif(payload->>'foto_id_path', ''),
    nullif(payload->>'foto_reserva_path', ''),
    coalesce(payload->>'estado', 'pendiente_pago'),
    (payload->>'expira_at')::timestamptz
  )
  returning folio into v_folio;

  return jsonb_build_object('ok', true, 'folio', v_folio, 'token', v_token);
end;
$$;

-- La function corre como owner (security definer); revocamos ejecución a
-- anon/authenticated por si acaso — solo service_role la llama. El revoke
-- de PUBLIC también le quita el permiso a service_role (solo tenía acceso
-- vía PUBLIC), así que hay que devolvérselo explícito.
revoke execute on function public.crear_reserva_bici(jsonb) from public, anon, authenticated;
grant  execute on function public.crear_reserva_bici(jsonb) to service_role;

-- ============================================================
-- 6 · RLS: activo, SIN policies — nadie entra con la anon key.
--     Las functions de Vercel usan service_role, que ignora RLS.
--     Ojo: RLS y GRANT son cosas distintas — bypasear RLS no basta,
--     service_role también necesita el GRANT de tabla de abajo (sobre
--     todo si en el dashboard de Supabase quedó apagado "Automatically
--     expose new tables").
-- ============================================================
alter table public.reservas_bicis enable row level security;
alter table public.bikes_flota    enable row level security;
alter table public.crm_eventos    enable row level security;

grant select, insert, update, delete on public.reservas_bicis to service_role;
grant select, insert, update, delete on public.bikes_flota    to service_role;
grant select, insert            on public.crm_eventos    to service_role;

-- ── Migración 17-ago-2026: consignación real (2 dueñas) ──
-- `dueno` ya existía "lista para consignación futura" pero nunca se usó (v1
-- no la tocaba). Confirmado con María: las 6 bicis de la flota se reparten
-- entre ella (3) y Andreina (3) — no son bicis nuevas, es dueño real de las
-- B-01..B-06 existentes. Se agrega correo para poder avisarles por email
-- (feature "avisar a dueños" del CRM v2). El correo de Andreina queda NULL
-- hasta que María lo confirme — no se inventa.
alter table public.bikes_flota add column if not exists dueno_email text;

-- Reparto real: B-01..B-03 = María, B-04..B-06 = Andreina. Solo corre si
-- `dueno` sigue NULL (no pisa un reparto que María ya haya editado a mano
-- en el CRM viejo).
update public.bikes_flota set dueno = 'María',    dueno_email = 'boticaspa@gmail.com'
  where id in ('B-01','B-02','B-03') and dueno is null;
update public.bikes_flota set dueno = 'Andreina', dueno_email = null
  where id in ('B-04','B-05','B-06') and dueno is null;
