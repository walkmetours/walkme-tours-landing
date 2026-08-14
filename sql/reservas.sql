-- WalkMe Tours · Esquema de reservas en línea
-- Pegar completo en Supabase → SQL Editor → Run (una sola vez).

create table if not exists public.reservas (
  id uuid primary key default gen_random_uuid(),
  codigo text unique not null,
  estado text not null default 'borrador'
    check (estado in ('borrador','firmada','pagada','pendiente_efectivo','confirmada','cancelada')),
  idioma text not null default 'es' check (idioma in ('es','en')),

  tour_id text not null,
  tour_nombre text not null,
  fecha_tour date not null,
  adultos int not null check (adultos between 1 and 30),
  menores int not null default 0 check (menores between 0 and 20),
  zona text not null check (zona in ('pdc','rm','cun')),
  hotel text,

  precio_adulto numeric not null,
  precio_menor numeric,
  total numeric not null,
  moneda text not null default 'MXN',

  nombre_completo text not null,
  email text not null,
  telefono text not null,

  id_foto_path text,
  hospedaje_path text,
  firma_path text,
  firma_ts timestamptz,
  firma_ip text,
  firma_ua text,
  contrato_version text,

  metodo_pago text check (metodo_pago in ('mercadopago','stripe','efectivo')),
  pago_ref text,
  pago_ts timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists reservas_codigo_idx on public.reservas (codigo);
create index if not exists reservas_fecha_idx on public.reservas (fecha_tour);
create index if not exists reservas_estado_idx on public.reservas (estado);

-- RLS activo SIN policies: nadie entra con la anon key.
-- Las functions de Vercel usan service_role, que ignora RLS.
alter table public.reservas enable row level security;

-- Bucket privado para documentos (ID, hospedaje, firmas)
insert into storage.buckets (id, name, public)
values ('documentos', 'documentos', false)
on conflict (id) do nothing;
