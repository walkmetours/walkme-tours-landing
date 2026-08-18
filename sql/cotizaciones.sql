-- WalkMe Tours · Cotizaciones + Tarifario + Operadores + Leads
-- Pegar completo en Supabase → SQL Editor → Run (una sola vez). Mismo
-- proyecto que sql/reservas-bicis.sql (walkmetours-reservas).
--
-- Por qué existe: hoy el cotizador de tours (assets/cotizador.js) cotiza
-- 100% en el navegador y solo abre WhatsApp — no queda registro en ningún
-- lado, el total es manipulable en el DOM, y los precios viven duplicados
-- a mano en 4 páginas HTML. Esto le da una fuente única de precios
-- (Tarifario), un directorio de operadores con su costo neto (para saber
-- margen), y una cotización real que se puede crear desde el CRM o desde
-- un lead que llega solo de la web.
--
-- "Lead" = una cotización con estado 'borrador' y origen 'lead_web': el
-- cliente pidió una cotización en tours.html/xcaret.html, no reservó ni
-- pagó nada. María la completa y la manda desde el CRM.

-- ============================================================
-- 1 · Folio de cotización, secuencial desde 200 (no choca con WB-5xxx)
-- ============================================================
create sequence if not exists public.folio_cotizacion_seq
  as integer start with 200 increment by 1 minvalue 200;

-- ============================================================
-- 2 · Tarifario: catálogo de servicios/tours (fuente única de precio de
--     venta). Reemplaza los data-adult/data-child duplicados a mano en
--     tours.html/tours-en.html/xcaret.html/xcaret-en.html.
-- ============================================================
create table if not exists public.catalogo_servicios (
  id           text primary key,             -- slug: 'xcaret-plus', 'chichen-clasico'
  nombre       text not null,
  categoria    text not null default 'tour',  -- 'tour' | 'parque' | 'bici' (referencia futura)
  activo       boolean not null default true,
  orden        int not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Precio de VENTA (taquilla) por servicio × zona × nacionalidad. Un mismo
-- servicio puede tener varias filas (Riviera Maya vs Cancún, Nacional vs
-- Extranjero) — igual que hoy hace el cotizador con data-adult-rm/-cun.
create table if not exists public.servicio_tarifas (
  id                uuid primary key default gen_random_uuid(),
  servicio_id       text not null references public.catalogo_servicios(id) on delete cascade,
  zona              text not null,             -- 'Riviera Maya' | 'Cancún' | 'Playa del Carmen' | ...
  nacionalidad      text not null default 'extranjero' check (nacionalidad in ('nacional','extranjero')),
  precio_adulto     numeric not null,
  precio_menor      numeric,                   -- null = sin tarifa de menor (se cotiza aparte)
  moneda            text not null default 'MXN',
  vigente           boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (servicio_id, zona, nacionalidad)
);

-- ============================================================
-- 3 · Operadores (proveedores mayoristas) y su costo neto por servicio
-- ============================================================
create table if not exists public.operadores (
  id           uuid primary key default gen_random_uuid(),
  nombre       text not null,
  contacto     text,
  telefono     text,
  notas        text,
  activo       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Costo NETO que cobra ese operador por ese servicio — para calcular
-- margen (precio de venta en servicio_tarifas menos este neto).
create table if not exists public.operador_ofertas (
  id             uuid primary key default gen_random_uuid(),
  operador_id    uuid not null references public.operadores(id) on delete cascade,
  servicio_id    text not null references public.catalogo_servicios(id) on delete cascade,
  neto_adulto    numeric not null,
  neto_menor     numeric,
  moneda         text not null default 'MXN',
  vigente        boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (operador_id, servicio_id)
);

-- ============================================================
-- 4 · Cotizaciones
-- ============================================================
create table if not exists public.cotizaciones (
  id              uuid primary key default gen_random_uuid(),
  folio           integer not null unique default nextval('public.folio_cotizacion_seq'),
  estado          text not null default 'borrador'
                  check (estado in ('borrador','enviada','aceptada','cancelada','expirada')),
  origen          text not null default 'crm' check (origen in ('crm','lead_web')),
  idioma          text not null default 'es' check (idioma in ('es','en')),

  cliente_nombre  text not null,
  cliente_tel     text,
  cliente_email   text,

  descuento       numeric not null default 0,
  notas           text,

  -- Solo relevante si origen = 'lead_web' (antiabuso, igual que reservas_bicis).
  origen_ip       text,
  origen_ua       text,

  reserva_folio   integer,                   -- si se acepta y se convierte en reserva real (futuro)
  creado_por      text,                      -- email del CRM, o 'web' si origen = lead_web

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists public.cotizacion_items (
  id             uuid primary key default gen_random_uuid(),
  cotizacion_id  uuid not null references public.cotizaciones(id) on delete cascade,
  servicio_id    text references public.catalogo_servicios(id),
  servicio_nombre text not null,              -- copia al momento de cotizar (por si el servicio cambia después)
  fecha          date,
  zona           text,
  nacionalidad   text default 'extranjero',
  adultos        int not null default 1 check (adultos >= 0),
  menores        int not null default 0 check (menores >= 0),
  precio_adulto  numeric not null,            -- snapshot del precio de venta al cotizar
  precio_menor   numeric not null default 0,
  operador_id    uuid references public.operadores(id),
  orden          int not null default 0,
  created_at     timestamptz not null default now()
);

create index if not exists cotizaciones_estado_idx      on public.cotizaciones (estado);
create index if not exists cotizaciones_origen_idx      on public.cotizaciones (origen);
create index if not exists cotizacion_items_cot_idx     on public.cotizacion_items (cotizacion_id);
create index if not exists servicio_tarifas_servicio_idx on public.servicio_tarifas (servicio_id);
create index if not exists operador_ofertas_servicio_idx on public.operador_ofertas (servicio_id);

-- ============================================================
-- 5 · RLS activo SIN policies — mismo patrón que reservas-bicis.sql.
--     Solo service_role (las functions de Vercel) toca estas tablas.
-- ============================================================
alter table public.catalogo_servicios enable row level security;
alter table public.servicio_tarifas   enable row level security;
alter table public.operadores         enable row level security;
alter table public.operador_ofertas   enable row level security;
alter table public.cotizaciones       enable row level security;
alter table public.cotizacion_items   enable row level security;

grant select, insert, update, delete on public.catalogo_servicios to service_role;
grant select, insert, update, delete on public.servicio_tarifas   to service_role;
grant select, insert, update, delete on public.operadores         to service_role;
grant select, insert, update, delete on public.operador_ofertas   to service_role;
grant select, insert, update, delete on public.cotizaciones       to service_role;
grant select, insert, update, delete on public.cotizacion_items   to service_role;
grant usage on sequence public.folio_cotizacion_seq to service_role;
