-- 021_platform_ai_policies.up.sql
-- Platform-managed AI runtime settings + per-subject policy gates.

create table if not exists public.platform_ai_settings (
  capability_type text primary key,
  managed_by_platform boolean not null default true,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_platform_ai_settings_capability_type
    check (capability_type in ('notebook_ai', 'translation'))
);

alter table if exists public.platform_ai_settings
  add column if not exists managed_by_platform boolean not null default true;
alter table if exists public.platform_ai_settings
  add column if not exists config jsonb not null default '{}'::jsonb;
alter table if exists public.platform_ai_settings
  add column if not exists created_at timestamptz not null default now();
alter table if exists public.platform_ai_settings
  add column if not exists updated_at timestamptz not null default now();

insert into public.platform_ai_settings (capability_type, managed_by_platform, config)
values
  ('notebook_ai', true, '{}'::jsonb),
  ('translation', true, '{}'::jsonb)
on conflict (capability_type) do nothing;

create table if not exists public.subject_ai_policies (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null,
  subject_id uuid not null,
  capability_type text not null,
  enabled boolean not null default false,
  expire_at timestamptz,
  quota_monthly_requests integer,
  quota_used_monthly_requests integer not null default 0,
  quota_month_key text not null default to_char(now(), 'YYYY-MM'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_subject_ai_policies_subject_type
    check (subject_type in ('company')),
  constraint chk_subject_ai_policies_capability_type
    check (capability_type in ('notebook_ai', 'translation')),
  constraint chk_subject_ai_policies_quota_nonnegative
    check (quota_monthly_requests is null or quota_monthly_requests >= 0),
  constraint chk_subject_ai_policies_quota_used_nonnegative
    check (quota_used_monthly_requests >= 0),
  unique (subject_type, subject_id, capability_type)
);

alter table if exists public.subject_ai_policies
  add column if not exists subject_type text;
alter table if exists public.subject_ai_policies
  add column if not exists subject_id uuid;
alter table if exists public.subject_ai_policies
  add column if not exists capability_type text;
alter table if exists public.subject_ai_policies
  add column if not exists enabled boolean not null default false;
alter table if exists public.subject_ai_policies
  add column if not exists expire_at timestamptz;
alter table if exists public.subject_ai_policies
  add column if not exists quota_monthly_requests integer;
alter table if exists public.subject_ai_policies
  add column if not exists quota_used_monthly_requests integer not null default 0;
alter table if exists public.subject_ai_policies
  add column if not exists quota_month_key text not null default to_char(now(), 'YYYY-MM');
alter table if exists public.subject_ai_policies
  add column if not exists created_at timestamptz not null default now();
alter table if exists public.subject_ai_policies
  add column if not exists updated_at timestamptz not null default now();

create index if not exists idx_subject_ai_policies_subject
  on public.subject_ai_policies(subject_type, subject_id, capability_type);

drop trigger if exists trg_platform_ai_settings_updated on public.platform_ai_settings;
create trigger trg_platform_ai_settings_updated
  before update on public.platform_ai_settings
  for each row execute function public.set_updated_at();

drop trigger if exists trg_subject_ai_policies_updated on public.subject_ai_policies;
create trigger trg_subject_ai_policies_updated
  before update on public.subject_ai_policies
  for each row execute function public.set_updated_at();

