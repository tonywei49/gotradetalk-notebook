-- 021_platform_ai_policies.down.sql

drop trigger if exists trg_subject_ai_policies_updated on public.subject_ai_policies;
drop trigger if exists trg_platform_ai_settings_updated on public.platform_ai_settings;

drop table if exists public.subject_ai_policies;
drop table if exists public.platform_ai_settings;

