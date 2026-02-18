-- 000_notebook_baseline.up.sql
-- Baseline schema for standalone notebook-backend on empty Postgres.
-- Keeps FK integrity by defining minimal dependency tables locally.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text,
  hs_domain text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists public.companies add column if not exists name text;
alter table if exists public.companies add column if not exists hs_domain text;
alter table if exists public.companies add column if not exists created_at timestamptz not null default now();
alter table if exists public.companies add column if not exists updated_at timestamptz not null default now();

create unique index if not exists idx_companies_hs_domain on public.companies(hs_domain) where hs_domain is not null;

create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  auth_user_id text,
  user_type text not null default 'client',
  user_local_id text,
  matrix_user_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_profiles_user_type check (user_type in ('client', 'staff', 'admin'))
);

alter table if exists public.profiles add column if not exists company_id uuid;
alter table if exists public.profiles add column if not exists auth_user_id text;
alter table if exists public.profiles add column if not exists user_type text not null default 'client';
alter table if exists public.profiles add column if not exists user_local_id text;
alter table if exists public.profiles add column if not exists matrix_user_id text;
alter table if exists public.profiles add column if not exists created_at timestamptz not null default now();
alter table if exists public.profiles add column if not exists updated_at timestamptz not null default now();

create unique index if not exists idx_profiles_matrix_user_id on public.profiles(matrix_user_id) where matrix_user_id is not null;
create index if not exists idx_profiles_company_user_local on public.profiles(company_id, user_local_id);
create index if not exists idx_profiles_auth_user_id on public.profiles(auth_user_id);

create table if not exists public.company_memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  company_id uuid not null references public.companies(id) on delete cascade,
  role text not null default 'member',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_company_memberships_role check (role in ('member', 'admin', 'owner')),
  unique (user_id, company_id)
);

alter table if exists public.company_memberships add column if not exists user_id uuid;
alter table if exists public.company_memberships add column if not exists company_id uuid;
alter table if exists public.company_memberships add column if not exists role text not null default 'member';
alter table if exists public.company_memberships add column if not exists created_at timestamptz not null default now();
alter table if exists public.company_memberships add column if not exists updated_at timestamptz not null default now();

create table if not exists public.company_settings (
  company_id uuid primary key references public.companies(id) on delete cascade,
  notebook_ai_enabled boolean not null default false,
  notebook_ai_llm_base_url text,
  notebook_ai_llm_api_key text,
  notebook_ai_chat_model text,
  notebook_ai_embedding_model text,
  notebook_ai_rerank_model text,
  notebook_ai_retrieval_top_k integer not null default 5,
  notebook_ai_score_threshold numeric(6,4) not null default 0.35,
  notebook_ai_max_context_tokens integer not null default 4096,
  notebook_ai_ocr_enabled boolean not null default false,
  notebook_ai_allow_low_confidence_send boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists public.company_settings add column if not exists notebook_ai_enabled boolean not null default false;
alter table if exists public.company_settings add column if not exists notebook_ai_llm_base_url text;
alter table if exists public.company_settings add column if not exists notebook_ai_llm_api_key text;
alter table if exists public.company_settings add column if not exists notebook_ai_chat_model text;
alter table if exists public.company_settings add column if not exists notebook_ai_embedding_model text;
alter table if exists public.company_settings add column if not exists notebook_ai_rerank_model text;
alter table if exists public.company_settings add column if not exists notebook_ai_retrieval_top_k integer not null default 5;
alter table if exists public.company_settings add column if not exists notebook_ai_score_threshold numeric(6,4) not null default 0.35;
alter table if exists public.company_settings add column if not exists notebook_ai_max_context_tokens integer not null default 4096;
alter table if exists public.company_settings add column if not exists notebook_ai_ocr_enabled boolean not null default false;
alter table if exists public.company_settings add column if not exists notebook_ai_allow_low_confidence_send boolean not null default false;
alter table if exists public.company_settings add column if not exists created_at timestamptz not null default now();
alter table if exists public.company_settings add column if not exists updated_at timestamptz not null default now();

create index if not exists idx_company_memberships_company_id on public.company_memberships(company_id);

drop trigger if exists trg_companies_updated on public.companies;
create trigger trg_companies_updated
  before update on public.companies
  for each row execute function public.set_updated_at();

drop trigger if exists trg_profiles_updated on public.profiles;
create trigger trg_profiles_updated
  before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists trg_company_memberships_updated on public.company_memberships;
create trigger trg_company_memberships_updated
  before update on public.company_memberships
  for each row execute function public.set_updated_at();

drop trigger if exists trg_company_settings_updated on public.company_settings;
create trigger trg_company_settings_updated
  before update on public.company_settings
  for each row execute function public.set_updated_at();
