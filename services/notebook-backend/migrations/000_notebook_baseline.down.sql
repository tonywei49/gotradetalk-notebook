-- 000_notebook_baseline.down.sql

drop trigger if exists trg_company_settings_updated on public.company_settings;
drop trigger if exists trg_company_memberships_updated on public.company_memberships;
drop trigger if exists trg_profiles_updated on public.profiles;
drop trigger if exists trg_companies_updated on public.companies;

drop table if exists public.company_settings;
drop table if exists public.company_memberships;
drop table if exists public.profiles;
drop table if exists public.companies;

drop function if exists public.set_updated_at();
