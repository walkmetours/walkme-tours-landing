-- WalkMe Bikes · Migración 18-ago-2026: depósito de garantía vía Stripe (hold)
-- Pegar completo en Supabase → SQL Editor → Run (una sola vez, idempotente).
--
-- Hoy la garantía ($3,000 MXN/bici, `deposito_unitario`/`deposito_total`)
-- se cobra en efectivo al recoger la bici. Se agrega un canal de dinero
-- PARALELO al de la renta (igual que ya existe metodo_pago/pago_ref/
-- pago_ts para la renta) para manejarla como autorización de Stripe
-- (capture_method: manual): se retiene la tarjeta sin cobrar, se captura
-- solo si hay daño/atraso/pérdida, se libera si la bici regresa bien.
--
-- deposito_estado queda separado de `estado` a propósito: es un proceso
-- independiente del ciclo de vida de la reserva (un hold puede necesitar
-- atención mientras la renta sigue 'en_curso' con toda normalidad).

alter table public.reservas_bicis add column if not exists deposito_estado text
  not null default 'none'
  check (deposito_estado in ('none','pendiente','autorizado','capturado','liberado','expirado','requiere_atencion'));

alter table public.reservas_bicis add column if not exists deposito_checkout_session_id text;
alter table public.reservas_bicis add column if not exists deposito_pi_id text;
alter table public.reservas_bicis add column if not exists deposito_customer_id text;
alter table public.reservas_bicis add column if not exists deposito_payment_method_id text;
alter table public.reservas_bicis add column if not exists deposito_autorizado_at timestamptz;
alter table public.reservas_bicis add column if not exists deposito_expira_at timestamptz;
alter table public.reservas_bicis add column if not exists deposito_capturado numeric;
alter table public.reservas_bicis add column if not exists deposito_capturado_at timestamptz;
alter table public.reservas_bicis add column if not exists deposito_liberado_at timestamptz;
alter table public.reservas_bicis add column if not exists deposito_reautorizaciones int not null default 0;
alter table public.reservas_bicis add column if not exists deposito_ultimo_error text;

create index if not exists reservas_bicis_deposito_estado_idx on public.reservas_bicis (deposito_estado);
create index if not exists reservas_bicis_deposito_expira_idx on public.reservas_bicis (deposito_expira_at);
