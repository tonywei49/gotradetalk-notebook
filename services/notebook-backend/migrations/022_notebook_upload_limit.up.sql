alter table if exists public.company_settings
  add column if not exists notebook_ai_upload_max_mb integer;

update public.company_settings
set notebook_ai_upload_max_mb = 20
where notebook_ai_upload_max_mb is null or notebook_ai_upload_max_mb <= 0;

alter table if exists public.company_settings
  alter column notebook_ai_upload_max_mb set default 20;

